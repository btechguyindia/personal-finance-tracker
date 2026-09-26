// advancedAnalytics.js — 5 advanced analytics (A–E). Pure ESM.
import { monthlySeries, expenseByCategory, getDateRange } from './analyticsService.js';
import { toPaise } from './finance.js';

// A. Sankey data: income→accounts→categories→merchants (clickable nodes carry txnIds).
export function sankeyData(transactions, range, filters = {}) {
  const inR = (transactions || []).filter((t) => t.date >= range.start && t.date <= range.end && (!t.status || t.status === 'completed'));
  const links = [];
  const txnIndex = new Map();
  const push = (from, to, amount, id) => {
    const k = from + '→' + to;
    if (!txnIndex.has(k)) { txnIndex.set(k, { from, to, amount: 0, txnIds: [] }); links.push(txnIndex.get(k)); }
    const l = txnIndex.get(k);
    l.amount += amount; l.txnIds.push(id);
  };
  for (const t of inR) {
    const amt = Number(t.amount || 0);
    if (t.type === 'income') push('Income', t.account || 'Account', amt, t.id);
    else if (t.type === 'expense') { push(t.account || 'Account', t.category || 'Uncategorized', amt, t.id); if (t.merchant) push(t.category || 'Uncategorized', t.merchant, amt, t.id); }
    else if (t.type === 'refund') push(t.category || 'Uncategorized', t.account || 'Account', amt, t.id);
  }
  for (const l of links) l.amount = Math.round(l.amount * 100) / 100;
  const nodes = [...new Set(links.flatMap((l) => [l.from, l.to]))];
  return { nodes, links: links.sort((a, b) => b.amount - a.amount) };
}

// B. Spending velocity: cumulative spend vs daily pace.
export function spendingVelocity(transactions, monthISO, monthlyBudget) {
  const [y, m] = monthISO.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pace = Number(monthlyBudget || 0) / daysInMonth;
  const perDay = new Map();
  for (const t of transactions || []) {
    if (!t.date.startsWith(monthISO) || (t.status && t.status !== 'completed')) continue;
    const d = Number(t.date.slice(8, 10));
    if (t.type === 'expense') perDay.set(d, (perDay.get(d) || 0) + Number(t.amount || 0));
    else if (t.type === 'refund') perDay.set(d, (perDay.get(d) || 0) - Number(t.amount || 0));
  }
  const today = Math.min(new Date().getUTCDate(), daysInMonth);
  const rows = [];
  let cum = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    cum += perDay.get(d) || 0;
    rows.push({ day: d, spent: Math.round((perDay.get(d) || 0) * 100) / 100, cumulative: Math.round(cum * 100) / 100, planned: Math.round(pace * d * 100) / 100, ahead: cum - pace * d });
  }
  const cur = rows[today - 1] || rows[rows.length - 1];
  return { rows, daysInMonth, dailyPace: Math.round(pace * 100) / 100, status: cur.ahead > 0 ? `ahead of pace by ₹${Math.round(cur.ahead).toLocaleString('en-IN')}` : `behind pace (₹${Math.round(-cur.ahead).toLocaleString('en-IN')} under)`, today };
}

// C. Lifestyle inflation: essential vs discretionary share across months + income.
export function lifestyleInflation(transactions, months = 6) {
  const ESS = new Set(['Food', 'Transportation', 'Housing', 'Health', 'Education', 'Financial', 'Family']);
  const now = new Date();
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    let ess = 0, disc = 0, inc = 0;
    for (const t of transactions || []) {
      if (!t.date.startsWith(mk) || (t.status && t.status !== 'completed')) continue;
      if (t.type === 'income') inc += Number(t.amount || 0);
      else if (t.type === 'expense') { if (ESS.has(t.category)) ess += Number(t.amount || 0); else disc += Number(t.amount || 0); }
      else if (t.type === 'refund') { if (ESS.has(t.category)) ess -= Number(t.amount || 0); else disc -= Number(t.amount || 0); }
    }
    out.push({ month: mk, essential: Math.round(ess), discretionary: Math.round(disc), income: Math.round(inc), discShare: ess + disc > 0 ? Math.round((disc / (ess + disc)) * 100) : null });
  }
  const first = out[0], last = out[out.length - 1];
  const note = first && last && first.income > 0 && last.income > 0
    ? `Income ${(((last.income - first.income) / first.income) * 100).toFixed(0)}%, discretionary ${first.discretionary ? (((last.discretionary - first.discretionary) / first.discretionary) * 100).toFixed(0) : 'n/a'}% over ${months}mo.`
    : 'Not enough income history to judge lifestyle inflation.';
  return { rows: out, note };
}

// D. Stress-test simulator (labeled scenarios, not predictions).
export function stressTest({ cash, avgDailyBurn, upcomingBills, scenarios }) {
  return (scenarios || [
    { name: 'Salary delayed 15d', extraBurnDays: 15, shock: 0 },
    { name: 'Salary delayed 30d', extraBurnDays: 30, shock: 0 },
    { name: 'Unexpected ₹10,000 expense', extraBurnDays: 0, shock: 10000 },
    { name: 'Two large bills same week', extraBurnDays: 0, shock: 0, doubleBills: true },
  ]).map((s) => {
    const burn = (avgDailyBurn || 0) * (s.extraBurnDays || 0);
    const bills = upcomingBills || 0;
    const shock = s.shock || 0;
    const double = s.doubleBills ? bills : 0;
    const remaining = cash - burn - bills - shock - double;
    return { name: s.name, remaining: Math.round(remaining * 100) / 100, survives: remaining >= 0, detail: `Scenario: cash ₹${cash} − burn ₹${Math.round(burn)} − bills ₹${Math.round(bills)}${shock ? ` − shock ₹${shock}` : ''}${double ? ' − bills again (same-week clash)' : ''} = ₹${Math.round(remaining)}.` };
  });
}

// E. Category anomaly map: category × month grid with z-score vs prior mean.
export function anomalyMap(transactions, months = 6, threshold = 2) {
  const now = new Date();
  const mks = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    mks.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const cats = [...new Set((transactions || []).map((t) => t.category || 'Uncategorized'))];
  const grid = cats.map((cat) => {
    const vals = mks.map((mk) => {
      let s = 0;
      for (const t of transactions || []) {
        if (!t.date.startsWith(mk) || (t.status && t.status !== 'completed')) continue;
        if ((t.category || 'Uncategorized') !== cat) continue;
        if (t.type === 'expense') s += Number(t.amount || 0);
        else if (t.type === 'refund') s -= Number(t.amount || 0);
      }
      return Math.round(s);
    });
    const mean = vals.reduce((s, x) => s + x, 0) / (vals.length || 1);
    const sd = Math.sqrt(vals.reduce((s, x) => s + (x - mean) ** 2, 0) / (vals.length || 1)) || 1;
    const cells = vals.map((v, i) => ({ month: mks[i], amount: v, z: (v - mean) / sd, hot: (v - mean) / sd >= threshold }));
    return { category: cat, cells, mean: Math.round(mean) };
  });
  return { months: mks, grid, threshold };
}
