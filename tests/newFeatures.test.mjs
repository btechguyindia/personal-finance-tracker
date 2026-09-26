import test from 'node:test';
import assert from 'node:assert/strict';
import { safeToSpend, canAfford, billsDue, dailyChecklist } from '../src/services/commandCenter.js';
import { projectCashflow } from '../src/services/cashflow.js';
import { simulateAllocation, applyAllocation } from '../src/services/buckets.js';
import { detectiveInbox } from '../src/services/detective.js';
import { askAnalyst } from '../src/services/analyst.js';
import { detectSubscriptions } from '../src/services/subscriptions.js';
import { reconcile } from '../src/services/accuracy.js';
import { sankeyData, spendingVelocity, stressTest, anomalyMap } from '../src/services/advancedAnalytics.js';
import { analyzePurchase } from '../src/services/purchaseLab.js';

const txns = [
  { id: 'T1', date: '2026-09-01', type: 'income', amount: 80000, category: 'Salary', account: 'HDFC Savings', status: 'completed' },
  { id: 'T2', date: '2026-09-02', type: 'expense', amount: 20000, category: 'Housing', account: 'HDFC Savings', merchant: 'Rent', status: 'completed' },
  { id: 'T3', date: '2026-09-05', type: 'expense', amount: 500, category: 'Food', account: 'HDFC Savings', merchant: 'Swiggy', paymentMethod: 'UPI', status: 'completed' },
];
const accounts = [{ name: 'HDFC Savings', type: 'savings', openingBalance: 50000, balance: 50000 }];
const recurring = [{ name: 'Rent', amount: 20000, type: 'expense', frequency: 'monthly', status: 'active', nextDate: '2026-10-01', startDate: '2026-09-01' }];

test('safe-to-spend subtracts bills and buffer', () => {
  const s = safeToSpend({ transactions: txns, accounts, recurring, goals: [], minBuffer: 5000, horizonDays: 30, now: '2026-09-26' });
  assert.ok(s.cash > 0 && s.billsTotal >= 20000 && s.safe <= s.cash);
});
test('canAfford yes/no with reasons', () => {
  const y = canAfford({ price: 100, transactions: txns, accounts, recurring, budgets: {}, goals: [], monthKey: '2026-09', now: '2026-09-26' });
  assert.ok(y.reasons.length >= 3);
  const n = canAfford({ price: 99999999, transactions: txns, accounts, recurring, budgets: {}, goals: [], monthKey: '2026-09', now: '2026-09-26' });
  assert.equal(n.ok, false);
});
test('cashflow projection + breaches', () => {
  const p = projectCashflow({ transactions: txns, accounts, recurring, planned: [{ date: '2026-10-05', amount: 60000, type: 'expense', name: 'laptop' }], horizonDays: 60, minBalance: 10000, now: '2026-09-26' });
  assert.ok(p.snapshots.length >= 2 && p.events.length >= 1);
});
test('buckets simulate never exceeds total, apply needs confirm by caller', () => {
  const b = [{ id: 'a', name: 'A', balance: 0 }, { id: 'b', name: 'B', balance: 0 }];
  const s = simulateAllocation(10000, [{ bucketId: 'a', pct: 50 }, { bucketId: 'b', pct: 30 }], b);
  assert.ok(s.assigned <= 10000);
  const { buckets: n } = applyAllocation(b, s.plan, 'test');
  assert.equal(n[0].balance, s.plan[0].amount);
});
test('detective flags duplicates, never deletes', () => {
  const dup = [...txns, { ...txns[2], id: 'T4' }];
  const inbox = detectiveInbox(dup, recurring);
  assert.ok(inbox.some((f) => f.kind.includes('duplicate')));
  assert.ok(inbox.every((f) => f.ids && f.reason));
});
test('analyst cites and admits gaps', () => {
  const r = askAnalyst('Where did my money go this month?', { transactions: txns, recurring, monthKey: '2026-09' });
  assert.ok(r.answer.length > 10 && Array.isArray(r.txnIds));
  const empty = askAnalyst('hello?', { transactions: [], recurring: [], monthKey: '2026-09' });
  assert.match(empty.answer, /No transactions|incomplete/i);
});
test('subscriptions detect regular merchant', () => {
  const rows = [0, 1, 2, 3].map((i) => ({ id: 'S' + i, date: `2026-0${6 + i}-05`, type: 'expense', amount: 499, category: 'Entertainment', account: 'HDFC Savings', merchant: 'Netflix', status: 'completed' }));
  const d = detectSubscriptions(rows);
  assert.ok(d.some((x) => x.merchant === 'Netflix'));
});
test('accuracy reconcile diff', () => {
  const r = reconcile({ transactions: txns, accounts, closingBalances: { 'HDFC Savings': 999999 } });
  assert.equal(r.rows[0].matched, false);
});
test('advanced analytics pure functions', () => {
  const s = sankeyData(txns, { start: '2026-09-01', end: '2026-09-30' });
  assert.ok(s.links.length > 0);
  const v = spendingVelocity(txns, '2026-09', 50000);
  assert.ok(v.rows.length >= 28);
  const st = stressTest({ cash: 50000, avgDailyBurn: 1000, upcomingBills: 20000 });
  assert.ok(st.length >= 3 && st.every((x) => x.detail.includes('Scenario')));
  const a = anomalyMap(txns, 3, 2);
  assert.ok(a.grid.length > 0);
  const p = analyzePurchase({ item: 'phone', price: 20000, date: '2026-09-26', method: 'UPI', transactions: txns, accounts, recurring, budgets: {}, goals: [], monthKey: '2026-09', avgMonthlyIncome: 80000 });
  assert.ok(['comfortable', 'tight-but-covered', 'risky'].includes(p.verdict));
});
test('checklist has 5 items', () => {
  const c = dailyChecklist({ transactions: txns, recurring, budgets: {}, goals: [], monthKey: '2026-09', now: '2026-09-26' });
  assert.equal(c.length, 5);
});
