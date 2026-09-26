// ─────────────────────────────────────────────────────────────
// importNormalize.js — bank-statement → ledger row normalization.
// Shared by the browser parser (statementParsers.js) and the API
// (server.js import preview/confirm), so a file that previews clean
// also imports clean. Pure ESM, no I/O, importable from node:test.
// ─────────────────────────────────────────────────────────────

// Bank/UPI exports say debit/credit — the ledger says expense/income.
const TYPE_MAP = {
  debit: 'expense', debited: 'expense', dr: 'expense', spent: 'expense',
  paid: 'expense', withdrawal: 'expense', withdraw: 'expense', out: 'expense',
  expense: 'expense', expenses: 'expense',
  credit: 'income', credited: 'income', cr: 'income', received: 'income',
  deposit: 'income', deposited: 'income', in: 'income',
  income: 'income', refund: 'refund', adjustment: 'adjustment',
  transfer: 'transfer',
};

// Bank status columns say SUCCESS/FAILED — the ledger says completed/pending.
const STATUS_OK = new Set([
  'completed', 'complete', 'success', 'successful', 'successfull', 'settled',
  'done', 'paid', 'posted', 'cleared', 'ok', 'approved',
]);
const STATUS_PENDING = new Set([
  'pending', 'in progress', 'inprogress', 'processing', 'scheduled',
  'initiated', 'awaiting', 'on hold', 'hold',
]);
// No money moved — these rows must never become ledger entries.
const STATUS_DEAD = new Set([
  'failed', 'failure', 'fail', 'declined', 'cancelled', 'canceled',
  'rejected', 'expired', 'error', 'unsuccessful', 'reversed txn',
]);

// Common bank-app category labels → FinTrack categories.
const CATEGORY_MAP = {
  'food & dining': 'Food', food: 'Food', dining: 'Food',
  'bills & utilities': 'Housing', 'bills': 'Housing', utilities: 'Housing',
  'upi payment': 'Miscellaneous', 'upi': 'Miscellaneous',
  transfer: 'Transfer', transfers: 'Transfer',
  health: 'Health', shopping: 'Shopping', income: 'Salary',
};

export function normalizeType(raw) {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return '';
  return TYPE_MAP[t] || t;
}

// Returns 'completed' | 'pending' | 'scheduled' | { skip: reason }.
// Empty/unknown-but-harmless statuses default to completed (bank CSV rows
// are historical records of settled statements by default).
export function normalizeStatus(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'completed';
  if (STATUS_OK.has(s)) return 'completed';
  if (STATUS_PENDING.has(s)) {
    return s === 'scheduled' ? 'scheduled' : 'pending';
  }
  if (STATUS_DEAD.has(s)) {
    return { skip: `bank status "${String(raw).trim()}" — no money moved, not imported` };
  }
  // Unknown status values (e.g. bank-specific codes): keep the row alive
  // as completed but flag nothing — validation still applies.
  if (/^(completed|pending|scheduled)$/.test(s)) return s;
  return 'completed';
}

export function normalizeCategory(raw, type) {
  const c = String(raw ?? '').trim();
  if (!c) return 'Miscellaneous';
  const hit = CATEGORY_MAP[c.toLowerCase()];
  if (hit) {
    // A "Reversal" credit is money coming back → refund, not income.
    if (c.toLowerCase() === 'reversal') return 'Miscellaneous';
    return hit;
  }
  return c;
}

// Export files often put a bare account number (e.g. 6052458790) in the
// account column. That is a bank reference, not a FinTrack account —
// stash it into the description and let the caller apply the real account.
export function isBareAccountRef(value) {
  const s = String(value ?? '').trim();
  return /^\d{6,}$/.test(s.replace(/[\s-]/g, ''));
}

export function normalizeImportRow(raw) {
  const r = { ...(raw || {}) };
  const type = normalizeType(r.type);
  if (type) r.type = type;
  const status = normalizeStatus(r.status);
  if (status && typeof status === 'object' && status.skip) {
    return { skipped: true, reason: status.skip, row: r };
  }
  r.status = status || 'completed';
  // Credit reversals are refunds (money returned), never new income.
  const catRaw = String(r.category ?? '').trim().toLowerCase();
  if (catRaw === 'reversal' && r.type === 'income') r.type = 'refund';
  r.category = normalizeCategory(r.category, r.type);
  if (isBareAccountRef(r.account)) {
    const ref = String(r.account).trim();
    r.account = '';
    r.description = [r.description, `Acct ${ref}`].filter(Boolean).join(' · ').slice(0, 200);
  }
  if (typeof r.amount === 'string') {
    const n = Number(r.amount.replace(/[₹,\s]/g, ''));
    if (Number.isFinite(n)) r.amount = n;
  }
  return { skipped: false, row: r };
}
