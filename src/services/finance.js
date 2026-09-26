// ─────────────────────────────────────────────────────────────
// finance.js — centralized financial calculation engine (frontend).
// All money math uses INTEGER paise. Every figure is derived from the
// transaction ledger + account opening balances. No hardcoded totals.
//
// Accounting rules (mirror server.js accountBalances):
// - Asset account: opening + received − paid (completed txns only)
// - Credit card:   opening liability + purchases − payments − credits
// - Transfers move money between accounts; never income/expense
// - Refunds offset expenses; never counted as income
// - Savings rate = (income − expenses) / income × 100, null when income = 0
// ─────────────────────────────────────────────────────────────

export const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
export const toRupees = (paise) => (paise || 0) / 100;

export function formatINR(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0
  }).format(n);
}

const LIABILITY = new Set(['credit_card']);

function inMonth(dateISO, monthKey) {
  return typeof dateISO === 'string' && dateISO.slice(0, 7) === monthKey;
}

function completedIn(t, monthKey) {
  if (t.status && t.status !== 'completed') return false;
  return !monthKey || inMonth(t.date, monthKey);
}

/** Signed ledger effect of one txn on its account, in paise. */
export function txnEffectPaise(t) {
  const p = toPaise(t.amount);
  if (t.type === 'income' || t.type === 'refund') return p;
  if (t.type === 'expense') return -p;
  if (t.type === 'adjustment') return p; // signed correction stored by caller convention
  return 0; // transfers handled per-account below
}

/**
 * Per-account balances from openings + ledger.
 * accounts: [{id?, name, type, openingBalance}] — server rows already carry
 *   `balance`, but this recomputes from raw openings for pages that need it.
 */
export function computeBalances(accounts, transactions) {
  const byName = new Map((accounts || []).map((a) => [a.name, a]));
  const bal = new Map((accounts || []).map((a) => [a.name, toPaise(a.openingBalance)]));
  const LIABILITY_TYPES = new Set(['credit_card']);
  // Asset-convention delta, negated for liability accounts.
  const add = (name, d) => {
    const a = byName.get(name);
    if (a) bal.set(name, (bal.get(name) || 0) + (LIABILITY_TYPES.has(a.type) ? -d : d));
  };
  for (const t of transactions || []) {
    if (t.status && t.status !== 'completed') continue;
    const p = toPaise(t.amount);
    if (t.type === 'income' || t.type === 'refund') add(t.account, p);
    else if (t.type === 'expense') add(t.account, -p);
    else if (t.type === 'adjustment') add(t.account, p);
    else if (t.type === 'transfer') {
      if (t.accountFrom) add(t.accountFrom, -p);
      if (t.accountTo) add(t.accountTo, p);
    }
  }
  return (accounts || []).map((a) => ({ ...a, balance: toRupees(bal.get(a.name) || 0) }));
}

/** Month income/expense totals in rupees (transfers excluded). */
export function monthTotals(transactions, monthKey) {
  let incomeP = 0, expenseP = 0;
  for (const t of transactions || []) {
    if (!completedIn(t, monthKey)) continue;
    const p = toPaise(t.amount);
    if (t.type === 'income') incomeP += p;
    else if (t.type === 'expense') expenseP += p;
    else if (t.type === 'refund') expenseP -= p;
  }
  const income = toRupees(incomeP), expenses = toRupees(expenseP);
  const net = income - expenses;
  return {
    income, expenses, net,
    savingsRate: incomeP === 0 ? null : ((incomeP - expenseP) / incomeP) * 100
  };
}

/** Overview figures for the dashboard. All real, all from the ledger. */
export function overview(transactions, accounts, budgets, monthKey) {
  const withBal = computeBalances(accounts, transactions);
  let assets = 0, liabilities = 0;
  for (const a of withBal) {
    if (LIABILITY.has(a.type)) liabilities += a.balance;
    else assets += a.balance;
  }
  const m = monthTotals(transactions, monthKey);
  const budgetTotal = Object.values(budgets || {}).reduce((s, v) => s + Number(v || 0), 0);
  return {
    accounts: withBal,
    totalAssets: assets,
    totalLiabilities: liabilities,
    netWorth: assets - liabilities,
    availableBalance: assets, // cash-like money across asset accounts
    ...m,
    budgetTotal,
    remainingBudget: budgetTotal - m.expenses
  };
}

export function currentMonthKey(timezone = 'Asia/Kolkata', now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit'
    }).formatToParts(now);
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    return `${y}-${m}`;
  } catch {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
