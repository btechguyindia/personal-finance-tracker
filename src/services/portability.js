// Data portability — pure backup validation, normalization and CSV building.
// Shared by server.js and tests/portability.test.mjs. No I/O. Besides the
// autopilot rule validator (also pure) it only uses node:crypto for the
// backup integrity hash — never import this module from browser code.
import { createHash } from 'node:crypto';
import { validateRule } from './autopilotEngine.js';

export const BACKUP_FORMAT = 'fintrack-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_APP_VERSION = '1.0.0';
export const BACKUP_MAX_TRANSACTIONS = 10000;
export const BACKUP_MAX_BYTES = 8 * 1024 * 1024;
export const RESTORE_REPLACE_PHRASE = 'REPLACE ALL MY DATA';

// Explicit allowlist of user-owned collections that may appear in a backup.
// Security-sensitive collections (users, sessions, resets, securityEvents,
// audit) are NEVER exportable and are rejected on import.
export const PORTABLE_COLLECTIONS = [
  'transactions', 'accounts', 'budgets', 'categories', 'upiIds',
  'goals', 'contributions', 'recurring', 'imports',
  'autopilotRules', 'autopilotRuns', 'notifications', 'preferences'
];

// Reference sets mirror server.js validation (kept local so this module
// stays importable without the server).
export const TX_TYPES = ['expense', 'income', 'transfer', 'refund', 'adjustment'];
export const TX_STATUS = ['completed', 'pending', 'scheduled'];
export const ACCOUNT_TYPES = ['cash', 'savings', 'current', 'upi', 'credit_card', 'wallet', 'investment', 'other'];
export const RECUR_FREQS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const s = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export function validateBackupTransaction(r) {
  const errors = [];
  if (!r || typeof r !== 'object') return ['not an object'];
  if (!DATE_RE.test(String(r.date || ''))) errors.push('date must be YYYY-MM-DD');
  if (!TX_TYPES.includes(r.type)) errors.push(`type must be ${TX_TYPES.join(' | ')}`);
  if (!Number.isFinite(Number(r.amount)) || Number(r.amount) <= 0) errors.push('amount must be > 0');
  if (!s(r.category, 80)) errors.push('category is required');
  if (r.type === 'transfer') {
    if (!r.accountFrom || !r.accountTo) errors.push('transfer needs accountFrom + accountTo');
    else if (r.accountFrom === r.accountTo) errors.push('transfer accounts must differ');
  } else if (!s(r.account, 80)) errors.push('account is required');
  if (r.status !== undefined && !TX_STATUS.includes(r.status)) errors.push('bad status');
  return errors;
}

export function validateBackupAccount(r) {
  const errors = [];
  if (!r || typeof r !== 'object') return ['not an object'];
  if (!s(r.name, 80)) errors.push('name is required');
  if (!ACCOUNT_TYPES.includes(r.type)) errors.push(`type must be ${ACCOUNT_TYPES.join(' | ')}`);
  if (r.openingBalance !== undefined && !Number.isFinite(Number(r.openingBalance))) errors.push('openingBalance must be numeric');
  if (r.status !== undefined && !['active', 'archived'].includes(r.status)) errors.push('bad status');
  return errors;
}

export function validateBackupGoal(r) {
  const errors = [];
  if (!r || typeof r !== 'object') return ['not an object'];
  if (!s(r.name, 80)) errors.push('name is required');
  if (!Number.isFinite(Number(r.target)) || Number(r.target) <= 0) errors.push('target must be > 0');
  if (r.targetDate !== undefined && r.targetDate !== null && !DATE_RE.test(String(r.targetDate))) errors.push('targetDate must be YYYY-MM-DD');
  return errors;
}

export function validateBackupImport(r) {
  if (!r || typeof r !== 'object') return ['not an object'];
  if (!s(r.key, 80)) return ['key is required'];
  return [];
}

export function validateBackupRun(r) {
  if (!r || typeof r !== 'object') return ['not an object'];
  const errors = [];
  if (r.at !== undefined && Number.isNaN(Date.parse(String(r.at)))) errors.push('bad timestamp');
  return errors;
}

export function validateBackupNotification(r) {
  if (!r || typeof r !== 'object') return ['not an object'];
  if (!s(r.title, 120)) return ['title is required'];
  return [];
}

// Amounts cross the API boundary in rupees and are stored as integer paise.
// Returns an error for unusable values, a warning when the value would be
// rounded to paise on restore. Balances (openingBalance, goal current) may
// legitimately be zero; flow amounts must be > 0.
export function checkMoney(v, allowZero = false) {
  const n = Number(v);
  if (!Number.isFinite(n)) return { error: 'amount must be numeric' };
  if (n < 0) return { error: 'amount must be >= 0' };
  if (n === 0 && !allowZero) return { error: 'amount must be > 0' };
  if (Math.round(n * 100) !== n * 100) return { warning: `rounds to paise (${n} → ${(Math.round(n * 100) / 100)})` };
  return {};
}
const ZERO_OK_MONEY_KEYS = new Set(['openingBalance', 'current']);

// Known export keys per collection. Unknown keys are reported as warnings
// (forward compatibility) — never executed or interpreted.
const KNOWN_KEYS = {
  transactions: new Set(['id', 'date', 'type', 'amount', 'amountPaise', 'category', 'subcategory', 'paymentMethod', 'account', 'accountFrom', 'accountTo', 'merchant', 'description', 'upiRef', 'tags', 'status', 'source', 'isCreditCardRepayment', 'createdAt', 'updatedAt', 'userId']),
  accounts: new Set(['id', 'name', 'type', 'institution', 'openingBalance', 'openingPaise', 'status', 'createdAt', 'updatedAt', 'userId']),
  categories: new Set(['id', 'name', 'kind', 'color', 'icon', 'parent', 'createdAt', 'userId']),
  upiIds: new Set(['id', 'upiId', 'accountId', 'createdAt', 'userId']),
  goals: new Set(['id', 'name', 'target', 'targetPaise', 'current', 'currentPaise', 'targetDate', 'notes', 'linkedAccount', 'linkedCategory', 'status', 'createdAt', 'updatedAt', 'userId']),
  contributions: new Set(['id', 'goalId', 'amount', 'amountPaise', 'date', 'account', 'note', 'createdAt', 'userId']),
  recurring: new Set(['id', 'name', 'amount', 'amountPaise', 'type', 'frequency', 'account', 'category', 'startDate', 'endDate', 'status', 'autoCreate', 'createdAt', 'updatedAt', 'userId']),
  imports: new Set(['key', 'rowCount', 'createdAt', 'userId']),
  autopilotRules: new Set(['id', 'name', 'trigger', 'conditions', 'actions', 'requireApproval', 'params', 'status', 'createdAt', 'updatedAt', 'userId']),
  autopilotRuns: new Set(['id', 'ruleId', 'trigger', 'key', 'decision', 'detail', 'at', 'userId']),
  notifications: new Set(['id', 'kind', 'title', 'body', 'payload', 'ruleId', 'status', 'createdAt', 'userId'])
};

export function unknownFieldWarnings(key, r) {
  const known = KNOWN_KEYS[key];
  if (!known || !r || typeof r !== 'object') return [];
  return Object.keys(r).filter((k) => !known.has(k));
}

export function validateBackupContribution(r) {
  const errors = [];
  if (!r || typeof r !== 'object') return ['not an object'];
  if (!Number.isFinite(Number(r.amount)) || Number(r.amount) <= 0) errors.push('amount must be > 0');
  if (r.date !== undefined && !DATE_RE.test(String(r.date))) errors.push('date must be YYYY-MM-DD');
  return errors;
}

export function validateBackupRecurring(r) {
  const errors = [];
  if (!r || typeof r !== 'object') return ['not an object'];
  if (!s(r.name, 80)) errors.push('name is required');
  if (!Number.isFinite(Number(r.amount)) || Number(r.amount) <= 0) errors.push('amount must be > 0');
  if (!['income', 'expense'].includes(r.type)) errors.push('type must be income | expense');
  if (!RECUR_FREQS.includes(r.frequency)) errors.push('bad frequency');
  if (!DATE_RE.test(String(r.startDate || ''))) errors.push('startDate must be YYYY-MM-DD');
  return errors;
}

export function validateBackupCategory(r) {
  if (!r || typeof r !== 'object' || !s(r.name, 80)) return ['name is required'];
  if (r.kind !== undefined && !['expense', 'income'].includes(r.kind)) return ['bad kind'];
  return [];
}

export function validateBackupUpi(r) {
  if (!r || typeof r !== 'object') return ['not an object'];
  if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(String(r.upiId || '').trim())) return ['invalid UPI ID'];
  return [];
}

export function validatePreferences(p) {
  const errors = [];
  if (p === null || p === undefined) return [];
  if (typeof p !== 'object') return ['not an object'];
  if (p.theme !== undefined && !['light', 'dark'].includes(p.theme)) errors.push('bad theme');
  if (p.fyStartMonth !== undefined && !(Number(p.fyStartMonth) >= 1 && Number(p.fyStartMonth) <= 12)) errors.push('bad fyStartMonth');
  return errors;
}

// Normalize versioned ({format, version, data}) or legacy /api/export-shaped
// backups into a canonical data object. Never throws.
export function normalizeBackup(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['backup must be a JSON object'], data: null };
  let data = null;
  if (input.format === BACKUP_FORMAT) {
    if (input.version !== BACKUP_VERSION) {
      return { ok: false, errors: [`unsupported backup version ${input.version} (need ${BACKUP_VERSION})`], data: null };
    }
    data = input.data || {};
  } else if (Array.isArray(input.transactions)) {
    data = input; // legacy /api/export shape
  } else {
    return { ok: false, errors: ['unrecognized backup: need a fintrack-backup v1 file or an /api/export payload'], data: null };
  }
  const norm = {
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
    budgets: data.budgets || {},
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    categories: Array.isArray(data.categories) ? data.categories : [],
    upiIds: Array.isArray(data.upiIds) ? data.upiIds : [],
    goals: Array.isArray(data.goals) ? data.goals : [],
    contributions: Array.isArray(data.contributions) ? data.contributions : [],
    recurring: Array.isArray(data.recurring) ? data.recurring : [],
    imports: Array.isArray(data.imports) ? data.imports : [],
    autopilotRules: Array.isArray(data.autopilotRules) ? data.autopilotRules : [],
    autopilotRuns: Array.isArray(data.autopilotRuns) ? data.autopilotRuns : [],
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
    preferences: data.preferences && typeof data.preferences === 'object' ? data.preferences : {}
  };
  // Legacy budgets arrive as [{category, amount}] — fold to {category: amount}.
  if (Array.isArray(norm.budgets)) {
    const folded = {};
    for (const b of norm.budgets) {
      if (b && typeof b.category === 'string' && Number.isFinite(Number(b.amount)) && Number(b.amount) >= 0) {
        folded[b.category] = Number(b.amount);
      }
    }
    norm.budgets = folded;
  }
  if (norm.budgets && typeof norm.budgets !== 'object') {
    errors.push('budgets must be an object or array');
    norm.budgets = {};
  }
  if (norm.transactions.length > BACKUP_MAX_TRANSACTIONS) {
    errors.push(`too many transactions (${norm.transactions.length} > ${BACKUP_MAX_TRANSACTIONS})`);
  }
  // Legacy /api/export accounts are balance-shaped (no opening) — restore
  // them as 0-opening shells; ledger rows still rebuild balances.
  norm.accounts = norm.accounts.map((a) => {
    if (a && a.openingPaise === undefined && a.openingBalance === undefined) return { ...a, openingBalance: 0 };
    if (a && a.openingPaise !== undefined && a.openingBalance === undefined) {
      return { ...a, openingBalance: Math.round(a.openingPaise) / 100 };
    }
    return a;
  });
  return { ok: errors.length === 0, errors, data: norm };
}

// Validate every record; returns per-collection {valid, invalid} + capped
// errors and non-blocking warnings. opts: { ownerId, knownAccounts }.
// - duplicate ids within one collection → error
// - record.userId present but !== ownerId → error (ownership consistency;
//   ownership is forced to the caller on restore regardless)
// - dangling references (contribution goalId, recurring account, upi
//   accountId) → warning, listed for the preview
// - amounts with sub-paise precision → warning (rounded on restore)
// - unknown fields → warning (forward compatibility, never interpreted)
export function validateBackupData(data, opts = {}) {
  const out = { valid: {}, invalid: {}, errors: [], warnings: [], dangling: [] };
  const pushErr = (m) => { if (out.errors.length < 50) out.errors.push(m); };
  const pushWarn = (m) => { if (out.warnings.length < 50) out.warnings.push(m); };
  const seenIds = {};
  const check = (key, list, fn) => {
    let v = 0;
    (list || []).forEach((r, i) => {
      const tag = `${key}[${i}]${r && typeof r.id === 'string' && r.id ? ` id "${r.id}"` : ''}:`;
      const errs = [...fn(r)];
      if (r && typeof r.id === 'string' && r.id) {
        seenIds[key] = seenIds[key] || new Set();
        if (seenIds[key].has(r.id)) errs.push(`duplicate id "${r.id}"`);
        else seenIds[key].add(r.id);
      }
      if (r && typeof r.userId === 'string' && r.userId && opts.ownerId && r.userId !== opts.ownerId) {
        errs.push('record belongs to a different user');
      }
      const moneyKeys = ['amount', 'target', 'current', 'openingBalance'];
      for (const mk of moneyKeys) {
        if (r && r[mk] !== undefined && r[mk] !== null && r[mk] !== '') {
          const c = checkMoney(r[mk], ZERO_OK_MONEY_KEYS.has(mk));
          if (c.error && !errs.some((e) => e.includes('amount') || e.includes('target') || e.includes('openingBalance'))) errs.push(`${mk}: ${c.error}`);
          else if (c.warning) pushWarn(`${key}[${i}].${mk} ${c.warning}`);
        }
      }
      for (const uf of unknownFieldWarnings(key, r)) pushWarn(`${key}[${i}]: unknown field "${uf}" (ignored)`);
      if (errs.length === 0) v++;
      else pushErr(`${tag} ${errs.join('; ')}`);
    });
    out.valid[key] = v;
    out.invalid[key] = (list || []).length - v;
  };
  check('transactions', data.transactions, validateBackupTransaction);
  check('accounts', data.accounts, validateBackupAccount);
  check('goals', data.goals, validateBackupGoal);
  check('contributions', data.contributions, validateBackupContribution);
  check('recurring', data.recurring, validateBackupRecurring);
  check('categories', data.categories, validateBackupCategory);
  check('upiIds', data.upiIds, validateBackupUpi);
  check('imports', data.imports, validateBackupImport);
  check('autopilotRules', data.autopilotRules, (r) => validateRule(r || {}));
  check('autopilotRuns', data.autopilotRuns, validateBackupRun);
  check('notifications', data.notifications, validateBackupNotification);
  const bErrs = Object.entries(data.budgets || {}).flatMap(([cat, amt]) =>
    (!cat || !Number.isFinite(Number(amt)) || Number(amt) < 0) ? [`budgets[${cat}]: must be >= 0`] : []);
  out.valid.budgets = Object.keys(data.budgets || {}).length - bErrs.length;
  out.invalid.budgets = bErrs.length;
  for (const e of bErrs.slice(0, 50 - out.errors.length)) pushErr(e);
  const pErrs = validatePreferences(data.preferences);
  out.valid.preferences = pErrs.length === 0 ? 1 : 0;
  out.invalid.preferences = pErrs.length === 0 ? 0 : 1;
  if (pErrs.length) pushErr(`preferences: ${pErrs.join('; ')}`);
  // Referential integrity → warnings + dangling list (reported, never fatal).
  const goalIds = new Set((data.goals || []).map((g) => g && g.id).filter(Boolean));
  const acctNames = new Set([
    ...((opts.knownAccounts || []).map((a) => (typeof a === 'string' ? a : a && a.name)).filter(Boolean)),
    ...((data.accounts || []).map((a) => a && a.name).filter(Boolean))
  ]);
  (data.contributions || []).forEach((c, i) => {
    if (c && c.goalId && !goalIds.has(c.goalId)) {
      const m = `contributions[${i}]: goalId "${c.goalId}" not in backup (kept as-is; shows as unlinked)`;
      pushWarn(m); out.dangling.push(m);
    }
  });
  (data.recurring || []).forEach((r, i) => {
    if (r && r.account && !acctNames.has(r.account)) {
      const m = `recurring[${i}]: account "${r.account}" unknown (kept; runs only for known accounts)`;
      pushWarn(m); out.dangling.push(m);
    }
  });
  (data.upiIds || []).forEach((u, i) => {
    if (u && u.accountId) {
      const ok = (data.accounts || []).some((a) => a && a.id === u.accountId) ||
        (opts.knownAccounts || []).some((a) => a && a.id === u.accountId);
      if (!ok) {
        const m = `upiIds[${i}]: accountId not in backup (link dropped on restore)`;
        pushWarn(m); out.dangling.push(m);
      }
    }
  });
  return out;
}

// Deterministic JSON: same data → same string (metadata excluded by caller).
export function canonicalStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalStringify(v[k])}`).join(',')}}`;
}

// Manifest embedded in every versioned backup: counts, integrity hash,
// currency/paise conventions, app/feature support info.
export function buildManifest(data, opts = {}) {
  const counts = summarizeBackup(data);
  const canonical = canonicalStringify(data);
  return {
    collections: PORTABLE_COLLECTIONS,
    counts,
    integrity: { algo: 'sha256', value: createHash('sha256').update(canonical).digest('hex') },
    currency: 'INR',
    money: 'integer paise internally; rupees (≤2 decimals) at the API/backup boundary',
    appVersion: opts.appVersion || BACKUP_APP_VERSION,
    features: opts.features || ['transactions', 'accounts', 'budgets', 'goals', 'recurring', 'autopilot', 'notifications', 'imports', 'preferences']
  };
}

export function verifyManifest(data, manifest) {
  if (!manifest || typeof manifest !== 'object') return { ok: false, error: 'missing manifest' };
  if (!manifest.integrity || manifest.integrity.algo !== 'sha256' || !manifest.integrity.value) {
    return { ok: false, error: 'missing integrity metadata' };
  }
  const actual = createHash('sha256').update(canonicalStringify(data)).digest('hex');
  if (actual !== manifest.integrity.value) return { ok: false, error: 'integrity mismatch — backup was modified after export' };
  return { ok: true };
}

const toPaiseInt = (rupees) => Math.round(Number(rupees) * 100);

// Restore preview (pure, never writes): per-collection added / replaced /
// removed / conflicts for a mode, plus the balance effect in integer paise.
// live = { transactions:[], accounts:[], categories:[], upiIds:[], goals:[],
//          contributions:[], recurring:[], autopilotRules:[], autopilotRuns:[],
//          notifications:[], imports:[], budgets:{} }
export function diffPreview(live, incoming, mode = 'merge') {
  const per = {};
  const keys = ['transactions', 'accounts', 'categories', 'upiIds', 'goals', 'contributions', 'recurring', 'autopilotRules', 'autopilotRuns', 'notifications', 'imports'];
  for (const k of keys) {
    const liveIds = new Set((live[k] || []).map((r) => r && (r.id || r.key)).filter(Boolean));
    const inIds = (incoming[k] || []).map((r) => r && (r.id || r.key)).filter(Boolean);
    const inSet = new Set(inIds);
    const added = inIds.filter((id) => !liveIds.has(id)).length;
    const collisions = inIds.filter((id) => liveIds.has(id));
    if (mode === 'merge') {
      per[k] = { added, replaced: 0, removed: 0, conflicts: collisions.slice(0, 20), conflictCount: collisions.length };
    } else {
      const removed = [...liveIds].filter((id) => !inSet.has(id)).length;
      per[k] = { added, replaced: collisions.length, removed, conflicts: [], conflictCount: 0 };
    }
  }
  const liveBudgets = live.budgets || {};
  const inBudgets = incoming.budgets || {};
  const bAdded = Object.keys(inBudgets).filter((c) => !(c in liveBudgets));
  const bUpdated = Object.keys(inBudgets).filter((c) => c in liveBudgets && Number(liveBudgets[c]) !== Number(inBudgets[c]));
  const bRemoved = mode === 'replace' ? Object.keys(liveBudgets).filter((c) => !(c in inBudgets)) : [];
  per.budgets = { added: bAdded.length, replaced: bUpdated.length, removed: bRemoved.length, conflicts: [], conflictCount: 0, detail: { added: bAdded.slice(0, 20), updated: bUpdated.slice(0, 20), removed: bRemoved.slice(0, 20) } };
  // Balance effect: completed income/expense sums, live vs post-restore.
  const sums = (txns) => {
    let income = 0, expense = 0;
    for (const t of txns || []) {
      if (t && t.status && t.status !== 'completed') continue;
      const p = Number.isFinite(Number(t.amountPaise)) ? Math.round(Number(t.amountPaise)) : toPaiseInt(t.amount || 0);
      if (t.type === 'income') income += p;
      else if (t.type === 'expense') expense += p;
      else if (t.type === 'refund') expense -= p;
    }
    return { incomePaise: income, expensePaise: expense };
  };
  const liveSums = sums(live.transactions);
  const liveTxnIds = new Set((live.transactions || []).map((t) => t && t.id).filter(Boolean));
  // Merge skips id collisions, so colliding incoming rows must not move the
  // projected totals; replace takes the incoming ledger as-is.
  const effectiveIncoming = mode === 'merge'
    ? (incoming.transactions || []).filter((t) => !t || !t.id || !liveTxnIds.has(t.id))
    : (incoming.transactions || []);
  const inSums = sums(effectiveIncoming.map((t) => ({ ...t, amountPaise: undefined })));
  const scenario = mode === 'merge'
    ? { incomePaise: liveSums.incomePaise + inSums.incomePaise, expensePaise: liveSums.expensePaise + inSums.expensePaise }
    : inSums;
  return {
    per,
    balanceEffect: {
      live: liveSums,
      scenario,
      deltaIncomePaise: scenario.incomePaise - liveSums.incomePaise,
      deltaExpensePaise: scenario.expensePaise - liveSums.expensePaise
    }
  };
}

export function summarizeBackup(data) {
  const counts = {};
  for (const k of ['transactions', 'accounts', 'categories', 'upiIds', 'goals', 'contributions', 'recurring', 'autopilotRules']) {
    counts[k] = (data[k] || []).length;
  }
  counts.budgets = Object.keys(data.budgets || {}).length;
  return counts;
}

const CSV_HEAD = ['id', 'date', 'type', 'amount', 'category', 'subcategory', 'paymentMethod', 'account', 'accountFrom', 'accountTo', 'merchant', 'upiRef', 'description', 'status'];
const csvEsc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// Server- and client-compatible CSV for one account's ledger rows.
export function buildAccountCsv(transactions) {
  const rows = (transactions || []).map((t) => CSV_HEAD.map((k) => csvEsc(t[k])).join(','));
  return [CSV_HEAD.join(','), ...rows].join('\n');
}
