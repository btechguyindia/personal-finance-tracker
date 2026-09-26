// commandCenter.js — P1 #1 Financial Command Center. Pure ESM, paise-safe.
import { todayISO, addDaysISO } from './analyticsService.js';
import { toPaise, monthTotals, computeBalances } from './finance.js';

export function assetCash(transactions, accounts) {
  const withBal = computeBalances(accounts || [], transactions || []);
  return withBal.filter((a) => a.type !== 'credit_card')
    .reduce((s, a) => s + Number(a.balance || 0), 0);
}

export function billsDue(transactions, recurring = [], now = todayISO(), horizonDays = 30) {
  const end = addDaysISO(now, horizonDays);
  const out = [];
  for (const r of recurring || []) {
    if (r.status !== 'active') continue;
    const d = r.nextDate || r.startDate;
    if (d && d >= now && d <= end) {
      out.push({ kind: 'recurring', name: r.name, date: d, amount: Number(r.amount || 0), frequency: r.frequency });
    }
  }
  // Large scheduled (status=scheduled) ledger items also count as upcoming
  for (const t of transactions || []) {
    if (t.status === 'scheduled' && t.date >= now && t.date <= end && t.type === 'expense') {
      out.push({ kind: 'scheduled', name: t.merchant || t.category, date: t.date, amount: Number(t.amount || 0) });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Safe-to-spend = cash - bills(→payday or 30d) - goal reserve - min buffer. Never negative-claimed.
export function safeToSpend({ transactions, accounts, recurring = [], goals = [], minBuffer = 0, horizonDays = 30, now = todayISO() }) {
  const cash = assetCash(transactions, accounts);
  const bills = billsDue(transactions, recurring, now, horizonDays);
  const billsTotal = bills.reduce((s, b) => s + b.amount, 0);
  const goalReserve = (goals || []).filter((g) => g.status !== 'completed')
    .reduce((s, g) => {
      const target = Number(g.target || 0);
      const total = Number(g.total ?? g.current ?? 0);
      const perMonth = Number(g.requiredPerMonth || 0);
      // reserve one month's required contribution if behind
      return s + (total < target ? Math.min(perMonth || 0, Math.max(0, target - total)) : 0);
    }, 0);
  const safe = cash - billsTotal - goalReserve - Number(minBuffer || 0);
  return { cash, billsTotal, bills, goalReserve, safe: Math.max(0, Math.round(safe * 100) / 100), shortfall: safe < 0 ? Math.round(-safe * 100) / 100 : 0 };
}

export function cashRunwayDays({ transactions, now = todayISO(), lookbackDays = 60 }) {
  const start = addDaysISO(now, -(lookbackDays - 1));
  let expP = 0;
  for (const t of transactions || []) {
    if (t.status && t.status !== 'completed') continue;
    if (t.date < start || t.date > now) continue;
    if (t.type === 'expense') expP += toPaise(t.amount);
    else if (t.type === 'refund') expP -= toPaise(t.amount);
  }
  const daily = expP / 100 / lookbackDays;
  return { avgDailyBurn: Math.round(daily * 100) / 100, lookbackDays };
}

export function runwayWithCash(cash, avgDailyBurn) {
  if (!avgDailyBurn || avgDailyBurn <= 0) return { days: null, label: 'n/a — no recent burn' };
  return { days: Math.floor(cash / avgDailyBurn), label: `${Math.floor(cash / avgDailyBurn)} days` };
}

export function overspendAlerts(transactions, budgets, monthKey) {
  const m = monthTotals(transactions, monthKey);
  const byCat = {};
  for (const t of transactions || []) {
    if (t.status && t.status !== 'completed') continue;
    if (!monthKey || !t.date.startsWith(monthKey)) continue;
    if (t.type === 'expense') byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount || 0);
    else if (t.type === 'refund') byCat[t.category] = (byCat[t.category] || 0) - Number(t.amount || 0);
  }
  const alerts = [];
  for (const [cat, limit] of Object.entries(budgets || {})) {
    const spent = byCat[cat] || 0;
    if (limit > 0 && spent > limit) alerts.push({ category: cat, spent, limit, overBy: spent - limit, pct: (spent / limit) * 100 });
    else if (limit > 0 && spent / limit >= 0.85) alerts.push({ category: cat, spent, limit, overBy: 0, pct: (spent / limit) * 100, warning: true });
  }
  return { month: m, alerts: alerts.sort((a, b) => b.pct - a.pct) };
}

export function upcomingLarge(transactions, recurring = [], now = todayISO(), threshold = 10000, horizonDays = 60) {
  return billsDue(transactions, recurring, now, horizonDays).filter((b) => b.amount >= threshold);
}

export function dailyChecklist({ transactions, recurring, budgets, goals, monthKey, now = todayISO() }) {
  const items = [];
  const { alerts } = overspendAlerts(transactions, budgets, monthKey);
  const due7 = billsDue(transactions, recurring, now, 7);
  const pending = (transactions || []).filter((t) => t.status === 'pending').length;
  const uncat = (transactions || []).filter((t) => !t.category || t.category === 'Uncategorized').length;
  items.push({ id: 'bills7', label: `Review ${due7.length} bill(s) due in 7 days`, done: due7.length === 0, count: due7.length });
  items.push({ id: 'overspend', label: alerts.filter((a) => !a.warning).length ? `${alerts.filter((a) => !a.warning).length} budget(s) overspent — rebalance` : 'Budgets within limits', done: alerts.filter((a) => !a.warning).length === 0, count: alerts.length });
  items.push({ id: 'pending', label: pending ? `Resolve ${pending} pending transaction(s)` : 'No pending transactions', done: pending === 0, count: pending });
  items.push({ id: 'uncat', label: uncat ? `Categorize ${uncat} uncategorized transaction(s)` : 'All transactions categorized', done: uncat === 0, count: uncat });
  const activeGoals = (goals || []).filter((g) => g.status === 'active').length;
  items.push({ id: 'goals', label: activeGoals ? `${activeGoals} active goal(s) — confirm monthly contribution` : 'No active goals', done: activeGoals === 0, count: activeGoals });
  return items;
}

// Crazy feature: single "Can I afford this?" box.
export function canAfford({ price, transactions, accounts, recurring = [], budgets = {}, goals = [], monthKey, minBuffer = 0, now = todayISO() }) {
  const p = Number(price || 0);
  if (!(p > 0)) return { ok: false, reason: 'Enter a price > 0.' };
  const { cash, billsTotal, goalReserve, safe } = safeToSpend({ transactions, accounts, recurring, goals, minBuffer, horizonDays: 30, now });
  const { alerts } = overspendAlerts(transactions, budgets, monthKey);
  const reasons = [];
  reasons.push(`Cash across asset accounts: ₹${cash.toLocaleString('en-IN')}.`);
  reasons.push(`Bills due next 30d: ₹${billsTotal.toLocaleString('en-IN')}${goalReserve ? ` + goal reserve ₹${goalReserve.toLocaleString('en-IN')}` : ''}${minBuffer ? ` + buffer ₹${Number(minBuffer).toLocaleString('en-IN')}` : ''}.`);
  reasons.push(`Safe-to-spend: ₹${safe.toLocaleString('en-IN')}.`);
  if (alerts.filter((a) => !a.warning).length) reasons.push(`${alerts.filter((a) => !a.warning).length} budget(s) already overspent.`);
  const ok = p <= safe;
  reasons.push(ok ? `✅ Yes — ₹${p.toLocaleString('en-IN')} fits inside safe-to-spend with bills covered.` : `❌ No — short by ₹${(p - safe).toLocaleString('en-IN')}. Delay, split, or reduce bills/buffer first.`);
  return { ok, price: p, cash, billsTotal, goalReserve, safe, reasons };
}
