// cashflow.js — P1 #2 Future cash-flow simulator. Pure ESM.
import { todayISO, addDaysISO, addMonthsISO } from './analyticsService.js';
import { assetCash } from './commandCenter.js';

const HORIZONS = [7, 30, 60, 90, 180];

function expandRecurring(recurring = [], from, to) {
  const events = [];
  for (const r of recurring || []) {
    if (r.status !== 'active') continue;
    let d = r.nextDate || r.startDate;
    if (!d) continue;
    let guard = 0;
    const step = (iso) => {
      if (r.frequency === 'daily') return addDaysISO(iso, 1);
      if (r.frequency === 'weekly') return addDaysISO(iso, 7);
      if (r.frequency === 'quarterly') return addMonthsISO(iso, 3);
      if (r.frequency === 'yearly') return addMonthsISO(iso, 12);
      return addMonthsISO(iso, 1);
    };
    while (d && d <= to && guard++ < 200) {
      if (d >= from) {
        events.push({ date: d, amount: Number(r.amount || 0), type: r.type, name: r.name, kind: 'recurring' });
      }
      d = step(d);
      if (r.endDate && d > r.endDate) break;
    }
  }
  return events;
}

// planned: [{date, amount, type:'expense'|'income', name}]
export function projectCashflow({ transactions, accounts, recurring = [], planned = [], contributions = [], horizonDays = 90, minBalance = 0, now = todayISO() }) {
  const startCash = assetCash(transactions, accounts);
  const end = addDaysISO(now, horizonDays);
  const events = [
    ...expandRecurring(recurring, now, end),
    ...(planned || []).filter((p) => p.date >= now && p.date <= end).map((p) => ({ ...p, kind: 'planned' })),
    ...(contributions || []).filter((p) => p.date >= now && p.date <= end).map((p) => ({ ...p, kind: 'goal', type: 'expense' })),
    // scheduled ledger items
    ...(transactions || []).filter((t) => t.status === 'scheduled' && t.date >= now && t.date <= end && (t.type === 'income' || t.type === 'expense'))
      .map((t) => ({ date: t.date, amount: Number(t.amount || 0), type: t.type, name: t.merchant || t.category, kind: 'scheduled' })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));

  let bal = startCash;
  const byDay = new Map();
  const breaches = [];
  for (const e of events) {
    const delta = e.type === 'income' ? e.amount : -e.amount;
    bal += delta;
    byDay.set(e.date, (byDay.get(e.date) || 0) + delta);
    if (bal < minBalance && (breaches.length === 0 || breaches[breaches.length - 1].date !== e.date)) {
      breaches.push({ date: e.date, balance: Math.round(bal * 100) / 100, event: e.name });
    }
  }
  // Build horizon snapshots
  const snapshots = HORIZONS.filter((h) => h <= horizonDays || horizonDays > 180).map((h) => {
    const cutoff = addDaysISO(now, h);
    let b = startCash;
    for (const e of events) {
      if (e.date > cutoff) break;
      b += e.type === 'income' ? e.amount : -e.amount;
    }
    return { horizon: h, date: cutoff, balance: Math.round(b * 100) / 100, belowMin: b < minBalance };
  });
  return { now, startCash, endBalance: Math.round(bal * 100) / 100, events, snapshots, breaches, minBalance };
}

// Alternative scenarios: delay a planned purchase by N days or cut daily spend by X.
export function scenarioCompare(baseArgs, scenarios) {
  return scenarios.map((s) => {
    let planned = baseArgs.planned || [];
    if (s.delayPurchaseName && s.delayDays) {
      planned = planned.map((p) => (p.name === s.delayPurchaseName ? { ...p, date: addDaysISO(p.date, s.delayDays) } : p));
    }
    let recurring = baseArgs.recurring || [];
    let events = planned;
    if (s.dailyCut) {
      // model daily cut as extra daily income over horizon
      const extra = [];
      for (let i = 0; i < (baseArgs.horizonDays || 90); i++) {
        extra.push({ date: addDaysISO(baseArgs.now || todayISO(), i), amount: s.dailyCut, type: 'income', name: 'spending cut', kind: 'scenario' });
      }
      events = [...planned, ...extra];
    }
    return { name: s.name, result: projectCashflow({ ...baseArgs, planned: events, recurring }) };
  });
}
