// ─────────────────────────────────────────────────────────────
// insightsService.js — tips, suggestions, trends, health score &
// money-tool calculators. Pure ESM (React + node:test safe).
// Every personalized figure derives from the user's own ledger;
// generic tips are used only when there is no data yet.
// ─────────────────────────────────────────────────────────────
import {
  ESSENTIAL_CATEGORIES, expenseByCategory, getDateRange,
  monthlySeries, summarizeLedger, weekdayAnalysis
} from './analyticsService.js';
import { monthTotals } from './finance.js';

// ── 1. Tip of the day (rotating, deterministic per date) ──
export const DAILY_TIPS = [
  { title: 'Pay yourself first', body: 'Move 10–20% of every income to savings the day salary lands — before spending a rupee.' },
  { title: 'Track the small leaks', body: '₹99–₹299 subscriptions and daily chai add up. Review them monthly under Recurring.' },
  { title: 'The 24-hour rule', body: 'Want an unplanned purchase above ₹2,000? Wait 24 hours. Most urges fade.' },
  { title: 'Cook twice more a week', body: 'Two extra home-cooked meals a week can cut food delivery spend by ~30%.' },
  { title: 'Automate the boring', body: 'Auto-create rent, SIPs and bills as recurring rules so nothing is missed or doubled.' },
  { title: 'Build a 6-month cushion', body: 'Aim for 6× monthly expenses in liquid savings before aggressive investing.' },
  { title: 'Kill one subscription', body: 'Pick the streaming or app you opened least this month and pause it for 30 days.' },
  { title: 'UPI audit Fridays', body: 'Every Friday, scan the week\'s UPI debits — small daily spends are the silent budget killers.' },
  { title: '50/30/20 check', body: 'Needs ≤50%, wants ≤30%, savings ≥20% of income. Rebalance when wants creep up.' },
  { title: 'Round-up saving', body: 'After any expense, transfer the round-up (e.g. ₹450 → ₹50) to your goal account.' },
  { title: 'Name every rupee', body: 'Give each income a job — rent, SIP, goals, fun — before the month starts.' },
  { title: 'Compare, don\'t compete', body: 'Benchmark spending against your own last 3 months, not anyone else\'s lifestyle.' },
  { title: 'One no-spend day weekly', body: 'Pick one day a week with zero discretionary spending. It resets habits fast.' },
  { title: 'Review statements monthly', body: 'Import your HDFC/SBI/ICICI statement each month — banks catch what memory misses.' },
];

export function tipOfTheDay(dateISO) {
  const d = dateISO || new Date().toISOString().slice(0, 10);
  let h = 0;
  for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { ...DAILY_TIPS[h % DAILY_TIPS.length], date: d };
}

// ── 2. Personalized tips (ledger-driven) ──
export function personalizedTips(transactions, monthKey) {
  const tips = [];
  if (!transactions || transactions.length === 0) {
    return [
      { icon: '🌱', title: 'Start your ledger', body: 'Add your first 10 transactions — personalized tips unlock automatically from your real spending.' },
      { icon: '🏦', title: 'Connect your routine', body: 'Import a bank statement to see where money actually goes in minutes.' },
    ];
  }
  const range = (() => { try { return getDateRange('this-month'); } catch { return null; } })();
  const byCat = range ? expenseByCategory(transactions, range, {}) : { rows: [], total: 0 };
  const m = monthTotals(transactions, monthKey);
  const food = byCat.rows.find((r) => r.category === 'Food');
  if (food && byCat.total > 0 && food.amount / byCat.total > 0.35) {
    tips.push({ icon: '🍳', title: 'Food is your top leak', body: `Food is ${((food.amount / byCat.total) * 100).toFixed(0)}% of spending. Two more home-cooked meals a week could save ~30% of it.` });
  }
  if (m.savingsRate !== null && m.savingsRate < 10) {
    tips.push({ icon: '🐷', title: 'Savings rate is thin', body: `This month you save ${m.savingsRate.toFixed(1)}%. Automate a 10% transfer on salary day to pay yourself first.` });
  }
  if (m.savingsRate !== null && m.savingsRate >= 20) {
    tips.push({ icon: '🌟', title: 'Excellent savings rate', body: `Saving ${m.savingsRate.toFixed(1)}% — consider routing the surplus into a goal-linked SIP.` });
  }
  const upi = transactions.filter((t) => t.paymentMethod === 'UPI' && t.type === 'expense').length;
  if (upi >= 20) {
    tips.push({ icon: '📱', title: 'Heavy UPI month', body: `${upi} UPI payments recorded. Do a Friday UPI audit — small daily debits add up silently.` });
  }
  const subs = byCat.rows.find((r) => r.category === 'Entertainment');
  if (subs && m.expenses > 0 && subs.amount / m.expenses > 0.15) {
    tips.push({ icon: '📺', title: 'Entertainment creep', body: 'Entertainment is over 15% of spending. Pause your least-used subscription for 30 days.' });
  }
  if (tips.length === 0) {
    tips.push({ icon: '✅', title: 'Spending looks balanced', body: 'No single category dominates. Keep the streak — try a no-spend day this week.' });
  }
  return tips.slice(0, 4);
}

// ── 3. Smart suggestions (actionable, with numbers) ──
export function smartSuggestions(transactions, budgets, recurring, monthKey) {
  const out = [];
  if (!transactions || transactions.length === 0) {
    return [{ icon: '🚀', title: 'Import or add data', body: 'Suggestions appear once your ledger has transactions.', action: 'Import statement →' }];
  }
  const range = (() => { try { return getDateRange('this-month'); } catch { return null; } })();
  const byCat = range ? expenseByCategory(transactions, range, {}) : { rows: [], total: 0 };
  const top = byCat.rows[0];
  if (top && top.amount > 0) {
    const save = Math.round(top.amount * 0.1);
    out.push({ icon: '✂️', title: `Trim ${top.category} by 10%`, body: `Save ≈ ₹${save.toLocaleString('en-IN')}/month without lifestyle shock.`, action: 'Review budgets →' });
  }
  const subs = (recurring || []).filter((r) => r.status === 'active' && r.type === 'expense');
  if (subs.length > 0) {
    const total = subs.reduce((s, r) => s + Number(r.amount || 0), 0);
    out.push({ icon: '🔁', title: `Audit ${subs.length} subscription${subs.length === 1 ? '' : 's'}`, body: `Active recurring outflows total ≈ ₹${Math.round(total).toLocaleString('en-IN')}/cycle. Cancel or pause one you barely use.`, action: 'Open recurring →' });
  }
  for (const [cat, limit] of Object.entries(budgets || {})) {
    const spent = byCat.rows.find((r) => r.category === cat)?.amount || 0;
    if (limit > 0 && spent > limit) {
      out.push({ icon: '🚨', title: `${cat} is over budget`, body: `Spent ₹${Math.round(spent).toLocaleString('en-IN')} of ₹${Number(limit).toLocaleString('en-IN')} limit. Freeze ${cat} extras till month-end.`, action: 'Open budgets →' });
      break;
    }
  }
  const m = monthTotals(transactions, monthKey);
  if (m.income > 0 && m.net > 0) {
    out.push({ icon: '🎯', title: 'Put the surplus to work', body: `₹${Math.round(m.net).toLocaleString('en-IN')} unspent this month. Sweep it into a savings goal before it evaporates.`, action: 'Open goals →' });
  }
  if (out.length === 0) out.push({ icon: '👍', title: 'All clear', body: 'No overspending or leaks detected this month.' });
  return out.slice(0, 5);
}

// ── 4–6. Trends bundle (6-month series, movers, weekday) ──
export function trendsBundle(transactions) {
  let months = [];
  try {
    const now = getDateRange('this-month');
    const startMonth = now.start.slice(0, 7);
    const [y, mo] = startMonth.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1));
    first.setUTCMonth(first.getUTCMonth() - 5);
    const start = first.toISOString().slice(0, 10);
    const rows = monthlySeries(transactions, { start, end: now.end }, {});
    months = rows.map((r) => ({ month: r.date, expense: Math.round(r.expense), income: Math.round(r.income), net: Math.round(r.net) }));
  } catch { months = []; }
  let movers = [];
  try {
    const cur = getDateRange('this-month');
    const prevStart = cur.start.slice(0, 7) === cur.end.slice(0, 7)
      ? null : null;
    void prevStart;
    const last = getDateRange('last-month');
    const c = expenseByCategory(transactions, cur, {});
    const p = expenseByCategory(transactions, last, {});
    movers = c.rows.slice(0, 6).map((r) => {
      const pa = p.rows.find((x) => x.category === r.category)?.amount || 0;
      const diff = r.amount - pa;
      const pct = pa === 0 ? null : (diff / pa) * 100;
      return { category: r.category, current: Math.round(r.amount), previous: Math.round(pa), diff: Math.round(diff), pct };
    }).sort((a, b) => b.diff - a.diff);
  } catch { movers = []; }
  let weekday = null;
  try {
    const cur = getDateRange('last-3-months');
    const rows = weekdayAnalysis(transactions, cur, {});
    const worst = [...rows].sort((a, b) => b.total - a.total)[0];
    const best = [...rows].sort((a, b) => a.total - b.total)[0];
    weekday = { worst, best, rows };
  } catch { weekday = null; }
  return { months, movers, weekday };
}

// ── 7. Financial health score (0–100, explainable) ──
export function healthScore(transactions, accounts, budgets, monthKey) {
  const parts = [];
  let score = 0;
  const m = monthTotals(transactions || [], monthKey);
  // Savings rate → 30
  if (m.savingsRate === null) parts.push({ label: 'Savings rate', points: 0, max: 30, note: 'No income this month' });
  else if (m.savingsRate >= 20) { score += 30; parts.push({ label: 'Savings rate', points: 30, max: 30, note: `${m.savingsRate.toFixed(1)}% — great` }); }
  else if (m.savingsRate >= 10) { score += 20; parts.push({ label: 'Savings rate', points: 20, max: 30, note: `${m.savingsRate.toFixed(1)}% — okay` }); }
  else if (m.savingsRate > 0) { score += 10; parts.push({ label: 'Savings rate', points: 10, max: 30, note: `${m.savingsRate.toFixed(1)}% — thin` }); }
  else parts.push({ label: 'Savings rate', points: 0, max: 30, note: 'Spending ≥ income' });
  // Budget adherence → 25
  const budgetTotal = Object.values(budgets || {}).reduce((s, v) => s + Number(v || 0), 0);
  if (budgetTotal <= 0) parts.push({ label: 'Budget control', points: 10, max: 25, note: 'No budgets set — set limits to score' });
  else if (m.expenses <= budgetTotal) { score += 25; parts.push({ label: 'Budget control', points: 25, max: 25, note: 'Within total budget' }); }
  else {
    const over = (m.expenses - budgetTotal) / budgetTotal;
    const pts = over > 0.5 ? 0 : over > 0.2 ? 10 : 15;
    score += pts;
    parts.push({ label: 'Budget control', points: pts, max: 25, note: `${(over * 100).toFixed(0)}% over budget` });
  }
  // Emergency cushion → 25 (liquid assets vs monthly burn)
  const liquid = (accounts || []).filter((a) => a.type !== 'credit_card')
    .reduce((s, a) => s + Number(a.balance || 0), 0);
  const burn = m.expenses > 0 ? m.expenses : 1;
  const cover = liquid / burn;
  if (cover >= 6) { score += 25; parts.push({ label: 'Emergency cushion', points: 25, max: 25, note: `${cover.toFixed(1)} months covered` }); }
  else if (cover >= 3) { score += 18; parts.push({ label: 'Emergency cushion', points: 18, max: 25, note: `${cover.toFixed(1)} months covered` }); }
  else if (cover >= 1) { score += 10; parts.push({ label: 'Emergency cushion', points: 10, max: 25, note: `${cover.toFixed(1)} month covered` }); }
  else parts.push({ label: 'Emergency cushion', points: 0, max: 25, note: 'Under 1 month of expenses' });
  // No credit-card stress → 10
  const cardDebt = (accounts || []).filter((a) => a.type === 'credit_card')
    .reduce((s, a) => s + Number(a.balance || 0), 0);
  if (cardDebt <= 0) { score += 10; parts.push({ label: 'Card debt', points: 10, max: 10, note: 'No outstanding' }); }
  else if (m.income > 0 && cardDebt / m.income < 0.3) { score += 6; parts.push({ label: 'Card debt', points: 6, max: 10, note: 'Manageable' }); }
  else parts.push({ label: 'Card debt', points: 0, max: 10, note: 'High outstanding' });
  // Data depth → 10
  if ((transactions || []).length >= 30) { score += 10; parts.push({ label: 'Tracking habit', points: 10, max: 10, note: `${transactions.length} transactions` }); }
  else if ((transactions || []).length >= 10) { score += 6; parts.push({ label: 'Tracking habit', points: 6, max: 10, note: `${transactions.length} transactions` }); }
  else parts.push({ label: 'Tracking habit', points: 0, max: 10, note: 'Add more transactions' });
  const grade = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Needs work';
  return { score: Math.min(100, score), grade, parts };
}

// ── 8. Learn / blog links (curated, India-first) ──
export const LEARN_LINKS = [
  { title: 'Zerodha Varsity — personal finance', url: 'https://zerodha.com/varsity/', tag: 'Free course', why: 'Best free Indian markets & money basics, beginner to advanced.' },
  { title: 'RBI — financial literacy', url: 'https://www.rbi.org.in/commonman/english/', tag: 'Official', why: 'RBI\'s own guides on banking, UPI safety and fraud prevention.' },
  { title: 'NSE — investor education', url: 'https://www.nseindia.com/learn', tag: 'Official', why: 'Stock-market and mutual-fund fundamentals from the exchange.' },
  { title: 'AMFI — mutual fund basics', url: 'https://www.amfiindia.com/investor-corner', tag: 'Official', why: 'Understand NAV, SIPs, expense ratios before you invest.' },
  { title: 'Freefincal — calculators & analysis', url: 'https://freefincal.com/', tag: 'Blog', why: 'Data-driven Indian retirement and investment planning.' },
  { title: 'Subramoney — simple money wisdom', url: 'https://subramoney.com/', tag: 'Blog', why: 'Short, jargon-free takes on insurance, MFs and goals.' },
  { title: 'RBI Sachet — check frauds', url: 'https://sachet.rbi.org.in/', tag: 'Safety', why: 'Verify entities and report fraud — bookmark this.' },
  { title: 'Income Tax e-filing portal', url: 'https://www.incometax.gov.in/', tag: 'Official', why: 'File returns, check AIS/TIS, compare regimes yourself.' },
];

// ── 9. Emergency fund calculator ──
export function emergencyFundCalc(avgMonthlyExpense, currentLiquid) {
  const monthly = Math.max(0, Number(avgMonthlyExpense) || 0);
  const liquid = Math.max(0, Number(currentLiquid) || 0);
  const target = Math.round(monthly * 6);
  const gap = Math.max(0, target - liquid);
  const monthsCovered = monthly > 0 ? liquid / monthly : 0;
  return { monthly, liquid, target, gap, monthsCovered };
}

export function avgMonthlyBurn(transactions, monthsBack = 3) {
  if (!transactions || transactions.length === 0) return 0;
  try {
    const now = getDateRange('this-month');
    const end = now.end;
    const d = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, 1));
    d.setUTCMonth(d.getUTCMonth() - (monthsBack - 1));
    const start = d.toISOString().slice(0, 10);
    const s = summarizeLedger(transactions, { start, end }, {});
    return s.totalSpending / monthsBack;
  } catch { return 0; }
}

// ── 10. SIP future-value calculator ──
export function sipFutureValue(monthly, annualPct, years) {
  const P = Math.max(0, Number(monthly) || 0);
  const r = (Number(annualPct) || 0) / 12 / 100;
  const n = Math.max(0, Math.round(Number(years) || 0) * 12);
  if (P <= 0 || n <= 0) return { invested: 0, gains: 0, total: 0 };
  const invested = P * n;
  let total;
  if (r <= 0) total = invested;
  else total = P * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
  return { invested: Math.round(invested), total: Math.round(total), gains: Math.round(total - invested) };
}

// ── 11. Income-tax estimator (new regime, FY 2025-26, approximate) ──
const NEW_REGIME_SLABS = [
  [400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15],
  [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30],
];
export function estimateNewRegimeTax(grossAnnual) {
  const gross = Math.max(0, Number(grossAnnual) || 0);
  const taxable = Math.max(0, gross - 75000); // standard deduction
  let tax = 0, prev = 0;
  for (const [cap, rate] of NEW_REGIME_SLABS) {
    if (taxable <= prev) break;
    tax += (Math.min(taxable, cap) - prev) * rate;
    prev = cap;
  }
  // Section 87A rebate: nil tax up to ₹12L taxable (FY25-26 new regime).
  if (taxable <= 1200000) tax = 0;
  const cess = tax * 0.04;
  return { gross: Math.round(gross), taxable: Math.round(taxable), tax: Math.round(tax), cess: Math.round(cess), total: Math.round(tax + cess) };
}

// ── 12. 50/30/20 "spend wisely" check ──
export function fiftyThirtyTwenty(transactions, monthKey) {
  const m = monthTotals(transactions || [], monthKey);
  const income = m.income;
  let needs = 0, wants = 0;
  if (income > 0 && transactions) {
    for (const t of transactions) {
      if (!t.date || !t.date.startsWith(monthKey)) continue;
      if (t.status && t.status !== 'completed') continue;
      if (t.type === 'expense') {
        if (ESSENTIAL_CATEGORIES.has(t.category)) needs += Number(t.amount) || 0;
        else wants += Number(t.amount) || 0;
      } else if (t.type === 'refund') {
        wants -= Math.abs(Number(t.amount) || 0);
      }
    }
  }
  const saved = income - m.expenses;
  const pct = (v) => (income > 0 ? (v / income) * 100 : null);
  return {
    income, needs, wants, saved,
    needsPct: pct(needs), wantsPct: pct(wants), savedPct: income > 0 ? (saved / income) * 100 : null,
    verdicts: {
      needs: income > 0 ? needs / income <= 0.5 : null,
      wants: income > 0 ? wants / income <= 0.3 : null,
      saved: income > 0 ? saved / income >= 0.2 : null,
    }
  };
}

// ── Savings challenges ──
export const CHALLENGES = [
  { title: 'No-spend day', body: 'One day this week: zero discretionary spending. Groceries and bills don\'t count.' },
  { title: 'Round-up week', body: 'After every purchase for 7 days, move the round-up to a savings goal.' },
  { title: 'Subscription pause', body: 'Pause one recurring subscription for 30 days and redirect it to savings.' },
];
