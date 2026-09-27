import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import { normalizeImportRow } from './src/services/importNormalize.js';

const isNeon = !!process.env.DATABASE_URL;
let neonMod = null;
if (isNeon) {
  neonMod = await import('./lib/neon.js');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// ── Persistent file DB (./data/fintrack.db.json) ─────────────────────
// Tables: users, sessions, transactions, budgets, accounts, categories,
// upiIds, goals, contributions, recurring, preferences, imports, audit.
// Money is stored as INTEGER paise everywhere internally; the API accepts
// and returns rupees at the boundary (rounded to the nearest paise).
// No dummy/seed transactions are ever created — each user starts empty.
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'fintrack.db.json');

const DEFAULT_BUDGETS = {
  Food: 12000, Transportation: 5000, Housing: 25000, Shopping: 10000,
  Health: 5000, Education: 8000, Entertainment: 4000, Financial: 3000,
  Family: 6000, Business: 12000, Miscellaneous: 4000
};

const DEFAULT_ACCOUNTS_SEED = [
  { name: 'HDFC Savings', type: 'savings', institution: 'HDFC Bank' },
  { name: 'SBI Salary', type: 'savings', institution: 'SBI' },
  { name: 'ICICI Credit Card', type: 'credit_card', institution: 'ICICI Bank' },
  { name: 'Cash Wallet', type: 'cash', institution: '' }
];

const ACCOUNT_TYPES = new Set([
  'cash', 'savings', 'current', 'upi', 'credit_card', 'wallet', 'investment', 'other'
]);
const ASSET_TYPES = new Set(['cash', 'savings', 'current', 'upi', 'wallet', 'investment', 'other']);

const DEFAULT_USER = {
  email: 'prathmesh.nakate@ssg.com',
  password: 'Prathmesh@123',
  name: 'Prathmesh'
};

// ── Paise helpers (never float-math money internally) ──
const toPaise = (rupees) => Math.round(Number(rupees) * 100);
const toRupees = (paise) => (paise / 100);

function emptyDb() {
  return {
    users: [], sessions: [], transactions: [], budgets: [],
    accounts: [], categories: [], upiIds: [], goals: [], contributions: [],
    recurring: [], preferences: [], imports: [], resets: [],
    autopilotRules: [], autopilotRuns: [], notifications: [],
    securityEvents: [], audit: []
  };
}

function loadDb() {
  let db;
  try {
    if (!fs.existsSync(DB_FILE)) return emptyDb();
    db = { ...emptyDb(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch {
    return emptyDb();
  }
  for (const k of Object.keys(emptyDb())) if (!Array.isArray(db[k])) db[k] = [];
  // Migrate legacy rupee-float amounts → integer paise.
  for (const t of db.transactions) {
    if (t.amountPaise === undefined) {
      t.amountPaise = toPaise(t.amount || 0);
      delete t.amount;
    }
  }
  for (const g of db.goals || []) {
    if (g.targetPaise === undefined) { g.targetPaise = toPaise(g.target || 0); delete g.target; }
    if (g.currentPaise === undefined) { g.currentPaise = toPaise(g.current || 0); delete g.current; }
  }
  for (const c of db.contributions || []) {
    if (c.amountPaise === undefined) { c.amountPaise = toPaise(c.amount || 0); delete c.amount; }
  }
  for (const r of db.recurring || []) {
    if (r.amountPaise === undefined) { r.amountPaise = toPaise(r.amount || 0); delete r.amount; }
  }
  for (const a of db.accounts || []) {
    if (a.openingPaise === undefined) { a.openingPaise = toPaise(a.openingBalance || 0); delete a.openingBalance; }
  }
  migrateSessions(db);
  return db;
}

function saveDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

let db = loadDb();
async function refreshDbFromNeon() {
  if (!isNeon) return;
  try {
    const remote = await neonMod.loadFromNeon(emptyDb);
    db = { ...emptyDb(), ...remote };
    for (const k of Object.keys(emptyDb())) if (!Array.isArray(db[k])) db[k] = [];
    migrateSessions(db);
  } catch (e) {
    console.error('Neon load failed, using in-memory db:', e?.message || e);
  }
}
const save = async () => {
  if (isNeon) {
    try {
      await neonMod.saveToNeon(db);
      return;
    } catch (e) {
      console.error('Neon save failed, falling back to file:', e?.message || e);
    }
  }
  try { saveDb(db); } catch { /* ephemeral fs on serverless — ignore */ }
};
const uid = (p) => p + crypto.randomBytes(8).toString('hex');

import { SECURITY_EVENT_CAP, capList, coarseDevice } from './src/services/security.js';

// ── Sessions: hashed verifiers, independently revocable ────
// The DB never stores raw bearer tokens — only SHA-256(token). Legacy rows
// ({token}) are migrated losslessly on load (the raw value is right there to
// hash) and the raw copy is then dropped.
function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days, unchanged policy
const LAST_SEEN_TTL_MS = 3600 * 1000; // persist last-activity at most hourly

function migrateSessions(dbRef) {
  let changed = false;
  for (const s of dbRef.sessions || []) {
    if (!s.tokenHash && s.token) {
      s.tokenHash = hashToken(s.token);
      changed = true;
    }
    if (s.token) { delete s.token; changed = true; }
    // Deterministic id from the verifier (no uid() here — migrateSessions
    // runs during loadDb, before later consts initialize).
    if (!s.id) { s.id = 's_' + (s.tokenHash ? hashToken(s.tokenHash).slice(0, 16) : crypto.randomBytes(8).toString('hex')); changed = true; }
    if (!s.device) { s.device = 'Unknown device · before tracking'; changed = true; }
    if (!s.lastSeenAt) { s.lastSeenAt = s.createdAt || null; changed = true; }
  }
  return changed;
}

function createSessionRecord(userId, deviceLabel) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const record = {
    id: uid('s_'), userId, tokenHash: hashToken(token),
    device: String(deviceLabel || 'Unknown device').slice(0, 80),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    lastSeenAt: now.toISOString()
  };
  return { record, token };
}

// Finds a live session for a raw bearer token. Upgrades a legacy raw-token
// row on sight (rolling-transition safety) and reports whether it did.
function findSessionByToken(bearer) {
  if (!bearer) return { session: null, upgraded: false };
  let upgraded = false;
  let session = db.sessions.find((s) => s.tokenHash === hashToken(bearer));
  if (!session) {
    const legacy = db.sessions.find((s) => s.token === bearer);
    if (legacy) {
      legacy.tokenHash = hashToken(bearer);
      delete legacy.token;
      if (!legacy.id) legacy.id = uid('s_');
      session = legacy;
      upgraded = true;
    }
  }
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return { session: null, upgraded };
  return { session, upgraded };
}

function secEvent(userId, kind, detail) {
  db.securityEvents.push({
    id: uid('se_'), userId, kind,
    detail: String(detail || '').slice(0, 200),
    at: new Date().toISOString()
  });
  const mine = db.securityEvents.filter((e) => e.userId === userId);
  if (mine.length > SECURITY_EVENT_CAP) {
    const drop = new Set(mine.slice(0, mine.length - SECURITY_EVENT_CAP).map((e) => e.id));
    db.securityEvents = db.securityEvents.filter((e) => !drop.has(e.id));
  }
}

// Public session shape — never includes tokenHash or raw tokens.
const publicSession = (s, currentId) => ({
  id: s.id, current: s.id === currentId, device: s.device || 'Unknown device',
  createdAt: s.createdAt, expiresAt: s.expiresAt, lastSeenAt: s.lastSeenAt || null
});

function audit(userId, action, entity, entityId, detail) {
  db.audit.push({
    id: uid('a_'), userId, action, entity, entityId: entityId || null,
    detail: detail || '', at: new Date().toISOString()
  });
  if (db.audit.length > 2000) db.audit = db.audit.slice(-2000);
}

// ── Auth helpers (scrypt hashing, opaque bearer tokens) ──
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createUser(email, password, name) {
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: uid('u_'),
    email: email.toLowerCase().trim(),
    name: name || email.split('@')[0],
    salt,
    hash: hashPassword(password, salt),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  return user;
}

function verifyPassword(user, password) {
  try {
    const h = hashPassword(password, user.salt);
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(user.hash, 'hex'));
  } catch {
    return false;
  }
}

function ensureUserDefaults(user) {
  if (!db.budgets.some((b) => b.userId === user.id)) {
    for (const [category, amount] of Object.entries(DEFAULT_BUDGETS)) {
      db.budgets.push({ userId: user.id, category, amount });
    }
  }
  if (!db.accounts.some((a) => a.userId === user.id)) {
    const now = new Date().toISOString();
    for (const a of DEFAULT_ACCOUNTS_SEED) {
      db.accounts.push({
        id: uid('ac_'), userId: user.id, name: a.name, type: a.type,
        institution: a.institution, openingPaise: 0, status: 'active',
        createdAt: now, updatedAt: now
      });
    }
  }
  if (!db.preferences.some((p) => p.userId === user.id)) {
    db.preferences.push({
      userId: user.id, theme: 'light', currency: 'INR',
      timezone: 'Asia/Kolkata', fyStartMonth: 4, updatedAt: new Date().toISOString()
    });
  }
}

async function ensureDefaultUser() {
  if (isNeon) await refreshDbFromNeon();
  const email = DEFAULT_USER.email.toLowerCase();
  let user = db.users.find((u) => u.email === email);
  if (!user) {
    user = createUser(DEFAULT_USER.email, DEFAULT_USER.password, DEFAULT_USER.name);
    console.log(`Created default user ${DEFAULT_USER.email}`);
  } else {
    user.salt = crypto.randomBytes(16).toString('hex');
    user.hash = hashPassword(DEFAULT_USER.password, user.salt);
    if (!user.name) user.name = DEFAULT_USER.name;
  }
  ensureUserDefaults(user);
  await save();
}

await ensureDefaultUser();

async function pruneSessions() {
  const now = Date.now();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => Date.parse(s.expiresAt) > now);
  if (db.sessions.length !== before) await save();
}

function authMiddleware(req, res, next) {
  (async () => {
    if (isNeon) await refreshDbFromNeon();
    await pruneSessions();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { session, upgraded } = findSessionByToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  req.sessionId = session.id;
  // Throttled last-activity persistence: at most one extra write per hour,
  // so normal traffic doesn't pay a Neon round-trip per request.
  if (upgraded || !session.lastSeenAt || Date.now() - Date.parse(session.lastSeenAt) > LAST_SEEN_TTL_MS) {
    session.lastSeenAt = new Date().toISOString();
    await save();
  }
  next();
  })().catch((e) => {
    console.error('auth error:', e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });
}

// Simple in-memory login rate limit: 10 attempts / 5 min per IP+email.
const loginAttempts = new Map();
function loginRateLimited(key) {
  const now = Date.now();
  const arr = (loginAttempts.get(key) || []).filter((t) => now - t < 5 * 60 * 1000);
  arr.push(now);
  loginAttempts.set(key, arr);
  return arr.length > 10;
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, avatar: u.avatar || null });

// ── Ledger: balances derived from opening + ledger entries ────────────
// Asset account: opening + received − paid (completed only).
// Credit card:  opening liability + purchases − payments − credits.
// Transfers move money between accounts and never touch income/expense.
function accountBalances(userId) {
  const accs = db.accounts.filter((a) => a.userId === userId);
  const byName = new Map(accs.map((a) => [a.name, a]));
  const bal = new Map(accs.map((a) => [a.id, a.openingPaise || 0]));
  // Asset convention delta, negated for liability accounts (credit card:
  // purchases grow the outstanding balance, payments shrink it).
  const add = (name, delta) => {
    const a = byName.get(name);
    if (a) bal.set(a.id, bal.get(a.id) + (ASSET_TYPES.has(a.type) ? delta : -delta));
  };
  for (const t of db.transactions.filter((x) => x.userId === userId)) {
    if (t.status && t.status !== 'completed') continue; // pending/scheduled don't move money
    const p = t.amountPaise || 0;
    if (t.type === 'income') add(t.account, p);
    else if (t.type === 'expense') add(t.account, -p);
    else if (t.type === 'refund') add(t.account, p); // offsets the original expense
    else if (t.type === 'adjustment') add(t.account, p); // signed correction
    else if (t.type === 'transfer') {
      const from = t.accountFrom || t.account;
      const to = t.accountTo;
      if (from) add(from, -p);
      if (to) add(to, p);
    }
  }
  return accs.map((a) => ({
    id: a.id, name: a.name, type: a.type, institution: a.institution || '',
    status: a.status || 'active',
    openingPaise: a.openingPaise || 0,
    openingBalance: toRupees(a.openingPaise || 0),
    balancePaise: bal.get(a.id),
    balance: toRupees(bal.get(a.id)),
    isLiability: !ASSET_TYPES.has(a.type),
    createdAt: a.createdAt, updatedAt: a.updatedAt
  }));
}

// ── Validation ──
const TX_TYPES = new Set(['expense', 'income', 'transfer', 'refund', 'adjustment']);
const TX_STATUS = new Set(['completed', 'pending', 'scheduled']);

function validateTransaction(body) {
  const errors = [];
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) errors.push('date must be YYYY-MM-DD');
  if (!TX_TYPES.has(body.type)) errors.push('type must be expense | income | transfer | refund | adjustment');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push('amount must be a number > 0');
  if (body.type === 'transfer') {
    if (!body.accountFrom || !body.accountTo) errors.push('transfer requires accountFrom and accountTo');
    if (body.accountFrom && body.accountTo && body.accountFrom === body.accountTo) errors.push('transfer accounts must differ');
  } else if (!body.account || typeof body.account !== 'string') {
    errors.push('account is required');
  }
  if (!body.category || typeof body.category !== 'string') errors.push('category is required');
  if (body.status && !TX_STATUS.has(body.status)) errors.push('status must be completed | pending | scheduled');
  return errors;
}

function toClientTx(t) {
  return {
    id: t.id,
    date: t.date,
    type: t.type,
    amount: toRupees(t.amountPaise || 0),
    amountPaise: t.amountPaise || 0,
    category: t.category,
    subcategory: t.subcategory || '',
    paymentMethod: t.paymentMethod || null,
    account: t.account,
    accountFrom: t.accountFrom || null,
    accountTo: t.accountTo || null,
    merchant: t.merchant || '',
    description: t.description || '',
    upiRef: t.upiRef || '',
    tags: t.tags || [],
    status: t.status || 'completed',
    source: t.source || 'manual',
    isCreditCardRepayment: !!t.isCreditCardRepayment,
    createdAt: t.createdAt, updatedAt: t.updatedAt
  };
}

function buildTx(userId, b, existing) {
  const now = new Date().toISOString();
  const base = existing || {
    id: 'T' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex').toUpperCase(),
    userId, createdAt: now
  };
  return {
    ...base,
    userId,
    date: b.date,
    type: b.type,
    amountPaise: toPaise(b.amount),
    category: String(b.category).trim(),
    subcategory: (b.subcategory || '').toString().trim(),
    paymentMethod: b.paymentMethod || null,
    account: b.type === 'transfer' ? (b.accountFrom || '') : (b.account || 'Cash Wallet').toString().trim(),
    accountFrom: b.accountFrom || null,
    accountTo: b.accountTo || null,
    merchant: (b.merchant || '').toString().trim(),
    description: (b.description || '').toString().trim(),
    upiRef: (b.upiRef || '').toString().trim(),
    tags: Array.isArray(b.tags) ? b.tags.map(String).slice(0, 10) : [],
    status: b.status || 'completed',
    source: b.source || existing?.source || 'manual',
    isCreditCardRepayment: b.isCreditCardRepayment === true || b.isCreditCardRepayment === 1,
    updatedAt: now
  };
}

// ── Middleware ──
// 8 MB so versioned backups (up to BACKUP_MAX_TRANSACTIONS rows) survive the
// JSON parser; portability routes additionally enforce BACKUP_MAX_BYTES with
// a clear 413. Note: Vercel caps serverless bodies at ~4.5 MB — larger
// restores must run against a local server (documented in README).
app.use(express.json({ limit: '8mb' }));
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'Request body too large (max 8 MB). For big restores, run the server locally with `npm start`.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body.' });
  }
  next(err);
});

// ── Auth API ──
app.post('/api/auth/signup', async (req, res) => {
  if (isNeon) await refreshDbFromNeon();
  const { email, password, name } = req.body || {};
  const cleanEmail = String(email || '').toLowerCase().trim();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (loginRateLimited(`${req.ip}:signup:${cleanEmail}`)) {
    return res.status(429).json({ error: 'Too many signup attempts — try again in a few minutes' });
  }
  if (db.users.some((u) => u.email === cleanEmail)) {
    return res.status(409).json({ error: 'An account with this email already exists — please log in' });
  }
  const cleanName = String(name || '').trim().slice(0, 80) || cleanEmail.split('@')[0];
  const user = createUser(cleanEmail, String(password), cleanName);
  ensureUserDefaults(user);
  const { record, token } = createSessionRecord(user.id, coarseDevice(req.headers['user-agent']));
  db.sessions.push(record);
  audit(user.id, 'signup', 'user', user.id, cleanEmail);
  secEvent(user.id, 'login', 'New account sign-up');
  await save();
  res.status(201).json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  if (isNeon) await refreshDbFromNeon();
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (loginRateLimited(`${req.ip}:${String(email).toLowerCase()}`)) {
    return res.status(429).json({ error: 'Too many login attempts — try again in a few minutes' });
  }
  const user = db.users.find((u) => u.email === String(email).toLowerCase().trim());
  if (!user || !verifyPassword(user, String(password))) {
    // Failed sign-in is recorded against a known account only — and never
    // with the attempted password. Unknown emails are not logged (no owner).
    if (user) { secEvent(user.id, 'login_failed', 'Failed sign-in attempt'); await save(); }
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const { record, token } = createSessionRecord(user.id, coarseDevice(req.headers['user-agent']));
  db.sessions.push(record);
  audit(user.id, 'login', 'session', null, '');
  secEvent(user.id, 'login', `Signed in (${record.device})`);
  await save();
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  db.sessions = db.sessions.filter((s) => !(s.userId === req.user.id && s.id === req.sessionId));
  secEvent(req.user.id, 'logout', 'Signed out');
  await save();
  res.json({ ok: true });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  const { current, next } = req.body || {};
  if (!current || !next || String(next).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (!verifyPassword(req.user, String(current))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  req.user.salt = crypto.randomBytes(16).toString('hex');
  req.user.hash = hashPassword(String(next), req.user.salt);
  req.user.passwordUpdatedAt = new Date().toISOString();
  // All other devices are signed out; the current session stays valid so the
  // user is not unexpectedly logged out mid-flow.
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => !(s.userId === req.user.id && s.id !== req.sessionId));
  const revoked = before - db.sessions.length;
  audit(req.user.id, 'change_password', 'user', req.user.id, '');
  secEvent(req.user.id, 'password_changed',
    revoked > 0 ? `Password changed; ${revoked} other session(s) signed out` : 'Password changed');
  await save();
  res.json({ ok: true, otherSessionsRevoked: revoked });
});

// ── Profile API (display name + avatar) ──
const AVATAR_EMOJI = new Set(['😀', '😎', '🦊', '🐼', '🦁', '🐸', '🦄', '🐝', '🌟', '⚡', '💎', '🚀', '🌈', '🍀', '🔥', '💰']);
const AVATAR_COLORS = new Set(['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#14b8a6', '#6366f1']);

app.put('/api/auth/profile', authMiddleware, async (req, res) => {
  const { name, avatar } = req.body || {};
  if (name !== undefined) {
    const clean = String(name).trim().slice(0, 80);
    if (!clean) return res.status(400).json({ error: 'Display name cannot be empty' });
    req.user.name = clean;
  }
  if (avatar !== undefined) {
    if (avatar !== null) {
      if (typeof avatar !== 'object') return res.status(400).json({ error: 'Invalid avatar' });
      const { emoji, color } = avatar;
      if (!AVATAR_EMOJI.has(emoji)) return res.status(400).json({ error: 'Invalid avatar emoji' });
      if (!AVATAR_COLORS.has(color)) return res.status(400).json({ error: 'Invalid avatar color' });
      req.user.avatar = { emoji, color };
    } else {
      req.user.avatar = null;
    }
  }
  audit(req.user.id, 'update_profile', 'user', req.user.id, '');
  await save();
  res.json({ user: publicUser(req.user) });
});

// ── Forgot / reset password (self-hosted: code returned in-API) ──
// No email service is configured, so the 6-digit reset code is returned by
// the forgot-password call and shown in the UI. Codes expire after 15
// minutes, are single-use, and lock after 5 wrong attempts.
const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;

app.post('/api/auth/forgot-password', async (req, res) => {
  if (isNeon) await refreshDbFromNeon();
  const cleanEmail = String(req.body?.email || '').toLowerCase().trim();
  if (!cleanEmail) return res.status(400).json({ error: 'Email address is required' });
  if (loginRateLimited(`${req.ip}:forgot:${cleanEmail}`)) {
    return res.status(429).json({ error: 'Too many attempts — try again in a few minutes' });
  }
  const user = db.users.find((u) => u.email === cleanEmail);
  if (!user) return res.status(404).json({ error: 'No account found with this email' });
  // Invalidate older unused codes for this user.
  db.resets = (db.resets || []).filter((x) => x.userId !== user.id || x.usedAt);
  const code = String(crypto.randomInt(100000, 1000000));
  db.resets.push({
    id: uid('pr_'), userId: user.id,
    codeHash: crypto.createHash('sha256').update(code).digest('hex'),
    attempts: 0, createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString(),
    usedAt: null
  });
  audit(user.id, 'forgot_password', 'user', user.id, '');
  await save();
  res.json({ ok: true, resetCode: code, expiresInMinutes: 15 });
});

app.post('/api/auth/reset-password', async (req, res) => {
  if (isNeon) await refreshDbFromNeon();
  const cleanEmail = String(req.body?.email || '').toLowerCase().trim();
  const code = String(req.body?.code || '').trim();
  const next = req.body?.newPassword;
  if (!cleanEmail || !code) return res.status(400).json({ error: 'Email and reset code are required' });
  if (!next || String(next).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const user = db.users.find((u) => u.email === cleanEmail);
  if (!user) return res.status(404).json({ error: 'No account found with this email' });
  const now = Date.now();
  const rec = (db.resets || [])
    .filter((x) => x.userId === user.id && !x.usedAt && Date.parse(x.expiresAt) > now)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (!rec) return res.status(400).json({ error: 'No active reset code — please request a new one' });
  if (rec.attempts >= RESET_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many wrong attempts — please request a new code' });
  }
  let match = false;
  try {
    const a = Buffer.from(crypto.createHash('sha256').update(code).digest('hex'), 'hex');
    const b = Buffer.from(rec.codeHash, 'hex');
    match = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { match = false; }
  if (!match) {
    rec.attempts += 1;
    await save();
    return res.status(401).json({ error: `Incorrect code (${RESET_MAX_ATTEMPTS - rec.attempts} attempts left)` });
  }
  rec.usedAt = new Date().toISOString();
  user.salt = crypto.randomBytes(16).toString('hex');
  user.hash = hashPassword(String(next), user.salt);
  user.passwordUpdatedAt = new Date().toISOString();
  // Log out everywhere — the password changed, so all sessions die.
  db.sessions = db.sessions.filter((s) => s.userId !== user.id);
  audit(user.id, 'reset_password', 'user', user.id, '');
  secEvent(user.id, 'password_reset', 'Password reset via code; all sessions signed out');
  await save();
  res.json({ ok: true });
});

// ── Security & Privacy Control Room ──
app.get('/api/security/sessions', authMiddleware, async (req, res) => {
  const rows = db.sessions.filter((s) => s.userId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((s) => publicSession(s, req.sessionId));
  res.json({ sessions: rows });
});

app.post('/api/security/sessions/:id/revoke', authMiddleware, async (req, res) => {
  const s = db.sessions.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const wasCurrent = s.id === req.sessionId;
  db.sessions = db.sessions.filter((x) => x.id !== s.id);
  secEvent(req.user.id, 'session_revoked', wasCurrent ? 'Current session revoked' : 'A session was revoked');
  await save();
  res.json({ ok: true, revokedCurrent: wasCurrent });
});

app.post('/api/security/sessions/revoke-others', authMiddleware, async (req, res) => {
  const before = db.sessions.filter((s) => s.userId === req.user.id).length;
  db.sessions = db.sessions.filter((s) => !(s.userId === req.user.id && s.id !== req.sessionId));
  const revoked = before - db.sessions.filter((s) => s.userId === req.user.id).length;
  secEvent(req.user.id, 'sessions_revoked_others', `${revoked} other session(s) signed out`);
  await save();
  res.json({ ok: true, revoked });
});

app.get('/api/security/events', authMiddleware, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const rows = db.securityEvents.filter((e) => e.userId === req.user.id)
    .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  res.json({ events: rows });
});

app.get('/api/security/overview', authMiddleware, async (req, res) => {
  const sessions = db.sessions.filter((s) => s.userId === req.user.id);
  const current = sessions.find((s) => s.id === req.sessionId) || null;
  const events = db.securityEvents.filter((e) => e.userId === req.user.id)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const logins = events.filter((e) => e.kind === 'login');
  res.json({
    sessions: sessions.length,
    currentSession: current ? publicSession(current, req.sessionId) : null,
    lastLoginAt: logins.length ? logins[0].at : null,
    passwordUpdatedAt: req.user.passwordUpdatedAt || null,
    recentEvents: events.slice(0, 5)
  });
});

app.post('/api/security/delete-account', authMiddleware, async (req, res) => {
  const { password, confirmation } = req.body || {};
  if (loginRateLimited(`${req.ip}:delete:${req.user.id}`)) {
    return res.status(429).json({ error: 'Too many attempts — try again in a few minutes' });
  }
  if (!password || !verifyPassword(req.user, String(password))) {
    secEvent(req.user.id, 'deletion_failed', 'Deletion attempted with wrong password');
    await save();
    return res.status(401).json({ error: 'Password is incorrect' });
  }
  if (confirmation !== 'DELETE MY ACCOUNT') {
    secEvent(req.user.id, 'deletion_failed', 'Deletion attempted without the confirmation phrase');
    await save();
    return res.status(400).json({ error: 'Type DELETE MY ACCOUNT to confirm' });
  }
  const id = req.user.id;
  // Delete every owned row across all collections (users handled by id).
  // securityEvents included: deletion is total, no tombstone remains.
  // No external files exist in this phase — nothing else to remove.
  for (const k of Object.keys(emptyDb())) {
    if (k === 'users') continue;
    db[k] = db[k].filter((x) => x && x.userId !== id);
  }
  db.users = db.users.filter((u) => u.id !== id);
  await save();
  res.json({ ok: true });
});

// ── Transactions API ──
app.get('/api/transactions', authMiddleware, async (req, res) => {
  const rows = db.transactions
    .filter((t) => t.userId === req.user.id)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map(toClientTx);
  res.json({ transactions: rows });
});

app.post('/api/transactions', authMiddleware, async (req, res) => {
  const errors = validateTransaction(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const tx = buildTx(req.user.id, req.body);
  db.transactions.push(tx);
  audit(req.user.id, 'create', 'transaction', tx.id, `${tx.type} ${tx.date} ${toRupees(tx.amountPaise)}`);
  await save();
  // Autopilot never blocks the write — failures are swallowed after logging.
  try {
    await evaluateTransactionTriggers(req.user.id, toClientTx(tx));
    await evaluateBudgetTrigger(req.user.id, tx.date.slice(0, 7));
  } catch (e) { console.error('autopilot hook failed:', e?.message || e); }
  res.status(201).json({ transaction: toClientTx(tx) });
});

app.put('/api/transactions/:id', authMiddleware, async (req, res) => {
  const tx = db.transactions.find((t) => t.id === req.params.id && t.userId === req.user.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  const errors = validateTransaction(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  Object.assign(tx, buildTx(req.user.id, req.body, tx));
  audit(req.user.id, 'update', 'transaction', tx.id, `${tx.type} ${tx.date} ${toRupees(tx.amountPaise)}`);
  await save();
  res.json({ transaction: toClientTx(tx) });
});

app.delete('/api/transactions/:id', authMiddleware, async (req, res) => {
  const idx = db.transactions.findIndex((t) => t.id === req.params.id && t.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Transaction not found' });
  const [gone] = db.transactions.splice(idx, 1);
  audit(req.user.id, 'delete', 'transaction', gone.id, `${gone.type} ${gone.date}`);
  await save();
  res.json({ ok: true });
});

// ── CSV import with preview + duplicate detection + idempotency ──
function txFingerprint(t) {
  return [t.date, t.type, t.amountPaise, t.account || t.accountFrom, t.merchant, t.upiRef]
    .map((v) => String(v ?? '')).join('|').toLowerCase();
}

app.post('/api/import/preview', authMiddleware, async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length > 2000) return res.status(400).json({ error: 'Max 2000 rows per import' });
  const existing = new Set(
    db.transactions.filter((t) => t.userId === req.user.id).map(txFingerprint)
  );
  const seen = new Set();
  const out = rows.map((raw, i) => {
    const norm = normalizeImportRow(raw || {});
    const r = norm.row;
    // Bank-side dead rows (failed/cancelled — no money moved) surface as
    // clear skip reasons instead of cryptic validation errors.
    const errors = norm.skipped ? [norm.reason] : validateTransaction(r);
    const cand = { ...r, amountPaise: Number.isFinite(Number(r.amount)) ? toPaise(r.amount) : NaN };
    const fp = errors.length ? null : txFingerprint(cand);
    const dupExisting = fp && existing.has(fp);
    const dupBatch = fp && seen.has(fp);
    if (fp) seen.add(fp);
    return { index: i, row: r, errors, duplicate: !!(dupExisting || dupBatch), duplicateReason: dupExisting ? 'matches an existing transaction' : dupBatch ? 'duplicate within this file' : null };
  });
  res.json({
    total: rows.length,
    valid: out.filter((o) => !o.errors.length && !o.duplicate).length,
    duplicates: out.filter((o) => o.duplicate).length,
    invalid: out.filter((o) => o.errors.length).length,
    rows: out
  });
});

app.post('/api/import/confirm', authMiddleware, async (req, res) => {
  const { rows, key } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
  if (key) {
    const prior = db.imports.find((x) => x.userId === req.user.id && x.key === key);
    if (prior) return res.json({ ok: true, imported: 0, skipped: rows.length, deduped: true, note: 'Idempotency key already processed — nothing imported twice.' });
  }
  const existing = new Set(
    db.transactions.filter((t) => t.userId === req.user.id).map(txFingerprint)
  );
  let imported = 0, skipped = 0;
  const importedTxns = [];
  for (const raw of rows) {
    if (!raw || raw.include === false) { skipped++; continue; }
    const norm = normalizeImportRow(raw);
    if (norm.skipped) { skipped++; continue; }
    const r = norm.row;
    if (validateTransaction(r).length) { skipped++; continue; }
    const cand = { ...r, amountPaise: toPaise(r.amount) };
    if (existing.has(txFingerprint(cand))) { skipped++; continue; }
    const tx = { ...buildTx(req.user.id, { ...r, source: 'imported' }) };
    db.transactions.push(tx);
    existing.add(txFingerprint({ ...cand }));
    if (importedTxns.length < 100) importedTxns.push(toClientTx(tx));
    imported++;
  }
  if (key) db.imports.push({ key, userId: req.user.id, createdAt: new Date().toISOString(), rowCount: imported });
  audit(req.user.id, 'import', 'transactions', null, `imported=${imported} skipped=${skipped}`);
  await save();
  try {
    for (const t of importedTxns) await evaluateTransactionTriggers(req.user.id, t);
    if (importedTxns.length) await evaluateBudgetTrigger(req.user.id, importedTxns[0].date.slice(0, 7));
  } catch (e) { console.error('autopilot hook failed:', e?.message || e); }
  res.json({ ok: true, imported, skipped });
});

// ── Budgets API ──
app.get('/api/budgets', authMiddleware, async (req, res) => {
  const out = { ...DEFAULT_BUDGETS };
  for (const b of db.budgets.filter((x) => x.userId === req.user.id)) out[b.category] = b.amount;
  res.json({ budgets: out });
});

app.put('/api/budgets', authMiddleware, async (req, res) => {
  const budgets = (req.body && req.body.budgets) || {};
  for (const [category, raw] of Object.entries(budgets)) {
    const amount = Number(raw);
    if (!category || !Number.isFinite(amount) || amount < 0) continue;
    const existing = db.budgets.find((b) => b.userId === req.user.id && b.category === category);
    if (existing) existing.amount = amount;
    else db.budgets.push({ userId: req.user.id, category, amount });
  }
  audit(req.user.id, 'update', 'budgets', null, '');
  await save();
  const out = { ...DEFAULT_BUDGETS };
  for (const b of db.budgets.filter((x) => x.userId === req.user.id)) out[b.category] = b.amount;
  res.json({ budgets: out });
});

// ── Accounts API (ledger-derived balances) ──
app.get('/api/accounts', authMiddleware, async (req, res) => {
  res.json({ accounts: accountBalances(req.user.id) });
});

app.post('/api/accounts', authMiddleware, async (req, res) => {
  const { name, type, institution, openingBalance, status } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Account name is required' });
  if (!ACCOUNT_TYPES.has(type)) return res.status(400).json({ error: 'Invalid account type' });
  if (db.accounts.some((a) => a.userId === req.user.id && a.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: 'An account with this name already exists' });
  }
  const now = new Date().toISOString();
  const acc = {
    id: uid('ac_'), userId: req.user.id, name: name.trim(), type,
    institution: (institution || '').trim(), openingPaise: toPaise(Number(openingBalance) || 0),
    status: status || 'active', createdAt: now, updatedAt: now
  };
  db.accounts.push(acc);
  audit(req.user.id, 'create', 'account', acc.id, name);
  await save();
  res.status(201).json({ account: accountBalances(req.user.id).find((a) => a.id === acc.id) });
});

app.put('/api/accounts/:id', authMiddleware, async (req, res) => {
  const acc = db.accounts.find((a) => a.id === req.params.id && a.userId === req.user.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const { name, type, institution, openingBalance, status } = req.body || {};
  if (name && db.accounts.some((a) => a.userId === req.user.id && a.id !== acc.id && a.name.toLowerCase() === String(name).toLowerCase())) {
    return res.status(400).json({ error: 'An account with this name already exists' });
  }
  // Renaming an account re-points ledger rows so history follows the account.
  if (name && name.trim() !== acc.name) {
    const old = acc.name;
    for (const t of db.transactions.filter((x) => x.userId === req.user.id)) {
      if (t.account === old) t.account = name.trim();
      if (t.accountFrom === old) t.accountFrom = name.trim();
      if (t.accountTo === old) t.accountTo = name.trim();
    }
    acc.name = name.trim();
  }
  if (type && ACCOUNT_TYPES.has(type)) acc.type = type;
  if (institution !== undefined) acc.institution = String(institution).trim();
  if (openingBalance !== undefined) acc.openingPaise = toPaise(Number(openingBalance) || 0);
  if (status) acc.status = status;
  acc.updatedAt = new Date().toISOString();
  audit(req.user.id, 'update', 'account', acc.id, acc.name);
  await save();
  res.json({ account: accountBalances(req.user.id).find((a) => a.id === acc.id) });
});

app.delete('/api/accounts/:id', authMiddleware, async (req, res) => {
  const acc = db.accounts.find((a) => a.id === req.params.id && a.userId === req.user.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const used = db.transactions.some((t) => t.userId === req.user.id &&
    (t.account === acc.name || t.accountFrom === acc.name || t.accountTo === acc.name));
  if (used) return res.status(400).json({ error: 'Account has transactions — move or delete them first' });
  db.accounts = db.accounts.filter((a) => a.id !== acc.id);
  audit(req.user.id, 'delete', 'account', acc.id, acc.name);
  await save();
  res.json({ ok: true });
});

// ── Custom categories API ──
app.get('/api/categories', authMiddleware, async (req, res) => {
  res.json({ categories: db.categories.filter((c) => c.userId === req.user.id) });
});

app.post('/api/categories', authMiddleware, async (req, res) => {
  const { name, kind, color, icon, parent } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Category name is required' });
  if (kind && !['expense', 'income'].includes(kind)) return res.status(400).json({ error: 'Invalid kind' });
  if (db.categories.some((c) => c.userId === req.user.id && c.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: 'Category already exists' });
  }
  const cat = {
    id: uid('c_'), userId: req.user.id, name: name.trim(), kind: kind || 'expense',
    color: color || '#3b82f6', icon: (icon || '').slice(0, 4), parent: parent || null,
    createdAt: new Date().toISOString()
  };
  db.categories.push(cat);
  audit(req.user.id, 'create', 'category', cat.id, cat.name);
  await save();
  res.status(201).json({ category: cat });
});

app.delete('/api/categories/:id', authMiddleware, async (req, res) => {
  const cat = db.categories.find((c) => c.id === req.params.id && c.userId === req.user.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  const used = db.transactions.some((t) => t.userId === req.user.id && t.category === cat.name);
  if (used) return res.status(400).json({ error: 'Category is used by transactions' });
  db.categories = db.categories.filter((c) => c.id !== cat.id);
  audit(req.user.id, 'delete', 'category', cat.id, cat.name);
  await save();
  res.json({ ok: true });
});

// ── UPI IDs API ──
app.get('/api/upi', authMiddleware, async (req, res) => {
  res.json({ upiIds: db.upiIds.filter((u) => u.userId === req.user.id) });
});

app.post('/api/upi', authMiddleware, async (req, res) => {
  const { upiId, accountId } = req.body || {};
  if (!upiId || !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(String(upiId).trim())) {
    return res.status(400).json({ error: 'Invalid UPI ID (expected name@bank)' });
  }
  if (db.upiIds.some((u) => u.userId === req.user.id && u.upiId.toLowerCase() === String(upiId).toLowerCase())) {
    return res.status(400).json({ error: 'UPI ID already saved' });
  }
  const row = {
    id: uid('upi_'), userId: req.user.id, upiId: String(upiId).trim(),
    accountId: accountId || null, createdAt: new Date().toISOString()
  };
  db.upiIds.push(row);
  audit(req.user.id, 'create', 'upi', row.id, row.upiId);
  await save();
  res.status(201).json({ upi: row });
});

app.delete('/api/upi/:id', authMiddleware, async (req, res) => {
  const row = db.upiIds.find((u) => u.id === req.params.id && u.userId === req.user.id);
  if (!row) return res.status(404).json({ error: 'UPI ID not found' });
  db.upiIds = db.upiIds.filter((u) => u.id !== row.id);
  audit(req.user.id, 'delete', 'upi', row.id, row.upiId);
  await save();
  res.json({ ok: true });
});

// ── Savings goals API (target + deadline + auto-allocated ledger progress) ──
// Auto-allocation is explainable: a goal optionally links an account
// (e.g. an investment account receiving SIP transfers) and/or a category.
// Completed transfers INTO the linked account + completed income in the
// linked account/category + any txn tagged `goal:<name>` count automatically.
// Manual contributions stack on top; totals never double-count income.
function goalAutoProgress(userId, goal) {
  const linkedAccount = (goal.linkedAccount || '').toLowerCase();
  const linkedCategory = (goal.linkedCategory || '').toLowerCase();
  const tag = `goal:${(goal.name || '').toLowerCase()}`;
  const nameNeedle = (goal.name || '').toLowerCase();
  let autoPaise = 0, autoCount = 0;
  const matched = [];
  if (!linkedAccount && !linkedCategory) {
    // Fallback: only explicit goal-tagged savings count.
    for (const t of db.transactions.filter((x) => x.userId === userId)) {
      if (t.status && t.status !== 'completed') continue;
      const tags = (t.tags || []).map((x) => String(x).toLowerCase());
      if (!tags.includes(tag)) continue;
      if (t.type === 'income' || t.type === 'transfer') {
        autoPaise += t.amountPaise || 0; autoCount++;
        matched.push(t.id);
      }
    }
    return { autoPaise, autoCount, matchedIds: matched };
  }
  for (const t of db.transactions.filter((x) => x.userId === userId)) {
    if (t.status && t.status !== 'completed') continue;
    const tags = (t.tags || []).map((x) => String(x).toLowerCase());
    const tagged = tags.includes(tag)
      || (nameNeedle && ((t.description || '').toLowerCase().includes(nameNeedle) || (t.merchant || '').toLowerCase().includes(nameNeedle)));
    let hit = false;
    if (t.type === 'transfer' && linkedAccount) {
      if ((t.accountTo || '').toLowerCase() === linkedAccount) {
        if (!linkedCategory || (t.category || '').toLowerCase() === linkedCategory) hit = true;
      }
    } else if (t.type === 'income') {
      const acctOk = !linkedAccount || (t.account || '').toLowerCase() === linkedAccount;
      const catOk = !linkedCategory || (t.category || '').toLowerCase() === linkedCategory;
      if ((linkedAccount || linkedCategory) && acctOk && catOk) hit = true;
    }
    if (tagged && (t.type === 'income' || t.type === 'transfer')) hit = true;
    if (hit) { autoPaise += t.amountPaise || 0; autoCount++; matched.push(t.id); }
  }
  return { autoPaise, autoCount, matchedIds: matched };
}

function enrichGoal(userId, g) {
  const { autoPaise, autoCount } = goalAutoProgress(userId, g);
  const currentPaise = g.currentPaise || 0;
  const totalPaise = currentPaise + autoPaise;
  const targetPaise = g.targetPaise || 0;
  let daysLeft = null, requiredPerMonth = null;
  if (g.targetDate) {
    const today = todayISO();
    const ms = Date.parse(g.targetDate) - Date.parse(today);
    daysLeft = Math.ceil(ms / 86400000);
    const remaining = Math.max(0, targetPaise - totalPaise);
    const monthsLeft = Math.max(1, Math.ceil(Math.max(0, daysLeft) / 30));
    requiredPerMonth = Math.ceil(remaining / monthsLeft);
  }
  return {
    ...g,
    target: toRupees(targetPaise), current: toRupees(currentPaise),
    auto: toRupees(autoPaise), autoPaise, autoCount,
    total: toRupees(totalPaise), totalPaise,
    progressPct: targetPaise > 0 ? Math.min(100, (totalPaise / targetPaise) * 100) : 0,
    daysLeft, requiredPerMonth: requiredPerMonth === null ? null : toRupees(requiredPerMonth),
    requiredPerMonthPaise: requiredPerMonth
  };
}

app.get('/api/goals', authMiddleware, async (req, res) => {
  const goals = db.goals.filter((g) => g.userId === req.user.id).map((g) => enrichGoal(req.user.id, g));
  res.json({ goals });
});

app.get('/api/goals/:id/transactions', authMiddleware, async (req, res) => {
  const goal = db.goals.find((g) => g.id === req.params.id && g.userId === req.user.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const { matchedIds } = goalAutoProgress(req.user.id, goal);
  const set = new Set(matchedIds);
  const rows = db.transactions.filter((t) => t.userId === req.user.id && set.has(t.id)).map(toClientTx);
  const contribs = db.contributions.filter((c) => c.goalId === goal.id && c.userId === req.user.id)
    .map((c) => ({ ...c, amount: toRupees(c.amountPaise || 0) }));
  res.json({ goal: enrichGoal(req.user.id, goal), autoTransactions: rows, contributions: contribs });
});

app.post('/api/goals', authMiddleware, async (req, res) => {
  const { name, target, targetDate, notes, linkedAccount, linkedCategory } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Goal name is required' });
  if (!Number.isFinite(Number(target)) || Number(target) <= 0) return res.status(400).json({ error: 'Target must be > 0' });
  const now = new Date().toISOString();
  const goal = {
    id: uid('g_'), userId: req.user.id, name: name.trim(), targetPaise: toPaise(target),
    currentPaise: 0, targetDate: targetDate || null, notes: (notes || '').slice(0, 500),
    linkedAccount: (linkedAccount || '').toString().trim() || null,
    linkedCategory: (linkedCategory || '').toString().trim() || null,
    status: 'active', createdAt: now, updatedAt: now
  };
  db.goals.push(goal);
  audit(req.user.id, 'create', 'goal', goal.id, goal.name);
  await save();
  res.status(201).json({ goal: enrichGoal(req.user.id, goal) });
});

app.put('/api/goals/:id', authMiddleware, async (req, res) => {
  const goal = db.goals.find((g) => g.id === req.params.id && g.userId === req.user.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const { name, target, targetDate, notes, linkedAccount, linkedCategory, status } = req.body || {};
  if (name !== undefined && String(name).trim()) goal.name = String(name).trim();
  if (target !== undefined) {
    if (!Number.isFinite(Number(target)) || Number(target) <= 0) return res.status(400).json({ error: 'Target must be > 0' });
    goal.targetPaise = toPaise(target);
  }
  if (targetDate !== undefined) goal.targetDate = targetDate || null;
  if (notes !== undefined) goal.notes = String(notes).slice(0, 500);
  if (linkedAccount !== undefined) goal.linkedAccount = String(linkedAccount).trim() || null;
  if (linkedCategory !== undefined) goal.linkedCategory = String(linkedCategory).trim() || null;
  if (status !== undefined && ['active', 'completed', 'paused'].includes(status)) goal.status = status;
  goal.updatedAt = new Date().toISOString();
  audit(req.user.id, 'update', 'goal', goal.id, goal.name);
  await save();
  res.json({ goal: enrichGoal(req.user.id, goal) });
});

app.post('/api/goals/:id/contribute', authMiddleware, async (req, res) => {
  const goal = db.goals.find((g) => g.id === req.params.id && g.userId === req.user.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const { amount, date, account, note } = req.body || {};
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be > 0' });
  const c = {
    id: uid('gc_'), userId: req.user.id, goalId: goal.id, amountPaise: toPaise(amount),
    date: date || new Date().toISOString().slice(0, 10), account: account || null,
    note: (note || '').slice(0, 300), createdAt: new Date().toISOString()
  };
  db.contributions.push(c);
  goal.currentPaise = (goal.currentPaise || 0) + c.amountPaise; // derived from contributions, never double-counted as income
  goal.updatedAt = new Date().toISOString();
  audit(req.user.id, 'contribute', 'goal', goal.id, `${toRupees(c.amountPaise)}`);
  await save();
  res.status(201).json({
    contribution: { ...c, amount: toRupees(c.amountPaise) },
    goal: enrichGoal(req.user.id, goal)
  });
});

app.delete('/api/goals/:id', authMiddleware, async (req, res) => {
  const goal = db.goals.find((g) => g.id === req.params.id && g.userId === req.user.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  db.goals = db.goals.filter((g) => g.id !== goal.id);
  db.contributions = db.contributions.filter((c) => c.goalId !== goal.id);
  audit(req.user.id, 'delete', 'goal', goal.id, goal.name);
  await save();
  res.json({ ok: true });
});

// ── Recurring rules API (auto-created on schedule) ──
const FREQS = new Set(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, lastDay));
  return dt.toISOString().slice(0, 10);
}

function nextOccurrenceISO(iso, frequency) {
  if (frequency === 'daily') return addDaysISO(iso, 1);
  if (frequency === 'weekly') return addDaysISO(iso, 7);
  if (frequency === 'monthly') return addMonthsISO(iso, 1);
  if (frequency === 'quarterly') return addMonthsISO(iso, 3);
  if (frequency === 'yearly') return addMonthsISO(iso, 12);
  return addMonthsISO(iso, 1);
}

function todayISO() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Auto-create completed ledger transactions for every due active rule.
// Idempotent: skips an occurrence when an identical recurring transaction
// (same date/type/amount/account/merchant) already exists.
async function processDueRecurring(userId, asOf) {
  const asOfISO = asOf || todayISO();
  let posted = 0;
  const existingFp = new Set(
    db.transactions.filter((t) => t.userId === userId).map(txFingerprint)
  );
  for (const rule of db.recurring.filter((r) => r.userId === userId)) {
    if (rule.status !== 'active') continue;
    if (rule.autoCreate === false) continue;
    if (!rule.nextDate) rule.nextDate = rule.startDate;
    let guard = 0;
    while (rule.nextDate && rule.nextDate <= asOfISO && guard < 24) {
      guard++;
      if (rule.endDate && rule.nextDate > rule.endDate) {
        rule.status = 'completed';
        break;
      }
      const amountPaise = rule.amountPaise || 0;
      const account = rule.account || 'Cash Wallet';
      const probe = {
        date: rule.nextDate, type: rule.type, amountPaise,
        account, merchant: rule.name, upiRef: ''
      };
      if (!existingFp.has(txFingerprint(probe))) {
        const now = new Date().toISOString();
        const tx = {
          id: 'T' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex').toUpperCase() + posted,
          userId,
          date: rule.nextDate,
          type: rule.type,
          amountPaise,
          category: rule.category || (rule.type === 'income' ? 'Salary' : 'Miscellaneous'),
          subcategory: '',
          paymentMethod: null,
          account,
          accountFrom: null,
          accountTo: null,
          merchant: rule.name,
          description: `Auto: ${rule.name} (${rule.frequency})`,
          upiRef: '',
          tags: ['recurring'],
          status: 'completed',
          source: 'recurring',
          isCreditCardRepayment: false,
          createdAt: now, updatedAt: now
        };
        db.transactions.push(tx);
        existingFp.add(txFingerprint({ ...probe }));
        posted++;
        audit(userId, 'auto_post', 'transaction', tx.id, `${rule.name} ${rule.nextDate}`);
      }
      rule.lastPostedDate = rule.nextDate;
      rule.lastRunAt = new Date().toISOString();
      rule.nextDate = nextOccurrenceISO(rule.nextDate, rule.frequency);
      if (rule.endDate && rule.nextDate > rule.endDate) {
        rule.status = 'completed';
        break;
      }
    }
    rule.updatedAt = new Date().toISOString();
  }
  if (posted > 0) await save();
  else await save();
  return { posted, asOf: asOfISO };
}
app.get('/api/recurring', authMiddleware, async (req, res) => {
  // Opening the app daily auto-posts anything due (rent, SIPs, subscriptions).
  const result = await processDueRecurring(req.user.id);
  const rows = db.recurring.filter((r) => r.userId === req.user.id)
    .map((r) => ({ ...r, amount: toRupees(r.amountPaise || 0) }));
  res.json({ recurring: rows, autoPosted: result.posted, asOf: result.asOf });
});

app.post('/api/recurring/run-due', authMiddleware, async (req, res) => {
  const result = await processDueRecurring(req.user.id, req.body?.asOf);
  const rows = db.recurring.filter((r) => r.userId === req.user.id)
    .map((r) => ({ ...r, amount: toRupees(r.amountPaise || 0) }));
  res.json({ ok: true, posted: result.posted, asOf: result.asOf, recurring: rows });
});

app.post('/api/recurring/:id/post-now', authMiddleware, async (req, res) => {
  const rule = db.recurring.find((r) => r.id === req.params.id && r.userId === req.user.id);
  if (!rule) return res.status(404).json({ error: 'Not found' });
  if (rule.status !== 'active') return res.status(400).json({ error: 'Only active rules can post' });
  const date = req.body?.date && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : todayISO();
  const tx = buildTx(req.user.id, {
    date,
    type: rule.type,
    amount: toRupees(rule.amountPaise || 0),
    category: rule.category || (rule.type === 'income' ? 'Salary' : 'Miscellaneous'),
    account: rule.account || 'Cash Wallet',
    merchant: rule.name,
    description: `Manual post: ${rule.name} (${rule.frequency})`,
    status: 'completed',
    source: 'recurring'
  });
  tx.tags = ['recurring'];
  db.transactions.push(tx);
  rule.lastPostedDate = date;
  rule.lastRunAt = new Date().toISOString();
  // Advance nextDate past the posted date so run-due won't duplicate it.
  if (rule.nextDate && rule.nextDate <= date) {
    let guard = 0;
    while (rule.nextDate <= date && guard < 24) {
      rule.nextDate = nextOccurrenceISO(rule.nextDate, rule.frequency);
      guard++;
      if (rule.endDate && rule.nextDate > rule.endDate) { rule.status = 'completed'; break; }
    }
  }
  rule.updatedAt = new Date().toISOString();
  audit(req.user.id, 'post_now', 'recurring', rule.id, `${rule.name} ${date}`);
  await save();
  res.status(201).json({ transaction: toClientTx(tx), rule: { ...rule, amount: toRupees(rule.amountPaise) } });
});

app.post('/api/recurring', authMiddleware, async (req, res) => {
  const { name, amount, type, frequency, account, category, startDate, endDate, autoCreate } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be > 0' });
  if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Type must be income | expense' });
  if (!FREQS.has(frequency)) return res.status(400).json({ error: 'Invalid frequency' });
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return res.status(400).json({ error: 'Valid startDate required' });
  const now = new Date().toISOString();
  const rule = {
    id: uid('r_'), userId: req.user.id, name: String(name).trim(), amountPaise: toPaise(amount),
    type, frequency, account: account || null, category: category || null,
    startDate, endDate: endDate || null, nextDate: startDate, status: 'active',
    autoCreate: autoCreate === false ? false : true,
    lastPostedDate: null, lastRunAt: null,
    createdAt: now, updatedAt: now
  };
  db.recurring.push(rule);
  audit(req.user.id, 'create', 'recurring', rule.id, rule.name);
  await save();
  // Immediately post if the start date is already due.
  const result = await processDueRecurring(req.user.id);
  const fresh = db.recurring.find((r) => r.id === rule.id);
  res.status(201).json({ rule: { ...fresh, amount: toRupees(fresh.amountPaise) }, autoPosted: result.posted });
});

app.put('/api/recurring/:id', authMiddleware, async (req, res) => {
  const rule = db.recurring.find((r) => r.id === req.params.id && r.userId === req.user.id);
  if (!rule) return res.status(404).json({ error: 'Not found' });
  const { status, autoCreate } = req.body || {};
  if (status !== undefined) {
    if (!['active', 'paused', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    rule.status = status;
  }
  if (autoCreate !== undefined) rule.autoCreate = autoCreate !== false;
  rule.updatedAt = new Date().toISOString();
  await save();
  res.json({ rule: { ...rule, amount: toRupees(rule.amountPaise) } });
});

app.delete('/api/recurring/:id', authMiddleware, async (req, res) => {
  const rule = db.recurring.find((r) => r.id === req.params.id && r.userId === req.user.id);
  if (!rule) return res.status(404).json({ error: 'Not found' });
  db.recurring = db.recurring.filter((r) => r.id !== rule.id);
  await save();
  res.json({ ok: true });
});

// ── Financial Autopilot (rule engine + notifications) ──
// Rules never move real money: the only ledger write is a `scheduled` draft
// (or a pending-approval item the user explicitly approves). Runs are
// idempotent per (rule, trigger, entity) and only fired runs are logged.
import {
  validateRule, matchConditions, detectSalary,
  isUnusualAmount, budgetBreaches, monthSummary, previousMonthPrefix,
  idempotencyKey
} from './src/services/autopilotEngine.js';
import {
  BACKUP_FORMAT, BACKUP_VERSION, BACKUP_APP_VERSION, BACKUP_MAX_BYTES, normalizeBackup, validateBackupData,
  summarizeBackup, buildAccountCsv, buildManifest, verifyManifest, diffPreview,
  RESTORE_REPLACE_PHRASE
} from './src/services/portability.js';

const RUNS_CAP = 500;
const NOTIF_CAP = 200;

function logAutopilotRun(userId, ruleId, trigger, key, decision, detail) {
  db.autopilotRuns.push({
    id: uid('aru_'), userId, ruleId, trigger, key,
    decision, detail: String(detail || '').slice(0, 300),
    at: new Date().toISOString()
  });
  const mine = db.autopilotRuns.filter((r) => r.userId === userId);
  if (mine.length > RUNS_CAP) {
    const drop = new Set(mine.slice(0, mine.length - RUNS_CAP).map((r) => r.id));
    db.autopilotRuns = db.autopilotRuns.filter((r) => !drop.has(r.id));
  }
}

function pushNotification(userId, n) {
  const row = {
    id: uid('nt_'), userId, kind: n.kind || 'info',
    title: String(n.title || '').slice(0, 120),
    body: String(n.body || '').slice(0, 1000),
    payload: n.payload || null, ruleId: n.ruleId || null,
    status: 'unread', createdAt: new Date().toISOString()
  };
  db.notifications.push(row);
  const mine = db.notifications.filter((x) => x.userId === userId);
  if (mine.length > NOTIF_CAP) {
    const drop = new Set(mine.slice(0, mine.length - NOTIF_CAP).map((x) => x.id));
    db.notifications = db.notifications.filter((x) => !drop.has(x.id));
  }
  return row;
}

// Execute a fired rule's actions. Returns counts. Never throws.
function executeAutopilotActions(userId, rule, context) {
  let notified = 0, drafts = 0, pending = 0;
  for (const a of rule.actions || []) {
    try {
      if (a.kind === 'notify' || a.kind === 'suggest') {
        pushNotification(userId, {
          kind: a.kind === 'suggest' ? 'suggestion' : 'info',
          title: rule.name, body: a.message, ruleId: rule.id,
          payload: a.kind === 'suggest' && a.category ? { suggestedCategory: a.category } : null
        });
        notified++;
      } else if (a.kind === 'create_draft') {
        const draft = {
          date: todayISO(), type: a.txType,
          amount: context.amount,
          category: a.category, account: a.account,
          merchant: (a.merchant || `Autopilot: ${rule.name}`).slice(0, 120),
          description: (a.note || `Draft prepared by autopilot rule "${rule.name}"`).slice(0, 300),
          status: 'scheduled', source: 'autopilot', tags: ['autopilot']
        };
        if (rule.requireApproval !== false) {
          pushNotification(userId, {
            kind: 'approval', title: `Approve draft: ${rule.name}`,
            body: `${a.txType === 'income' ? '+' : '−'}₹${draft.amount} · ${draft.category} · ${draft.account}. Approve to add as a scheduled draft (never moves money by itself).`,
            ruleId: rule.id, payload: { draft }
          });
          pending++;
        } else {
          db.transactions.push(buildTx(userId, draft));
          pushNotification(userId, {
            kind: 'info', title: `Draft created: ${rule.name}`, ruleId: rule.id,
            body: `Scheduled ${draft.type} of ₹${draft.amount} (${draft.category}) saved as a draft. Review or delete it in Transactions.`
          });
          drafts++;
        }
      }
    } catch (e) {
      logAutopilotRun(userId, rule.id, rule.trigger,
        idempotencyKey(rule.id, rule.trigger, context.ref || 'action'),
        'error', e?.message || 'action failed');
    }
  }
  return { notified, drafts, pending };
}

function fireAutopilotRule(userId, rule, ref, context, detail) {
  const key = idempotencyKey(rule.id, rule.trigger, ref);
  if (db.autopilotRuns.some((r) => r.userId === userId && r.key === key)) {
    return { fired: false, reason: 'idempotent replay skipped' };
  }
  const out = executeAutopilotActions(userId, rule, { ...context, ref });
  rule.runCount = (rule.runCount || 0) + 1;
  rule.lastRunAt = new Date().toISOString();
  logAutopilotRun(userId, rule.id, rule.trigger, key, 'fired',
    `${detail} → notify=${out.notified} drafts=${out.drafts} pending=${out.pending}`);
  return { fired: true, ...out };
}

// Trigger group 1 — evaluated automatically on every created transaction.
async function evaluateTransactionTriggers(userId, clientTxn) {
  const rules = db.autopilotRules.filter((r) => r.userId === userId && r.status === 'active' &&
    ['transaction_added', 'salary_detected', 'unusual_transaction'].includes(r.trigger));
  if (!rules.length) return { evaluated: 0, fired: 0 };
  let history = null;
  const needHistory = rules.some((r) => r.trigger === 'unusual_transaction');
  if (needHistory) {
    const cutoff = addDaysISO(todayISO(), -90);
    history = db.transactions
      .filter((t) => t.userId === userId && t.type === 'expense' &&
        (!t.status || t.status === 'completed') && t.date >= cutoff)
      .map((t) => toRupees(t.amountPaise || 0));
  }
  let evaluated = 0, fired = 0;
  for (const rule of rules) {
    evaluated++;
    if (rule.trigger === 'salary_detected' && !detectSalary(clientTxn)) continue;
    if (rule.trigger === 'unusual_transaction') {
      const chk = isUnusualAmount(clientTxn.amount, history);
      if (!chk.unusual) continue;
      if (!matchConditions(clientTxn, rule.conditions)) continue;
      if (fireAutopilotRule(userId, rule, clientTxn.id, clientTxn, `unusual: ${chk.reason}`).fired) fired++;
      continue;
    }
    if (!matchConditions(clientTxn, rule.conditions)) continue;
    const detail = rule.trigger === 'salary_detected'
      ? `salary detected: ${clientTxn.merchant || clientTxn.category} ₹${clientTxn.amount}`
      : `txn ${clientTxn.id} matched ${rule.conditions.length} condition(s)`;
    if (fireAutopilotRule(userId, rule, clientTxn.id, clientTxn, detail).fired) fired++;
  }
  if (fired > 0 || evaluated > 0) await save();
  return { evaluated, fired };
}

// Trigger group 2 — on demand (budgets move too often for GET side effects).
async function evaluateBudgetTrigger(userId, monthPrefix) {
  const rules = db.autopilotRules.filter((r) => r.userId === userId && r.status === 'active' &&
    r.trigger === 'budget_threshold');
  let evaluated = 0, fired = 0;
  const txns = db.transactions.filter((t) => t.userId === userId).map(toClientTx);
  for (const rule of rules) {
    const threshold = Number(rule.params?.thresholdPct) || 80;
    for (const breach of budgetBreaches(txns, Object.fromEntries(
      db.budgets.filter((b) => b.userId === userId).map((b) => [b.category, b.amount])
    ), monthPrefix, threshold)) {
      evaluated++;
      if (!matchConditions(breach, rule.conditions)) continue;
      if (fireAutopilotRule(userId, rule, `${monthPrefix}:${breach.category}`, breach,
        `${breach.category} at ${breach.pct}% of budget (₹${breach.spent}/₹${breach.limit})`).fired) fired++;
    }
  }
  if (evaluated > 0) await save();
  return { evaluated, fired };
}

async function evaluateRecurringTrigger(userId, today) {
  const rules = db.autopilotRules.filter((r) => r.userId === userId && r.status === 'active' &&
    r.trigger === 'recurring_approaching');
  let evaluated = 0, fired = 0;
  const recs = db.recurring.filter((r) => r.userId === userId && r.status === 'active' && r.nextDate);
  for (const rule of rules) {
    const daysBefore = Number(rule.params?.daysBefore) || 3;
    for (const rec of recs) {
      const daysLeft = Math.round((Date.parse(rec.nextDate) - Date.parse(today)) / 86400000);
      if (daysLeft < 0 || daysLeft > daysBefore) continue;
      evaluated++;
      const record = {
        amount: toRupees(rec.amountPaise || 0), merchant: rec.name,
        category: rec.category || '', type: rec.type, account: rec.account || ''
      };
      if (!matchConditions(record, rule.conditions)) continue;
      if (fireAutopilotRule(userId, rule, `${rec.id}:${rec.nextDate}`, record,
        `${rec.name} posts in ${daysLeft}d (${rec.nextDate}, ₹${record.amount})`).fired) fired++;
    }
  }
  if (evaluated > 0) await save();
  return { evaluated, fired };
}

async function evaluateMonthClosedTrigger(userId, refMonth) {
  const rules = db.autopilotRules.filter((r) => r.userId === userId && r.status === 'active' &&
    r.trigger === 'month_closed');
  if (!rules.length) return { evaluated: 0, fired: 0 };
  const prev = previousMonthPrefix((refMonth || todayISO()) + '-01');
  const summary = monthSummary(db.transactions.filter((t) => t.userId === userId).map(toClientTx), prev);
  let fired = 0;
  for (const rule of rules) {
    if (!matchConditions(summary, rule.conditions)) continue;
    if (fireAutopilotRule(userId, rule, prev, summary,
      `${prev}: income ₹${summary.income}, spent ₹${summary.spent}, net ₹${summary.net}`).fired) fired++;
  }
  await save();
  return { evaluated: rules.length, fired };
}

app.get('/api/autopilot/rules', authMiddleware, async (req, res) => {
  res.json({ rules: db.autopilotRules.filter((r) => r.userId === req.user.id) });
});

app.post('/api/autopilot/rules', authMiddleware, async (req, res) => {
  const errors = validateRule(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const b = req.body;
  const now = new Date().toISOString();
  const hasDraft = (b.actions || []).some((a) => a.kind === 'create_draft');
  const rule = {
    id: uid('ar_'), userId: req.user.id, name: String(b.name).trim(),
    trigger: b.trigger, conditions: b.conditions || [], actions: b.actions,
    requireApproval: b.requireApproval === undefined ? hasDraft : b.requireApproval === true,
    params: b.params || {}, status: 'active',
    runCount: 0, lastRunAt: null, createdAt: now, updatedAt: now
  };
  db.autopilotRules.push(rule);
  audit(req.user.id, 'create', 'autopilot_rule', rule.id, `${rule.trigger} ${rule.name}`);
  await save();
  res.status(201).json({ rule });
});

app.put('/api/autopilot/rules/:id', authMiddleware, async (req, res) => {
  const rule = db.autopilotRules.find((r) => r.id === req.params.id && r.userId === req.user.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  const b = req.body || {};
  const merged = {
    name: b.name !== undefined ? b.name : rule.name,
    trigger: rule.trigger,
    conditions: b.conditions !== undefined ? b.conditions : rule.conditions,
    actions: b.actions !== undefined ? b.actions : rule.actions,
    requireApproval: b.requireApproval !== undefined ? b.requireApproval : rule.requireApproval,
    params: b.params !== undefined ? b.params : rule.params
  };
  if (b.status !== undefined && !['active', 'paused'].includes(b.status)) {
    return res.status(400).json({ error: 'status must be active | paused' });
  }
  const errors = validateRule(merged);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  Object.assign(rule, merged);
  if (b.status !== undefined) rule.status = b.status;
  rule.updatedAt = new Date().toISOString();
  audit(req.user.id, 'update', 'autopilot_rule', rule.id, rule.name);
  await save();
  res.json({ rule });
});

app.delete('/api/autopilot/rules/:id', authMiddleware, async (req, res) => {
  const rule = db.autopilotRules.find((r) => r.id === req.params.id && r.userId === req.user.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  db.autopilotRules = db.autopilotRules.filter((r) => r.id !== rule.id);
  audit(req.user.id, 'delete', 'autopilot_rule', rule.id, rule.name);
  await save();
  res.json({ ok: true });
});

app.post('/api/autopilot/evaluate', authMiddleware, async (req, res) => {
  const trigger = req.body?.trigger;
  if (!['budget_threshold', 'recurring_approaching', 'month_closed'].includes(trigger)) {
    return res.status(400).json({
      error: 'trigger must be budget_threshold | recurring_approaching | month_closed (transaction triggers fire automatically)'
    });
  }
  const month = /^\d{4}-\d{2}$/.test(req.body?.month || '') ? req.body.month : todayISO().slice(0, 7);
  let out;
  if (trigger === 'budget_threshold') out = await evaluateBudgetTrigger(req.user.id, month);
  else if (trigger === 'recurring_approaching') out = await evaluateRecurringTrigger(req.user.id, todayISO());
  else out = await evaluateMonthClosedTrigger(req.user.id, month);
  res.json({ ok: true, trigger, ...out });
});

app.get('/api/autopilot/runs', authMiddleware, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const rows = db.autopilotRuns.filter((r) => r.userId === req.user.id)
    .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  res.json({ runs: rows });
});

app.get('/api/notifications', authMiddleware, async (req, res) => {
  const rows = db.notifications.filter((n) => n.userId === req.user.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 200);
  res.json({ notifications: rows, unread: rows.filter((n) => n.status === 'unread').length });
});

app.post('/api/notifications/:id/read', authMiddleware, async (req, res) => {
  const n = db.notifications.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!n) return res.status(404).json({ error: 'Notification not found' });
  if (n.status === 'unread') { n.status = 'read'; await save(); }
  res.json({ ok: true });
});

app.post('/api/autopilot/approve/:id', authMiddleware, async (req, res) => {
  const n = db.notifications.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!n) return res.status(404).json({ error: 'Notification not found' });
  if (n.kind !== 'approval' || !n.payload?.draft) {
    return res.status(400).json({ error: 'This notification has nothing to approve' });
  }
  if (n.status === 'approved') return res.status(400).json({ error: 'Already approved — check Transactions for the draft' });
  const tx = buildTx(req.user.id, { ...n.payload.draft, source: 'autopilot' });
  db.transactions.push(tx);
  n.status = 'approved';
  audit(req.user.id, 'approve', 'autopilot_draft', tx.id, n.title);
  await save();
  res.status(201).json({ transaction: toClientTx(tx) });
});

// ── Preferences API ──
app.get('/api/preferences', authMiddleware, async (req, res) => {
  const p = db.preferences.find((x) => x.userId === req.user.id) || {};
  res.json({ preferences: p });
});

app.put('/api/preferences', authMiddleware, async (req, res) => {
  let p = db.preferences.find((x) => x.userId === req.user.id);
  if (!p) { p = { userId: req.user.id }; db.preferences.push(p); }
  const { theme, currency, timezone, fyStartMonth } = req.body || {};
  if (theme && ['light', 'dark'].includes(theme)) p.theme = theme;
  if (currency) p.currency = String(currency).slice(0, 8);
  if (timezone) p.timezone = String(timezone).slice(0, 64);
  if (fyStartMonth && Number(fyStartMonth) >= 1 && Number(fyStartMonth) <= 12) p.fyStartMonth = Number(fyStartMonth);
  p.updatedAt = new Date().toISOString();
  await save();
  res.json({ preferences: p });
});

// ── Export + danger zone ──
app.get('/api/export', authMiddleware, async (req, res) => {
  const id = req.user.id;
  res.json({
    exportedAt: new Date().toISOString(),
    user: publicUser(req.user),
    transactions: db.transactions.filter((t) => t.userId === id).map(toClientTx),
    accounts: accountBalances(id),
    budgets: db.budgets.filter((b) => b.userId === id),
    categories: db.categories.filter((c) => c.userId === id),
    upiIds: db.upiIds.filter((u) => u.userId === id),
    goals: db.goals.filter((g) => g.userId === id),
    recurring: db.recurring.filter((r) => r.userId === id),
    autopilotRules: db.autopilotRules.filter((r) => r.userId === id),
    notifications: db.notifications.filter((n) => n.userId === id),
    securityEvents: db.securityEvents.filter((e) => e.userId === id),
    preferences: db.preferences.find((p) => p.userId === id) || {}
  });
});

// ── Portability: versioned backup, restore (dry-run), per-account CSV ──
const PORTABILITY_ACTIONS = new Set(['export', 'import', 'restore', 'wipe_data']);

// Full versioned backup. Unlike legacy /api/export this keeps RAW account
// rows (opening balances) and contributions, so a restore is lossless.
// Exportable collections are an explicit allowlist — users, sessions,
// resets, securityEvents and audit are never serialized.
app.get('/api/portability/backup', authMiddleware, async (req, res) => {
  const id = req.user.id;
  const rawAccounts = db.accounts.filter((a) => a.userId === id);
  const budgets = {};
  for (const b of db.budgets.filter((x) => x.userId === id)) budgets[b.category] = b.amount;
  const stripUser = (r) => {
    const { userId, ...rest } = r || {};
    return rest;
  };
  const data = {
    transactions: db.transactions.filter((t) => t.userId === id).map(toClientTx),
    budgets,
    accounts: rawAccounts.map((a) => ({
      id: a.id, name: a.name, type: a.type, institution: a.institution || '',
      openingBalance: toRupees(a.openingPaise || 0), status: a.status || 'active',
      createdAt: a.createdAt, updatedAt: a.updatedAt
    })),
    categories: db.categories.filter((c) => c.userId === id).map(stripUser),
    upiIds: db.upiIds.filter((u) => u.userId === id).map((u) => ({
      id: u.id, upiId: u.upiId, accountId: u.accountId || null, createdAt: u.createdAt
    })),
    goals: db.goals.filter((g) => g.userId === id).map((g) => ({
      id: g.id, name: g.name, target: toRupees(g.targetPaise || 0),
      current: toRupees(g.currentPaise || 0), targetDate: g.targetDate || null,
      notes: g.notes || '', linkedAccount: g.linkedAccount || null,
      linkedCategory: g.linkedCategory || null, status: g.status || 'active',
      createdAt: g.createdAt, updatedAt: g.updatedAt
    })),
    contributions: db.contributions.filter((c) => c.userId === id).map((c) => ({
      id: c.id, goalId: c.goalId, amount: toRupees(c.amountPaise || 0),
      date: c.date, account: c.account || null, note: c.note || '', createdAt: c.createdAt
    })),
    recurring: db.recurring.filter((r) => r.userId === id).map((r) => ({
      id: r.id, name: r.name, amount: toRupees(r.amountPaise || 0), type: r.type,
      frequency: r.frequency, account: r.account || null, category: r.category || null,
      startDate: r.startDate, endDate: r.endDate || null, status: r.status || 'active',
      autoCreate: r.autoCreate !== false, createdAt: r.createdAt, updatedAt: r.updatedAt
    })),
    imports: db.imports.filter((x) => x.userId === id).map((x) => ({
      key: x.key, rowCount: x.rowCount || 0, createdAt: x.createdAt
    })),
    autopilotRules: db.autopilotRules.filter((r) => r.userId === id).map(stripUser),
    autopilotRuns: db.autopilotRuns.filter((r) => r.userId === id).map((r) => ({
      id: r.id, ruleId: r.ruleId, trigger: r.trigger, key: r.key,
      decision: r.decision, detail: r.detail, at: r.at
    })),
    notifications: db.notifications.filter((n) => n.userId === id).map((n) => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body,
      payload: n.payload || null, ruleId: n.ruleId || null,
      status: n.status || 'unread', createdAt: n.createdAt
    })),
    preferences: (() => {
      const p = db.preferences.find((x) => x.userId === id) || {};
      return {
        theme: p.theme, currency: p.currency, timezone: p.timezone,
        fyStartMonth: p.fyStartMonth, avatar: p.avatar || undefined,
        displayName: p.displayName || undefined
      };
    })()
  };
  const manifest = buildManifest(data, { appVersion: BACKUP_APP_VERSION });
  audit(req.user.id, 'export', 'backup', null, `versioned backup downloaded (${manifest.integrity.value.slice(0, 12)}…)`);
  await save();
  const body = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    // Minimal owner reference, used only to validate ownership on restore.
    user: { id: req.user.id },
    manifest,
    data
  };
  if (req.query.download === '1') {
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fintrack-backup-v${BACKUP_VERSION}-${stamp}.json"`);
  }
  res.json(body);
});

// CSV export scoped to one account (matches its ledger rows from any side).
app.get('/api/portability/export.csv', authMiddleware, async (req, res) => {
  const name = String(req.query.account || '').trim();
  if (!name) return res.status(400).json({ error: 'account query parameter is required' });
  const mine = db.accounts.filter((a) => a.userId === req.user.id);
  const acc = mine.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const rows = db.transactions
    .filter((t) => t.userId === req.user.id &&
      (t.account === acc.name || t.accountFrom === acc.name || t.accountTo === acc.name))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map(toClientTx);
  audit(req.user.id, 'export', 'account_csv', acc.id, `${acc.name} (${rows.length} rows)`);
  await save();
  const safe = acc.name.replace(/[^\w\-]+/g, '_').slice(0, 60) || 'account';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="fintrack-${safe}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(buildAccountCsv(rows));
});

// Import/export/restore/wipe audit trail for this user.
app.get('/api/portability/history', authMiddleware, async (req, res) => {
  const rows = db.audit.filter((a) => a.userId === req.user.id && PORTABILITY_ACTIONS.has(a.action))
    .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 100);
  res.json({ history: rows });
});

// Collections a replace-mode restore wipes (caller's rows only). Authentication,
// sessions, password-reset codes are handled separately; securityEvents are
// deliberately PRESERVED so a restore can never erase the security history.
const WIPEABLE_KEYS = ['transactions', 'budgets', 'accounts', 'categories', 'upiIds', 'goals', 'contributions', 'recurring', 'resets', 'autopilotRules', 'autopilotRuns', 'notifications', 'imports'];

// Generic in-memory operation limiter (per Vercel instance; counts reset on
// cold start — documented in README, not a distributed guarantee).
const opAttempts = new Map();
function opLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (opAttempts.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  opAttempts.set(key, arr);
  return arr.length > max;
}
const portabilityLimited = (req, action, max, windowMs) =>
  opLimited(`port:${action}:${req.user.id}:${req.ip}`, max, windowMs);

// Live per-user slices shaped for diffPreview (balances use paise math).
function liveUserSlices(userId) {
  const budgets = {};
  for (const b of db.budgets.filter((x) => x.userId === userId)) budgets[b.category] = b.amount;
  return {
    transactions: db.transactions.filter((t) => t.userId === userId),
    accounts: db.accounts.filter((a) => a.userId === userId),
    categories: db.categories.filter((c) => c.userId === userId),
    upiIds: db.upiIds.filter((u) => u.userId === userId),
    goals: db.goals.filter((g) => g.userId === userId),
    contributions: db.contributions.filter((c) => c.userId === userId),
    recurring: db.recurring.filter((r) => r.userId === userId),
    imports: db.imports.filter((x) => x.userId === userId),
    autopilotRules: db.autopilotRules.filter((r) => r.userId === userId),
    autopilotRuns: db.autopilotRuns.filter((r) => r.userId === userId),
    notifications: db.notifications.filter((n) => n.userId === userId),
    budgets
  };
}

// Shared normalize → validate pipeline for validate/preview/restore.
// Pure reads only; never writes, never audits.
function prepareBackup(req) {
  const { backup } = req.body || {};
  if (backup !== undefined) {
    try {
      if (Buffer.byteLength(JSON.stringify(backup), 'utf8') > BACKUP_MAX_BYTES) {
        return { error: { status: 413, body: { error: `Backup too large (max ${BACKUP_MAX_BYTES / 1048576} MB)` } } };
      }
    } catch { /* fall through to normalize error */ }
  }
  const norm = normalizeBackup(backup);
  if (!norm.ok) return { error: { status: 400, body: { error: norm.errors.join('; ') } } };
  const knownAccounts = db.accounts.filter((a) => a.userId === req.user.id);
  const report = validateBackupData(norm.data, { ownerId: req.user.id, knownAccounts });
  const counts = summarizeBackup(norm.data);
  return { norm, report, counts };
}

function insertBackupRecord(userId, key, r, existingIds, now) {
  // Returns 'inserted' | 'skipped' | {error}. Ownership is always forced to
  // the caller; incoming ids are kept only when collision-free.
  const keepId = (prefix) => {
    const id = (typeof r.id === 'string' && r.id) ? r.id : uid(prefix);
    if (existingIds.has(id)) return null;
    existingIds.add(id);
    return id;
  };
  let row = null;
  if (key === 'transactions') {
    const id = keepId('T'); if (!id) return 'skipped';
    row = { ...buildTx(userId, { ...r, source: r.source || 'restored' }), id };
  } else if (key === 'accounts') {
    const id = keepId('ac_'); if (!id) return 'skipped';
    row = {
      id, userId, name: String(r.name).trim(), type: r.type,
      institution: String(r.institution || '').trim(),
      openingPaise: toPaise(Number(r.openingBalance) || 0),
      status: r.status || 'active', createdAt: r.createdAt || now, updatedAt: now
    };
  } else if (key === 'categories') {
    const id = keepId('c_'); if (!id) return 'skipped';
    row = {
      id, userId, name: String(r.name).trim(), kind: r.kind || 'expense',
      color: r.color || '#3b82f6', icon: String(r.icon || '').slice(0, 4),
      parent: r.parent || null, createdAt: r.createdAt || now
    };
  } else if (key === 'upiIds') {
    const id = keepId('upi_'); if (!id) return 'skipped';
    row = {
      id, userId, upiId: String(r.upiId).trim(), accountId: r.accountId || null,
      createdAt: r.createdAt || now
    };
  } else if (key === 'goals') {
    const id = keepId('g_'); if (!id) return 'skipped';
    row = {
      id, userId, name: String(r.name).trim(), targetPaise: toPaise(r.target),
      currentPaise: toPaise(Number(r.current) || 0),
      targetDate: r.targetDate || null, notes: String(r.notes || '').slice(0, 500),
      linkedAccount: r.linkedAccount || null, linkedCategory: r.linkedCategory || null,
      status: ['active', 'paused', 'completed'].includes(r.status) ? r.status : 'active',
      createdAt: r.createdAt || now, updatedAt: now
    };
  } else if (key === 'contributions') {
    const id = keepId('gc_'); if (!id) return 'skipped';
    row = {
      id, userId, goalId: r.goalId || null, amountPaise: toPaise(r.amount),
      date: r.date, account: r.account || null,
      note: String(r.note || '').slice(0, 300), createdAt: r.createdAt || now
    };
  } else if (key === 'recurring') {
    const id = keepId('r_'); if (!id) return 'skipped';
    row = {
      id, userId, name: String(r.name).trim(), amountPaise: toPaise(r.amount),
      type: r.type, frequency: r.frequency, account: r.account || null,
      category: r.category || null, startDate: r.startDate, endDate: r.endDate || null,
      nextDate: r.startDate, status: 'active', autoCreate: r.autoCreate !== false,
      lastPostedDate: null, lastRunAt: null, createdAt: r.createdAt || now, updatedAt: now
    };
  } else if (key === 'autopilotRules') {
    // Incoming rule ids are kept when collision-free so a repeated merge of
    // the same backup skips instead of duplicating; always imported paused.
    const id = keepId('ar_'); if (!id) return 'skipped';
    row = {
      id, userId, name: String(r.name).trim(), trigger: r.trigger,
      conditions: r.conditions || [], actions: r.actions,
      requireApproval: r.requireApproval !== false,
      params: r.params || {}, status: 'paused',
      runCount: 0, lastPostedDate: null, lastRunAt: null, createdAt: now, updatedAt: now
    };
  } else if (key === 'imports') {
    const k = String(r.key || '').trim();
    if (!k || existingIds.has(k)) return 'skipped';
    existingIds.add(k);
    row = { key: k, userId, createdAt: r.createdAt || now, rowCount: Number(r.rowCount) || 0 };
  } else if (key === 'autopilotRuns') {
    const id = keepId('aru_'); if (!id) return 'skipped';
    row = {
      id, userId, ruleId: r.ruleId || null, trigger: r.trigger || null,
      key: r.key || null, decision: r.decision || null,
      detail: String(r.detail || '').slice(0, 300), at: r.at || now
    };
  } else if (key === 'notifications') {
    const id = keepId('nt_'); if (!id) return 'skipped';
    row = {
      id, userId, kind: r.kind || 'info',
      title: String(r.title || '').slice(0, 120), body: String(r.body || '').slice(0, 1000),
      payload: r.payload || null, ruleId: r.ruleId || null,
      status: r.status === 'read' ? 'read' : 'unread', createdAt: r.createdAt || now
    };
  }
  if (!row) return { error: 'unsupported collection' };
  db[key].push(row);
  return 'inserted';
}

// Server-side backup validator. Read-only: never writes, never audits, so
// validation can never modify live financial data.
app.post('/api/portability/validate', authMiddleware, async (req, res) => {
  if (portabilityLimited(req, 'validate', 20, 5 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many validations — try again in a few minutes' });
  }
  const prep = prepareBackup(req);
  if (prep.error) return res.status(prep.error.status).json(prep.error.body);
  const { norm, report, counts } = prep;
  const manifestCheck = req.body.backup && req.body.backup.manifest
    ? verifyManifest(req.body.backup.data || norm.data, req.body.backup.manifest)
    : { ok: true, skipped: true };
  const totalInvalid = Object.values(report.invalid).reduce((s, n) => s + n, 0);
  res.json({
    ok: true,
    valid: totalInvalid === 0,
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    counts,
    validCounts: report.valid,
    invalidCounts: report.invalid,
    errors: report.errors,
    warnings: report.warnings,
    dangling: report.dangling,
    manifest: manifestCheck,
    compatibility: {
      supported: `fintrack-backup v${BACKUP_VERSION}`,
      appVersion: BACKUP_APP_VERSION,
      notes: [
        'Legacy /api/export payloads are accepted and normalized (budgets folded, account shells get 0 opening).',
        'Unknown fields are ignored with warnings; record ids are preserved when collision-free.',
        'Restores larger than ~4.5 MB must run against a local server — Vercel caps serverless request bodies.'
      ]
    }
  });
});

// Restore preview. Read-only: compares the incoming backup against live data
// (added / replaced / removed / conflicts + balance effect) without writing.
app.post('/api/portability/preview', authMiddleware, async (req, res) => {
  if (portabilityLimited(req, 'preview', 20, 5 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many previews — try again in a few minutes' });
  }
  const { mode } = req.body || {};
  const previewMode = mode || 'merge';
  if (!['merge', 'replace'].includes(previewMode)) {
    return res.status(400).json({ error: 'mode must be merge | replace' });
  }
  const prep = prepareBackup(req);
  if (prep.error) return res.status(prep.error.status).json(prep.error.body);
  const { norm, report, counts } = prep;
  const live = liveUserSlices(req.user.id);
  const liveCounts = summarizeBackup({ ...live, preferences: {} });
  liveCounts.budgets = Object.keys(live.budgets).length;
  const diff = diffPreview(
    { ...live, transactions: live.transactions.map((t) => ({ ...t, amount: undefined })) },
    norm.data, previewMode
  );
  const totalInvalid = Object.values(report.invalid).reduce((s, n) => s + n, 0);
  res.json({
    ok: true, mode: previewMode,
    liveCounts, incomingCounts: counts,
    diff: diff.per,
    balanceEffect: diff.balanceEffect,
    invalidSkipped: totalInvalid,
    errors: report.errors.slice(0, 10),
    warnings: report.warnings.slice(0, 20),
    dangling: report.dangling.slice(0, 20),
    replaceWipeNote: previewMode === 'replace'
      ? 'Replace wipes your transactions, budgets, accounts, categories, UPI IDs, goals, contributions, recurring rules, imports, autopilot rules/runs and notifications. Your login, sessions, security history and account identity are preserved.'
      : null
  });
});

app.post('/api/portability/restore', authMiddleware, async (req, res) => {
  if (portabilityLimited(req, 'restore', 5, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many restores — try again later' });
  }
  const { dryRun, mode, confirmation, password } = req.body || {};
  const prep = prepareBackup(req);
  if (prep.error) return res.status(prep.error.status).json(prep.error.body);
  const { norm, report, counts } = prep;
  const totalInvalid = Object.values(report.invalid).reduce((s, n) => s + n, 0);
  if (dryRun) {
    return res.json({ ok: true, dryRun: true, counts, valid: report.valid, invalid: report.invalid, errors: report.errors, warnings: report.warnings });
  }
  const restoreMode = mode || 'merge';
  if (!['merge', 'replace'].includes(restoreMode)) {
    return res.status(400).json({ error: "mode must be merge | replace" });
  }
  if (restoreMode === 'replace') {
    // Re-authentication (mirrors the account-deletion safeguard): the current
    // password plus the explicit confirmation phrase are both required.
    if (!password || !verifyPassword(req.user, String(password))) {
      secEvent(req.user.id, 'restore_failed', 'Replace attempted with wrong password');
      await save();
      return res.status(401).json({ error: 'Password is incorrect' });
    }
    if (confirmation !== RESTORE_REPLACE_PHRASE) {
      secEvent(req.user.id, 'restore_failed', 'Replace attempted without the confirmation phrase');
      await save();
      return res.status(400).json({ error: `Type ${RESTORE_REPLACE_PHRASE} to confirm a full replace` });
    }
    if (totalInvalid > 0) {
      return res.status(400).json({ error: `Replace aborted: ${totalInvalid} invalid record(s)`, errors: report.errors });
    }
    const beforeCounts = summarizeBackup({ ...liveUserSlices(req.user.id), preferences: {} });
    for (const k of WIPEABLE_KEYS) db[k] = db[k].filter((x) => x.userId !== req.user.id);
    ensureUserDefaults(req.user);
    audit(req.user.id, 'restore', 'pre_replace_snapshot', null, `wiped=${JSON.stringify(beforeCounts)}`);
  }
  const now = new Date().toISOString();
  const inserted = {}, skipped = {}, conflictIds = {};
  const existingIds = new Set();
  for (const k of ['transactions', 'accounts', 'categories', 'upiIds', 'goals', 'contributions', 'recurring', 'autopilotRuns', 'notifications']) {
    for (const t of db[k].filter((x) => x.userId === req.user.id)) existingIds.add(t.id);
  }
  for (const x of db.imports.filter((x) => x.userId === req.user.id)) existingIds.add(x.key);
  const hasError = (key, i) => report.errors.some((e) => e.startsWith(`${key}[${i}]`));
  const MERGEABLE = ['transactions', 'accounts', 'categories', 'upiIds', 'goals', 'contributions', 'recurring', 'imports', 'autopilotRules', 'autopilotRuns', 'notifications'];
  for (const key of MERGEABLE) {
    const list = norm.data[key] || [];
    for (let i = 0; i < list.length; i++) {
      if (hasError(key, i)) {
        skipped[key] = (skipped[key] || 0) + 1;
        continue;
      }
      const incomingId = (list[i] && (list[i].id || list[i].key)) || null;
      const out = insertBackupRecord(req.user.id, key, list[i], existingIds, now);
      if (out === 'inserted') inserted[key] = (inserted[key] || 0) + 1;
      else {
        skipped[key] = (skipped[key] || 0) + 1;
        if (incomingId) {
          conflictIds[key] = conflictIds[key] || [];
          if (conflictIds[key].length < 20) conflictIds[key].push(incomingId);
        }
      }
    }
  }
  // Budgets merge per category; preferences merge field-by-field.
  let bUp = 0;
  for (const [cat, amt] of Object.entries(norm.data.budgets || {})) {
    if (!cat || !Number.isFinite(Number(amt)) || Number(amt) < 0) continue;
    const ex = db.budgets.find((x) => x.userId === req.user.id && x.category === cat);
    if (ex) ex.amount = Number(amt);
    else db.budgets.push({ userId: req.user.id, category: cat, amount: Number(amt) });
    bUp++;
  }
  inserted.budgets = bUp;
  const p = norm.data.preferences || {};
  if (Object.keys(p).length) {
    let pref = db.preferences.find((x) => x.userId === req.user.id);
    if (!pref) { pref = { userId: req.user.id }; db.preferences.push(pref); }
    if (['light', 'dark'].includes(p.theme)) pref.theme = p.theme;
    if (p.currency) pref.currency = String(p.currency).slice(0, 8);
    if (p.timezone) pref.timezone = String(p.timezone).slice(0, 64);
    if (Number(p.fyStartMonth) >= 1 && Number(p.fyStartMonth) <= 12) pref.fyStartMonth = Number(p.fyStartMonth);
    pref.updatedAt = now;
    inserted.preferences = 1;
  }
  audit(req.user.id, 'restore', 'backup', null, `${restoreMode} inserted=${JSON.stringify(inserted)}`);
  await save();
  // Post-restore verification: counts + referential sanity, recomputed live
  // (derived balances are never trusted from the backup — they rebuild from
  // the ledger on every read).
  const after = liveUserSlices(req.user.id);
  const afterCounts = summarizeBackup({ ...after, preferences: {} });
  afterCounts.budgets = Object.keys(after.budgets).length;
  res.json({
    ok: true, mode: restoreMode, counts, inserted, skipped,
    conflicts: conflictIds,
    afterCounts,
    errors: report.errors.slice(0, 10),
    warnings: report.warnings.slice(0, 10)
  });
});

app.delete('/api/account/data', authMiddleware, async (req, res) => {
  const id = req.user.id;
  for (const k of ['transactions', 'budgets', 'accounts', 'categories', 'upiIds', 'goals', 'contributions', 'recurring', 'resets', 'autopilotRules', 'autopilotRuns', 'notifications', 'securityEvents', 'imports']) {
    db[k] = db[k].filter((x) => x.userId !== id);
  }
  db.sessions = db.sessions.filter((s) => s.userId !== id);
  audit(id, 'wipe_data', 'user', id, '');
  ensureUserDefaults(req.user);
  await save();
  res.json({ ok: true });
});

// ── Static frontend ──
// JSON 404 for unknown /api/* routes on ANY method (Express's default is an
// HTML page, which the frontend cannot parse — surfacing as bare "Request
// failed (404)"). Must sit after all API routes, before static + SPA fallback.
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `Unknown API route: ${req.method} ${req.path}` });
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get(/.*/, async (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  const indexFile = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  res.sendFile(path.join(__dirname, 'index.html'));
});

export default app;

// Only listen when run directly (`npm start`). On Vercel the exported
// app is invoked serverless via api/index.js and DATABASE_URL (Neon).
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Personal Finance Tracker running on http://localhost:${PORT}`);
    console.log(isNeon ? 'DB: Neon Postgres (DATABASE_URL)' : `DB file: ${DB_FILE}`);
  });
}
