// Data portability — pure backup validation, normalization and CSV building.
// Shared by server.js and tests/portability.test.mjs. No I/O, no dependencies
// except the autopilot rule validator (also pure).
import { validateRule } from './autopilotEngine.js';

export const BACKUP_FORMAT = 'fintrack-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_MAX_TRANSACTIONS = 10000;
export const RESTORE_REPLACE_PHRASE = 'REPLACE ALL MY DATA';

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
    autopilotRules: Array.isArray(data.autopilotRules) ? data.autopilotRules : [],
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

// Validate every record; returns per-collection {valid, invalid} + capped errors.
export function validateBackupData(data) {
  const out = { valid: {}, invalid: {}, errors: [] };
  const check = (key, list, fn) => {
    let v = 0;
    list.forEach((r, i) => {
      const errs = fn(r);
      if (errs.length === 0) v++;
      else if (out.errors.length < 50) out.errors.push(`${key}[${i}]: ${errs.join('; ')}`);
    });
    out.valid[key] = v;
    out.invalid[key] = list.length - v;
  };
  check('transactions', data.transactions, validateBackupTransaction);
  check('accounts', data.accounts, validateBackupAccount);
  check('goals', data.goals, validateBackupGoal);
  check('contributions', data.contributions, validateBackupContribution);
  check('recurring', data.recurring, validateBackupRecurring);
  check('categories', data.categories, validateBackupCategory);
  check('upiIds', data.upiIds, validateBackupUpi);
  check('autopilotRules', data.autopilotRules, (r) => validateRule(r || {}));
  const bErrs = Object.entries(data.budgets || {}).flatMap(([cat, amt]) =>
    (!cat || !Number.isFinite(Number(amt)) || Number(amt) < 0) ? [`budgets[${cat}]: must be >= 0`] : []);
  out.valid.budgets = Object.keys(data.budgets || {}).length - bErrs.length;
  out.invalid.budgets = bErrs.length;
  out.errors.push(...bErrs.slice(0, 50 - out.errors.length));
  const pErrs = validatePreferences(data.preferences);
  out.valid.preferences = pErrs.length === 0 ? 1 : 0;
  out.invalid.preferences = pErrs.length === 0 ? 0 : 1;
  if (pErrs.length) out.errors.push(`preferences: ${pErrs.join('; ')}`);
  return out;
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
