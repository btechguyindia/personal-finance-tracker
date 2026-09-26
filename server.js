import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import express from 'express';

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
    recurring: [], preferences: [], imports: [], audit: []
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
  const session = db.sessions.find((s) => s.token === token);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
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

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });

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
app.use(express.json({ limit: '2mb' }));

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
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  db.sessions.push({ token, userId: user.id, createdAt: now.toISOString(), expiresAt });
  audit(user.id, 'signup', 'user', user.id, cleanEmail);
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
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  db.sessions.push({ token, userId: user.id, createdAt: now.toISOString(), expiresAt });
  audit(user.id, 'login', 'session', null, '');
  await save();
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.slice(7);
  db.sessions = db.sessions.filter((s) => s.token !== token);
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
  audit(req.user.id, 'change_password', 'user', req.user.id, '');
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
  const out = rows.map((r, i) => {
    const errors = validateTransaction(r);
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
  for (const r of rows) {
    if (!r || r.include === false) { skipped++; continue; }
    if (validateTransaction(r).length) { skipped++; continue; }
    const cand = { ...r, amountPaise: toPaise(r.amount) };
    if (existing.has(txFingerprint(cand))) { skipped++; continue; }
    const tx = { ...buildTx(req.user.id, { ...r, source: 'imported' }) };
    db.transactions.push(tx);
    existing.add(txFingerprint({ ...cand }));
    imported++;
  }
  if (key) db.imports.push({ key, userId: req.user.id, createdAt: new Date().toISOString(), rowCount: imported });
  audit(req.user.id, 'import', 'transactions', null, `imported=${imported} skipped=${skipped}`);
  await save();
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
    preferences: db.preferences.find((p) => p.userId === id) || {}
  });
});

app.delete('/api/account/data', authMiddleware, async (req, res) => {
  const id = req.user.id;
  for (const k of ['transactions', 'budgets', 'accounts', 'categories', 'upiIds', 'goals', 'contributions', 'recurring', 'imports']) {
    db[k] = db[k].filter((x) => x.userId !== id);
  }
  db.sessions = db.sessions.filter((s) => s.userId !== id);
  audit(id, 'wipe_data', 'user', id, '');
  ensureUserDefaults(req.user);
  await save();
  res.json({ ok: true });
});

// ── Static frontend ──
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
