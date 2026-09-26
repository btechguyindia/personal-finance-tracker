// milestones.js — P1 #10 Personal financial milestones. Pure ESM.
import { monthTotals } from './finance.js';
import { todayISO } from './analyticsService.js';

export function essentialMonthly(transactions) {
  const ESS = new Set(['Food', 'Transportation', 'Housing', 'Health', 'Education', 'Financial', 'Family']);
  // avg of last 3 full months' essential spend
  const now = todayISO().slice(0, 7);
  const months = [];
  const [y, m] = now.split('-').map(Number);
  for (let i = 1; i <= 3; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const vals = months.map((mk) => {
    let s = 0;
    for (const t of transactions || []) {
      if (!t.date.startsWith(mk) || (t.status && t.status !== 'completed')) continue;
      if (t.type === 'expense' && ESS.has(t.category)) s += Number(t.amount || 0);
      else if (t.type === 'refund' && ESS.has(t.category)) s -= Number(t.amount || 0);
    }
    return s;
  }).filter((v) => v > 0);
  if (!vals.length) return 30000; // labeled estimate fallback
  return Math.round(vals.reduce((s, x) => s + x, 0) / vals.length);
}

export function milestoneTimeline({ transactions, accounts, goals = [], netWorth = 0 }) {
  const ess = essentialMonthly(transactions);
  const totalSaved = Math.max(0, netWorth);
  const defs = [
    { id: 'm10k', name: 'First ₹10,000 saved', target: 10000 },
    { id: 'm1', name: '1 month of essentials covered', target: ess },
    { id: 'm3', name: '3 months of essentials covered', target: ess * 3 },
    { id: 'm6', name: '6-month emergency cushion', target: ess * 6 },
    { id: 'y1', name: '₹1,00,000 net worth', target: 100000 },
  ];
  const now = todayISO();
  return defs.map((d) => {
    const done = totalSaved >= d.target;
    return { ...d, saved: Math.round(totalSaved), progress: Math.min(100, Math.round((totalSaved / d.target) * 100)), done, completedDate: done ? now : null, note: done ? `Reached ${now} at ₹${Math.round(totalSaved).toLocaleString('en-IN')}` : `₹${Math.max(0, Math.round(d.target - totalSaved)).toLocaleString('en-IN')} to go` };
  });
}
