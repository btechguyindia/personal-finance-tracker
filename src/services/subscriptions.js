// subscriptions.js — P1 #8 Subscription radar. Pure ESM.
import { addMonthsISO } from './analyticsService.js';

// Detect likely subscriptions: same merchant, ≥3 occurrences, regular interval (±5d), similar amount (±10%).
export function detectSubscriptions(transactions) {
  const byM = new Map();
  for (const t of transactions || []) {
    if (t.type !== 'expense' || (t.status && t.status !== 'completed')) continue;
    if (!t.merchant) continue;
    if (!byM.has(t.merchant)) byM.set(t.merchant, []);
    byM.get(t.merchant).push(t);
  }
  const out = [];
  for (const [merchant, rows] of byM) {
    if (rows.length < 3) continue;
    const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) gaps.push((Date.parse(sorted[i].date) - Date.parse(sorted[i - 1].date)) / 86400000);
    const avgGap = gaps.reduce((s, x) => s + x, 0) / gaps.length;
    const gapOk = gaps.every((g) => Math.abs(g - avgGap) <= 5);
    const amts = sorted.map((r) => Number(r.amount || 0));
    const avgAmt = amts.reduce((s, x) => s + x, 0) / amts.length;
    const amtOk = amts.every((a) => Math.abs(a - avgAmt) / (avgAmt || 1) <= 0.1);
    if (!gapOk || !amtOk) continue;
    const freq = avgGap <= 8 ? 'weekly' : avgGap <= 45 ? 'monthly' : avgGap <= 100 ? 'quarterly' : avgGap <= 400 ? 'yearly' : 'irregular';
    const confidence = rows.length >= 6 ? 'high' : rows.length >= 4 ? 'medium' : 'low';
    const monthly = freq === 'monthly' ? avgAmt : freq === 'yearly' ? avgAmt / 12 : freq === 'weekly' ? avgAmt * 4.33 : avgAmt;
    out.push({ merchant, count: rows.length, avgAmount: Math.round(avgAmt * 100) / 100, frequency: freq, confidence, monthlyCost: Math.round(monthly * 100) / 100, annualCost: Math.round(monthly * 12 * 100) / 100, lastDate: sorted[sorted.length - 1].date, nextRenewal: freq === 'monthly' ? addMonthsISO(sorted[sorted.length - 1].date, 1) : freq === 'yearly' ? addMonthsISO(sorted[sorted.length - 1].date, 12) : null, txnIds: sorted.map((r) => r.id) });
  }
  return out.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

export function subscriptionTotals(detected) {
  const monthly = (detected || []).reduce((s, d) => s + d.monthlyCost, 0);
  return { monthly: Math.round(monthly * 100) / 100, annual: Math.round(monthly * 12 * 100) / 100, count: (detected || []).length };
}

// Confirmation store (user-confirmed / dismissed) in localStorage.
const LS = 'fintrack_subs_v1';
export function loadSubState() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } }
export function saveSubState(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* ignore */ } }
