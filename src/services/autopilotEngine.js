// FinTrack Autopilot engine — pure rule validation, matching and detection.
// Zero dependencies; imported by server.js AND tests/autopilot.test.mjs.
// Money handled in RUPEES here (server converts paise at the boundary).
export const AUTOPILOT_TRIGGERS = [
  'transaction_added',
  'salary_detected',
  'budget_threshold',
  'recurring_approaching',
  'unusual_transaction',
  'month_closed'
];

const TXN_FIELDS = ['amount', 'category', 'type', 'account', 'merchant'];
const BREACH_FIELDS = ['category', 'spent', 'pct'];
const SUMMARY_FIELDS = ['income', 'spent', 'net', 'savings_rate'];
const NUMERIC_FIELDS = new Set(['amount', 'spent', 'pct', 'income', 'net', 'savings_rate']);
const COND_OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'in', 'contains'];

export function allowedFields(trigger) {
  if (trigger === 'budget_threshold') return BREACH_FIELDS;
  if (trigger === 'month_closed') return SUMMARY_FIELDS;
  return TXN_FIELDS; // transaction_added, salary_detected, unusual_transaction, recurring_approaching
}

function str(v, max = 120) {
  return String(v ?? '').trim().slice(0, max);
}

export function validateCondition(c, trigger) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['condition must be an object'];
  if (!allowedFields(trigger).includes(c.field)) {
    errors.push(`field must be one of: ${allowedFields(trigger).join(', ')}`);
  }
  if (!COND_OPS.includes(c.op)) errors.push(`op must be one of: ${COND_OPS.join(', ')}`);
  if (c.op === 'in') {
    if (!Array.isArray(c.value) || c.value.length === 0 || c.value.length > 10) {
      errors.push('in value must be an array of 1–10 strings');
    } else if (!c.value.every((v) => typeof v === 'string' && v.trim())) {
      errors.push('in value must be non-empty strings');
    }
  } else if (NUMERIC_FIELDS.has(c.field)) {
    if (!Number.isFinite(Number(c.value))) errors.push(`${c.field} condition value must be a number`);
  } else if (!str(c.value)) {
    errors.push(`${c.field} condition value must be a non-empty string`);
  }
  return errors;
}

const ACTION_KINDS = ['notify', 'suggest', 'create_draft'];

export function validateAction(a, trigger) {
  const errors = [];
  if (!a || typeof a !== 'object') return ['action must be an object'];
  if (!ACTION_KINDS.includes(a.kind)) return [`kind must be one of: ${ACTION_KINDS.join(', ')}`];
  if (a.kind === 'notify' || a.kind === 'suggest') {
    if (!str(a.message, 500)) errors.push(`${a.kind} action needs a message (max 500 chars)`);
    if (a.kind === 'suggest' && a.category !== undefined && !str(a.category, 80)) {
      errors.push('suggest category must be a non-empty string');
    }
  }
  if (a.kind === 'create_draft') {
    if (!['transaction_added', 'salary_detected'].includes(trigger)) {
      errors.push('create_draft is only allowed on transaction_added / salary_detected triggers');
    }
    if (!['expense', 'income'].includes(a.txType)) errors.push('draft txType must be expense | income');
    if (!str(a.category, 80)) errors.push('draft category is required');
    if (!str(a.account, 80)) errors.push('draft account is required');
    if (a.merchant !== undefined && typeof a.merchant !== 'string') errors.push('draft merchant must be a string');
    if (a.note !== undefined && String(a.note).length > 300) errors.push('draft note max 300 chars');
  }
  return errors;
}

export function validateRule(body = {}) {
  const errors = [];
  if (!str(body.name, 80)) errors.push('name is required (max 80 chars)');
  if (!AUTOPILOT_TRIGGERS.includes(body.trigger)) {
    errors.push(`trigger must be one of: ${AUTOPILOT_TRIGGERS.join(', ')}`);
  }
  const conditions = Array.isArray(body.conditions) ? body.conditions : null;
  if (!conditions || conditions.length > 10) {
    errors.push('conditions must be an array of 0–10 entries');
  } else {
    conditions.forEach((c, i) => {
      for (const e of validateCondition(c, body.trigger)) errors.push(`conditions[${i}]: ${e}`);
    });
  }
  const actions = Array.isArray(body.actions) ? body.actions : null;
  if (!actions || actions.length === 0 || actions.length > 5) {
    errors.push('actions must be an array of 1–5 entries');
  } else {
    actions.forEach((a, i) => {
      for (const e of validateAction(a, body.trigger)) errors.push(`actions[${i}]: ${e}`);
    });
  }
  if (body.requireApproval !== undefined && typeof body.requireApproval !== 'boolean') {
    errors.push('requireApproval must be a boolean');
  }
  const params = body.params || {};
  if (body.trigger === 'budget_threshold') {
    const t = params.thresholdPct === undefined ? 80 : Number(params.thresholdPct);
    if (!Number.isFinite(t) || t <= 0 || t > 1000) errors.push('params.thresholdPct must be 1–1000');
  }
  if (body.trigger === 'recurring_approaching') {
    const d = params.daysBefore === undefined ? 3 : Number(params.daysBefore);
    if (!Number.isInteger(d) || d < 1 || d > 30) errors.push('params.daysBefore must be an integer 1–30');
  }
  return errors;
}

// ── Matching ─────────────────────────────────────────────
export function fieldValue(record, field) {
  switch (field) {
    case 'amount': return Number(record.amount) || 0;
    case 'spent': return Number(record.spent ?? record.amount) || 0;
    case 'pct': return Number(record.pct) || 0;
    case 'income': return Number(record.income) || 0;
    case 'net': return Number(record.net) || 0;
    case 'savings_rate': return Number(record.savings_rate) || 0;
    case 'category': return String(record.category || '');
    case 'type': return String(record.type || '');
    case 'account': return String(record.account || record.accountFrom || '');
    case 'merchant': return String(record.merchant || '');
    default: return '';
  }
}

export function matchCondition(record, c) {
  const v = fieldValue(record, c.field);
  if (NUMERIC_FIELDS.has(c.field)) {
    const n = Number(c.value);
    switch (c.op) {
      case 'gt': return v > n;
      case 'gte': return v >= n;
      case 'lt': return v < n;
      case 'lte': return v <= n;
      case 'eq': return v === n;
      case 'neq': return v !== n;
      default: return false;
    }
  }
  const s = String(v).toLowerCase();
  switch (c.op) {
    case 'eq': return s === String(c.value).toLowerCase();
    case 'neq': return s !== String(c.value).toLowerCase();
    case 'contains': return s.includes(String(c.value).toLowerCase());
    case 'in': return (c.value || []).some((x) => String(x).toLowerCase() === s);
    default: return false;
  }
}

export function matchConditions(record, conditions) {
  return (conditions || []).every((c) => matchCondition(record, c));
}

// ── Detectors ────────────────────────────────────────────
const SALARY_CATEGORIES = new Set(['salary', 'freelance', 'business income']);
const SALARY_HINTS = ['salary', 'payroll', 'payslip', 'employer'];

export function detectSalary(txn) {
  if (String(txn.type || '').toLowerCase() !== 'income') return false;
  const cat = String(txn.category || '').toLowerCase();
  if (SALARY_CATEGORIES.has(cat)) return true;
  const merch = String(txn.merchant || '').toLowerCase();
  return SALARY_HINTS.some((h) => merch.includes(h));
}

// Unusual = amount above 3× the median of recent completed expenses.
// Needs ≥5 history points, otherwise abstains (never fires blind).
export function isUnusualAmount(amount, history) {
  const amt = Number(amount) || 0;
  const hist = (history || []).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (hist.length < 5) return { unusual: false, reason: 'insufficient history (need 5+ expenses)' };
  const median = hist.length % 2
    ? hist[(hist.length - 1) / 2]
    : (hist[hist.length / 2 - 1] + hist[hist.length / 2]) / 2;
  const threshold = Math.max(median * 3, 1000);
  return {
    unusual: amt > threshold,
    median: Math.round(median * 100) / 100,
    threshold: Math.round(threshold * 100) / 100,
    reason: amt > threshold ? `₹${amt} exceeds 3× median (₹${median})` : 'within normal range'
  };
}

// Budget breaches for a month: spent vs limit at/above thresholdPct.
export function budgetBreaches(transactions, budgets, monthPrefix, thresholdPct = 80) {
  const spent = new Map();
  for (const t of transactions || []) {
    if ((!t.status || t.status === 'completed') && t.type === 'expense' &&
      String(t.date || '').startsWith(monthPrefix)) {
      spent.set(t.category, (spent.get(t.category) || 0) + (Number(t.amount) || 0));
    }
  }
  const out = [];
  for (const [category, limitRaw] of Object.entries(budgets || {})) {
    const limit = Number(limitRaw) || 0;
    if (limit <= 0) continue;
    const s = Math.round((spent.get(category) || 0) * 100) / 100;
    const pct = Math.round((s / limit) * 1000) / 10;
    if (pct >= thresholdPct) out.push({ category, spent: s, limit, pct });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

// Previous-month summary for the month_closed trigger.
export function monthSummary(transactions, monthPrefix) {
  const rows = (transactions || []).filter((t) =>
    (!t.status || t.status === 'completed') && String(t.date || '').startsWith(monthPrefix));
  const income = rows.filter((t) => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const spent = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0)
    - rows.filter((t) => t.type === 'refund').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const net = Math.round((income - spent) * 100) / 100;
  return {
    income: Math.round(income * 100) / 100,
    spent: Math.round(spent * 100) / 100,
    net,
    savings_rate: income > 0 ? Math.round(((income - spent) / income) * 1000) / 10 : 0
  };
}

export function previousMonthPrefix(refISO = new Date().toISOString().slice(0, 10)) {
  const [y, m] = refISO.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

// Idempotency: one key per (rule, trigger, entity) — replays are skipped.
export function idempotencyKey(ruleId, trigger, ref) {
  return `${ruleId}:${trigger}:${String(ref)}`;
}
