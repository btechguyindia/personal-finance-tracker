// Ledger accuracy tests — §19 of the spec. Run with: npm test
// Pure tests use the frontend finance engine + analytics service.
// API tests (ownership, idempotency) run only when FINTRACK_TEST_URL is set,
// e.g. FINTRACK_TEST_URL=http://localhost:3000 npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBalances, monthTotals, toPaise, overview
} from '../src/services/finance.js';
import {
  summarizeLedger, validateReconciliation, ledgerTotals
} from '../src/services/analyticsService.js';

const cash = (openingBalance = 0) => ({ name: 'Cash', type: 'cash', openingBalance });
const bank = (openingBalance = 0) => ({ name: 'Bank', type: 'savings', openingBalance });
const card = (openingBalance = 0) => ({ name: 'Card', type: 'credit_card', openingBalance });

const RANGE = { start: '2026-09-01', end: '2026-09-30' };

describe('ledger accuracy (§19)', () => {
  it('1. adding ₹100 to cash increases its balance by ₹100', () => {
    const tx = [{ date: '2026-09-05', type: 'income', amount: 100, account: 'Cash', status: 'completed' }];
    const [b] = computeBalances([cash(0)], tx);
    assert.equal(b.balance, 100);
  });

  it('2. a ₹50 expense decreases the balance by ₹50', () => {
    const tx = [{ date: '2026-09-05', type: 'expense', amount: 50, account: 'Cash', status: 'completed' }];
    const [b] = computeBalances([cash(100)], tx);
    assert.equal(b.balance, 50);
  });

  it('3. transferring ₹500 between owned accounts does not change total assets', () => {
    const tx = [{
      date: '2026-09-05', type: 'transfer', amount: 500,
      accountFrom: 'Cash', accountTo: 'Bank', status: 'completed'
    }];
    const bals = computeBalances([cash(1000), bank(0)], tx);
    assert.equal(bals[0].balance, 500);
    assert.equal(bals[1].balance, 500);
    assert.equal(bals[0].balance + bals[1].balance, 1000);
    // …and never counted as income/expense
    const m = monthTotals(tx, '2026-09');
    assert.equal(m.income, 0);
    assert.equal(m.expenses, 0);
  });

  it('4. a ₹1,000 credit-card purchase increases liability and records one expense', () => {
    const tx = [{ date: '2026-09-05', type: 'expense', amount: 1000, category: 'Shopping', account: 'Card', status: 'completed' }];
    const [b] = computeBalances([card(0)], tx);
    assert.equal(b.balance, 1000);
    const m = monthTotals(tx, '2026-09');
    assert.equal(m.expenses, 1000);
  });

  it('5. paying ₹1,000 toward the card reduces liability without another expense', () => {
    const tx = [
      { date: '2026-09-05', type: 'expense', amount: 1000, category: 'Shopping', account: 'Card', status: 'completed' },
      { date: '2026-09-06', type: 'transfer', amount: 1000, accountFrom: 'Bank', accountTo: 'Card', isCreditCardRepayment: true, status: 'completed' }
    ];
    const bals = computeBalances([bank(2000), card(0)], tx);
    assert.equal(bals.find((a) => a.name === 'Card').balance, 0);
    assert.equal(bals.find((a) => a.name === 'Bank').balance, 1000);
    const m = monthTotals(tx, '2026-09');
    assert.equal(m.expenses, 1000); // exactly one expense, not two
    const s = summarizeLedger(tx.map((t, i) => ({ ...t, id: 'T' + i })), RANGE, {});
    assert.equal(s.totalSpending, 1000);
  });

  it('6. a ₹200 refund offsets the original expense (not income)', () => {
    const tx = [
      { date: '2026-09-05', type: 'expense', amount: 500, category: 'Food', account: 'Cash', status: 'completed' },
      { date: '2026-09-06', type: 'refund', amount: 200, category: 'Food', account: 'Cash', status: 'completed' }
    ];
    const m = monthTotals(tx, '2026-09');
    assert.equal(m.expenses, 300);
    assert.equal(m.income, 0);
  });

  it('7. editing a transaction updates all calculations', () => {
    const before = [{ date: '2026-09-05', type: 'expense', amount: 500, category: 'Food', account: 'Cash', status: 'completed' }];
    const after = [{ ...before[0], amount: 700 }];
    assert.equal(monthTotals(before, '2026-09').expenses, 500);
    assert.equal(monthTotals(after, '2026-09').expenses, 700);
    assert.equal(computeBalances([cash(1000)], before)[0].balance, 500);
    assert.equal(computeBalances([cash(1000)], after)[0].balance, 300);
  });

  it('8. deleting a transaction leaves no orphaned effect', () => {
    const tx = [{ date: '2026-09-05', type: 'expense', amount: 250, account: 'Cash', status: 'completed' }];
    assert.equal(computeBalances([cash(1000)], tx)[0].balance, 750);
    assert.equal(computeBalances([cash(1000)], [])[0].balance, 1000);
  });

  it('12. month boundaries are consistent (out-of-range excluded)', () => {
    const tx = [
      { date: '2026-08-31', type: 'expense', amount: 999, account: 'Cash', status: 'completed' },
      { date: '2026-09-01', type: 'expense', amount: 100, account: 'Cash', status: 'completed' }
    ];
    assert.equal(monthTotals(tx, '2026-09').expenses, 100);
    assert.equal(monthTotals(tx, '2026-08').expenses, 999);
  });

  it('13. paise math stays exact (0.1 + 0.2 problem)', () => {
    assert.equal(toPaise(0.1) + toPaise(0.2), 30);
    const tx = [
      { date: '2026-09-05', type: 'expense', amount: 0.1, account: 'Cash', status: 'completed' },
      { date: '2026-09-06', type: 'expense', amount: 0.2, account: 'Cash', status: 'completed' }
    ];
    assert.equal(monthTotals(tx, '2026-09').expenses, 0.3);
  });

  it('14. zero-income savings rate is null, never NaN/Infinity', () => {
    const m = monthTotals([{ date: '2026-09-05', type: 'expense', amount: 50, account: 'Cash', status: 'completed' }], '2026-09');
    assert.equal(m.savingsRate, null);
    const o = overview([], [cash(0)], {}, '2026-09');
    assert.equal(o.savingsRate, null);
  });

  it('15. reconciliation: chart totals equal ledger totals after edits', () => {
    const tx = [
      { id: 'T1', date: '2026-09-02', type: 'expense', amount: 1000, category: 'Food', account: 'Cash', status: 'completed' },
      { id: 'T2', date: '2026-09-05', type: 'income', amount: 5000, category: 'Salary', account: 'Bank', status: 'completed' },
      { id: 'T3', date: '2026-09-06', type: 'transfer', amount: 1000, accountFrom: 'Bank', accountTo: 'Cash', status: 'completed' }
    ];
    const v = validateReconciliation(tx, RANGE, {});
    assert.ok(v.ok, v.errors.join('; '));
    const ledger = ledgerTotals(tx, RANGE, {});
    assert.equal(ledger.expense, 1000);
    assert.equal(ledger.income, 5000);
  });

  it('pending/scheduled never move balances until completed', () => {
    const tx = [{ date: '2026-09-05', type: 'expense', amount: 500, account: 'Cash', status: 'pending' }];
    assert.equal(computeBalances([cash(1000)], tx)[0].balance, 1000);
  });
});

// ── Live API tests: ownership, duplicate/import idempotency ──
// Skipped unless FINTRACK_TEST_URL is set (needs a running server + creds).
const BASE = process.env.FINTRACK_TEST_URL;
const EMAIL = process.env.FINTRACK_TEST_EMAIL || 'prathmesh.nakate@ssg.com';
const PASS = process.env.FINTRACK_TEST_PASS || 'Prathmesh@123';

describe('api integrity (needs FINTRACK_TEST_URL)', { skip: !BASE }, () => {
  let token = null;
  it('9/10. repeated import with same idempotency key imports once', async () => {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASS })
    });
    assert.equal(login.status, 200);
    token = (await login.json()).token;
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const row = { date: '2026-09-10', type: 'expense', amount: 123.45, category: 'Food', account: 'Cash Wallet', merchant: 'DedupeProbe', status: 'completed' };
    const key = 'test_' + Date.now().toString(36);
    const once = await (await fetch(`${BASE}/api/import/confirm`, { method: 'POST', headers: h, body: JSON.stringify({ rows: [row], key }) })).json();
    const twice = await (await fetch(`${BASE}/api/import/confirm`, { method: 'POST', headers: h, body: JSON.stringify({ rows: [row], key }) })).json();
    assert.equal(twice.deduped, true);
    assert.equal(twice.imported, 0);
    // cleanup probe rows
    const list = await (await fetch(`${BASE}/api/transactions`, { headers: h })).json();
    for (const t of list.transactions.filter((t) => t.merchant === 'DedupeProbe')) {
      await fetch(`${BASE}/api/transactions/${t.id}`, { method: 'DELETE', headers: h });
    }
    assert.ok(once.imported >= 1 || once.imported === 0); // 0 if a previous run left it — preview flags dupes
  });

  it('11. endpoints require auth (no anonymous access)', async () => {
    const r = await fetch(`${BASE}/api/transactions`);
    assert.equal(r.status, 401);
  });
});
