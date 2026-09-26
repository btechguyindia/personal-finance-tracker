// Analytics reconciliation tests (§11). Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  expenseByCategory, paymentMethodBreakdown, dailySeries, monthlySeries,
  summarizeLedger, subcategoryBreakdown, categoryDetail, pctChange,
  validateReconciliation, ledgerTotals, filterLedger, getDateRange
} from '../src/services/analyticsService.js';

const FX = [
  { id: 'T1', date: '2026-09-02', type: 'expense', amount: 1000, category: 'Food', subcategory: 'Groceries', paymentMethod: 'UPI', account: 'HDFC Savings', merchant: 'BigBasket', status: 'completed' },
  { id: 'T2', date: '2026-09-05', type: 'expense', amount: 500, category: 'Food', subcategory: 'Restaurants', paymentMethod: 'Cash', account: 'HDFC Savings', merchant: 'Cafe', status: 'completed' },
  { id: 'T3', date: '2026-09-10', type: 'expense', amount: 2000, category: 'Housing', subcategory: 'Rent', paymentMethod: 'Bank transfer', account: 'HDFC Savings', merchant: 'Landlord', status: 'completed' },
  { id: 'T4', date: '2026-09-12', type: 'income', amount: 50000, category: 'Salary', paymentMethod: 'Bank transfer', account: 'SBI Salary', merchant: 'Employer', status: 'completed' },
  // Internal transfer — must be excluded.
  { id: 'T5', date: '2026-09-15', type: 'transfer', amount: 10000, category: 'Transfer', paymentMethod: 'Bank transfer', account: 'SBI Salary', accountFrom: 'SBI Salary', accountTo: 'HDFC Savings', merchant: 'Self', status: 'completed' },
  // Refund of T2's dinner.
  { id: 'T6', date: '2026-09-16', type: 'refund', amount: 500, category: 'Food', subcategory: 'Restaurants', paymentMethod: 'Cash', account: 'HDFC Savings', merchant: 'Cafe', status: 'completed' },
  // Credit-card repayment — must not double-count.
  { id: 'T7', date: '2026-09-18', type: 'transfer', amount: 8000, category: 'Card payment', paymentMethod: 'Bank transfer', account: 'HDFC Savings', merchant: 'ICICI Credit Card', status: 'completed', isCreditCardRepayment: true },
  // Pending — excluded by default.
  { id: 'T8', date: '2026-09-20', type: 'expense', amount: 9999, category: 'Shopping', paymentMethod: 'Credit card', account: 'ICICI Credit Card', merchant: 'Amazon', status: 'pending' }
];

const RANGE = { start: '2026-09-01', end: '2026-09-30' };

describe('analytics reconciliation (§11)', () => {
  it('1. pie category totals equal the included expense total', () => {
    const { rows, total } = expenseByCategory(FX, RANGE);
    assert.equal(rows.reduce((s, r) => s + r.amount, 0), total);
    // 1000 + (500 − 500 refund) + 2000 = 3000
    assert.equal(total, 3000);
  });

  it('2. category percentages add to 100% (rounding)', () => {
    const { rows } = expenseByCategory(FX, RANGE);
    const sum = rows.reduce((s, r) => s + r.share, 0);
    assert.ok(Math.abs(sum - 100) < 0.6, `shares sum to ${sum}`);
  });

  it('3. monthly chart values equal ledger aggregates', () => {
    const ledger = ledgerTotals(FX, RANGE, {});
    const m = monthlySeries(FX, { start: '2026-09-01', end: '2026-09-30' }, {});
    const sept = m.find((r) => r.date === '2026-09');
    assert.equal(sept.expense, ledger.expense);
    assert.equal(sept.income, ledger.income);
  });

  it('4. income/expense series use consistent date boundaries', () => {
    const daily = dailySeries(FX, RANGE, {});
    assert.equal(daily.length, 30);
    assert.equal(daily[0].date, '2026-09-01');
    assert.equal(daily[29].date, '2026-09-30');
    // Out-of-range txn must not leak in.
    const withExtra = [...FX, { id: 'TX', date: '2026-10-01', type: 'expense', amount: 777, category: 'Food', status: 'completed' }];
    const d2 = dailySeries(withExtra, RANGE, {});
    assert.equal(d2.reduce((s, d) => s + d.expense, 0), daily.reduce((s, d) => s + d.expense, 0));
  });

  it('5. internal transfers are excluded', () => {
    const s = summarizeLedger(FX, RANGE, {});
    assert.equal(s.totalSpending, 3000);
    assert.equal(s.totalIncome, 50000);
  });

  it('6. refunds reduce the appropriate spending totals', () => {
    const noRefund = FX.filter((t) => t.id !== 'T6');
    const withRefund = summarizeLedger(FX, RANGE, {}).totalSpending;
    const withoutRefund = summarizeLedger(noRefund, RANGE, {}).totalSpending;
    assert.equal(withoutRefund - withRefund, 500);
    const food = expenseByCategory(FX, RANGE).rows.find((r) => r.category === 'Food');
    assert.equal(food.amount, 1000); // 1000 + 500 − 500
  });

  it('7. credit-card repayments do not create duplicate expenses', () => {
    const noRepay = FX.filter((t) => t.id !== 'T7');
    assert.equal(summarizeLedger(FX, RANGE, {}).totalSpending, summarizeLedger(noRepay, RANGE, {}).totalSpending);
  });

  it('8. changing the date range updates every chart consistently', () => {
    for (const r of [{ start: '2026-09-01', end: '2026-09-10' }, { start: '2026-09-11', end: '2026-09-30' }, RANGE]) {
      const v = validateReconciliation(FX, r, {});
      assert.ok(v.ok, `range ${r.start}→${r.end}: ${v.errors.join('; ')}`);
    }
  });

  it('9. drilldown transactions match the selected chart segment', () => {
    const cat = expenseByCategory(FX, RANGE);
    const food = cat.rows.find((r) => r.category === 'Food');
    const sub = subcategoryBreakdown(FX, RANGE, 'Food', {});
    assert.equal(sub.total, food.amount);
    const det = categoryDetail(FX, RANGE, 'Food', {});
    const txSum = det.transactions
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + Math.abs(t.amount), 0)
      - det.transactions.filter((t) => t.type === 'refund').reduce((s, t) => s + Math.abs(t.amount), 0);
    assert.equal(txSum, food.amount);
  });

  it('10. empty periods and zero denominators handled correctly', () => {
    const empty = { start: '2025-01-01', end: '2025-01-31' };
    const s = summarizeLedger(FX, empty, {});
    assert.equal(s.totalSpending, 0);
    assert.equal(s.spendingPctChange, null);
    assert.equal(pctChange(500, 0), null); // never divide by zero
    const v = validateReconciliation(FX, empty, {});
    assert.ok(v.ok);
  });

  it('pending/scheduled excluded by default, visible on request', () => {
    const def = summarizeLedger(FX, RANGE, {});
    const incl = summarizeLedger(FX, RANGE, { includePending: true });
    assert.equal(incl.totalSpending - def.totalSpending, 9999);
  });

  it('date presets resolve to sane ranges incl. financial year', () => {
    const fy = getDateRange('financial-year', { now: '2026-09-26' });
    assert.equal(fy.start, '2026-04-01');
    const fy2 = getDateRange('financial-year', { now: '2026-02-10' });
    assert.equal(fy2.start, '2025-04-01');
  });
});
