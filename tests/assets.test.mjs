// Assets & Debt tests — Phase 4.
// Pure engine tests always run. Live API tests run only when
// FINTRACK_TEST_URL is set, using freshly signed-up TEMP users against an
// ISOLATED server — never production.
//   FINTRACK_TEST_URL=http://localhost:3220 npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  emiFor, amortize, compareScenarios, netWorth, isValidDate, addMonths
} from '../src/services/loans.js';
import { emi as calcEmi, amortization as calcAmort } from '../src/services/calculators.js';

describe('loans engine (pure, paise-exact)', () => {
  it('1. emiFor agrees with the existing EMI calculator', () => {
    for (const [P, r, n] of [[100000, 9, 12], [5000000, 8.5, 240], [250000, 12, 36], [100000, 0, 10]]) {
      const a = emiFor(P * 100, r, n) / 100;
      const b = calcEmi(P, r, n).emi;
      assert.ok(Math.abs(a - b) < 1.5, `P=${P} r=${r} n=${n}: engine ${a} vs calculator ${b}`);
    }
  });

  it('2. zero-interest loan splits evenly with dust absorbed', () => {
    const s = amortize({ principalPaise: 100001, annualRatePct: 0, emiPaise: 10000, startDate: '2026-01-15' });
    assert.equal(s.totalInterestPaise, 0);
    assert.equal(s.schedule[s.schedule.length - 1].balancePaise, 0);
    assert.equal(s.schedule.reduce((t, r) => t + r.principalPaise, 0), 100001);
    assert.equal(s.payoffDate, addMonths('2026-01-15', s.months - 1));
  });

  it('3. standard loan reconciles: principal sums to P, balance closes at 0', () => {
    const P = 10000000;
    const e = emiFor(P, 9, 120);
    const s = amortize({ principalPaise: P, annualRatePct: 9, emiPaise: e, startDate: '2026-04-10' });
    assert.equal(s.months, 120);
    assert.ok(Math.abs(s.schedule.reduce((t, r) => t + r.principalPaise, 0) - P) <= 120, 'principal reconciles');
    assert.equal(s.schedule[s.schedule.length - 1].balancePaise, 0);
    assert.ok(s.totalInterestPaise > 0, 'interest charged');
    assert.equal(s.payoffDate.slice(0, 7), addMonths('2026-04-10', 119).slice(0, 7));
    // cross-check against the existing schedule (rupee rounding tolerance)
    const ref = calcAmort(P / 100, 9, 120);
    assert.ok(Math.abs(s.totalInterestPaise / 100 - ref.reduce((t, r) => t + r.interest, 0)) < 120, 'interest agrees');
  });

  it('4. extra monthly shortens the term and saves interest', () => {
    const base = { principalPaise: 5000000, annualRatePct: 9, emiPaise: 0, startDate: '2026-01-01' };
    base.emiPaise = emiFor(base.principalPaise, 9, 60);
    const plain = amortize(base);
    const fast = amortize({ ...base, extraMonthlyPaise: 500000 });
    assert.ok(fast.months < plain.months, `${fast.months} < ${plain.months}`);
    assert.ok(fast.totalInterestPaise < plain.totalInterestPaise, 'interest saved');
  });

  it('5. one-time prepayment saves interest without changing EMI', () => {
    const base = { principalPaise: 5000000, annualRatePct: 9, emiPaise: 0, startDate: '2026-01-01' };
    base.emiPaise = emiFor(base.principalPaise, 9, 60);
    const plain = amortize(base);
    const pre = amortize({ ...base, prepayments: [{ date: '2026-07-01', paise: 1000000 }] });
    assert.ok(pre.months < plain.months && pre.totalInterestPaise < plain.totalInterestPaise);
    const bad = amortize({ ...base, prepayments: [{ date: 'not-a-date', paise: 1000000 }] });
    assert.equal(bad.months, plain.months, 'bad prepay dates ignored');
  });

  it('6. EMI below monthly interest is flagged unpayable, never infinite', () => {
    const s = amortize({ principalPaise: 10000000, annualRatePct: 12, emiPaise: 1000, startDate: '2026-01-01' });
    assert.equal(s.unpayable, true);
    assert.equal(s.payoffDate, null);
    const z = amortize({ principalPaise: 100000, annualRatePct: 5, emiPaise: 0, startDate: '2026-01-01' });
    assert.equal(z.unpayable, true);
  });

  it('7. compareScenarios ranks strategies without touching anything', () => {
    const loan = { outstandingPaise: 2000000, annualRatePct: 10, emiPaise: 0, nextDueDate: '2026-02-01', startDate: '2026-01-01' };
    loan.emiPaise = emiFor(loan.outstandingPaise, 10, 36);
    const rows = compareScenarios(loan, { extraMonthlyPaise: 100000, prepayments: [{ date: '2026-06-01', paise: 200000 }] });
    assert.equal(rows.length, 4);
    assert.equal(rows[0].interestSavedVsEmiPaise, 0);
    assert.ok(rows[3].interestSavedVsEmiPaise >= rows[1].interestSavedVsEmiPaise, 'combined beats extra alone');
    assert.ok(rows.every((r) => Array.isArray(r.assumptions) && r.assumptions.length > 0), 'assumptions visible');
  });

  it('8. net worth: linked uses live balance once; estimates flagged; cards excluded', () => {
    const nw = netWorth({
      asOf: '2026-09-27',
      balances: [{ name: 'HDFC', balancePaise: 500000 }],
      assets: [
        { id: 'a1', name: 'Savings', type: 'bank', valuePaise: 1, linkedAccount: 'HDFC', valuationDate: '2026-09-01' },
        { id: 'a2', name: 'Gold', type: 'gold', valuePaise: 300000, valuationDate: '2026-09-01' },
        { id: 'a3', name: 'Old FD', type: 'fixed_deposit', valuePaise: 100000, valuationDate: '2025-01-01' },
        { id: 'a4', name: 'Ghost', type: 'bank', valuePaise: 999999, linkedAccount: 'Nope', valuationDate: '2026-09-01' }
      ],
      liabilities: [
        { id: 'l1', name: 'Home', type: 'home_loan', outstandingPaise: 400000, updatedAt: '2026-09-20T00:00:00.000Z' },
        { id: 'l2', name: 'Card', type: 'credit_card', outstandingPaise: 50000, updatedAt: '2026-09-20T00:00:00.000Z' }
      ]
    });
    // linked HDFC counts 500000 (NOT 500000+1): valuePaise ignored when linked
    assert.equal(nw.totalAssetsPaise, 500000 + 300000 + 100000 + 999999);
    assert.equal(nw.totalLiabilitiesPaise, 400000, 'card excluded');
    assert.equal(nw.netWorthPaise, nw.totalAssetsPaise - 400000);
    assert.equal(nw.excluded.length, 1);
    assert.equal(nw.status, 'partial', 'stale + broken link + estimates');
    assert.ok(nw.flags.some((f) => f.includes('Old FD') && f.includes('stale')));
    assert.ok(nw.flags.some((f) => f.includes('Ghost') && f.includes('not found')));
    assert.ok(nw.estimateSharePct > 0, 'estimate share reported');
    assert.ok(Math.abs(nw.debtToAssetPct - (400000 / nw.totalAssetsPaise) * 100) < 1e-9);
  });

  it('9. date helpers validate strictly', () => {
    assert.equal(isValidDate('2026-02-30'), false);
    assert.equal(isValidDate('2026-13-01'), false);
    assert.equal(isValidDate('2026-09-27'), true);
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28', 'month-end clamped');
  });
});

// ── Live API tests (isolated temp users) ──
const BASE = process.env.FINTRACK_TEST_URL;

describe('assets & debt api (needs FINTRACK_TEST_URL)', { skip: !BASE }, () => {
  const stamp = Date.now().toString(36);
  const mkUser = async (tag) => {
    const email = `ass_${tag}_${stamp}@example.com`.toLowerCase();
    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Ass12345', name: `Ass ${tag}` })
    });
    assert.equal(signup.status, 201);
    const { token } = await signup.json();
    return { h: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
  };

  it('10. asset CRUD is ownership-isolated', async () => {
    const a = await mkUser('a1');
    const b = await mkUser('a2');
    const created = await (await fetch(`${BASE}/api/assets`, {
      method: 'POST', headers: a.h,
      body: JSON.stringify({ name: 'Gold', type: 'gold', value: 300000 })
    })).json();
    assert.ok(created.asset.id);
    assert.equal(created.asset.valuations.length, 1, 'opening valuation seeded');
    assert.equal((await (await fetch(`${BASE}/api/assets`, { headers: b.h })).json()).assets.length, 0, 'B sees nothing');
    assert.equal(await (await fetch(`${BASE}/api/assets/${created.asset.id}`, { method: 'DELETE', headers: b.h })).status, 404, 'B cannot delete A\u2019s asset');
    assert.equal((await (await fetch(`${BASE}/api/assets/${created.asset.id}`, { method: 'DELETE', headers: a.h })).status), 200);
  });

  it('11. invalid assets and liabilities are rejected', async () => {
    const { h } = await mkUser('inv');
    const badAsset = await fetch(`${BASE}/api/assets`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ name: 'X', type: 'yacht', value: -5, linkedAccount: 'Ghost' })
    });
    assert.equal(badAsset.status, 400);
    const badLoan = await fetch(`${BASE}/api/liabilities`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ name: 'L', type: 'home_loan', principal: 100, annualRatePct: 150, startDate: '2026-13-99', emi: 10, emiFrequency: 'weekly' })
    });
    assert.equal(badLoan.status, 400);
    const over = await fetch(`${BASE}/api/liabilities`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ name: 'L', type: 'home_loan', principal: 100, outstanding: 200, annualRatePct: 9, startDate: '2026-01-01', emi: 10 })
    });
    assert.equal(over.status, 400, 'outstanding above principal rejected');
  });

  it('12. valuations append history; latest date wins, backdates stay historical', async () => {
    const { h } = await mkUser('val');
    const today = new Date().toISOString().slice(0, 10);
    const created = await (await fetch(`${BASE}/api/assets`, {
      method: 'POST', headers: h, body: JSON.stringify({ name: 'FD', type: 'fixed_deposit', value: 100000, valuationDate: '2026-01-01' })
    })).json();
    const id = created.asset.id;
    await fetch(`${BASE}/api/assets/${id}/valuations`, {
      method: 'POST', headers: h, body: JSON.stringify({ date: today, value: 105000, note: 'renewed' })
    });
    let list = await (await fetch(`${BASE}/api/assets`, { headers: h })).json();
    let got = list.assets.find((x) => x.id === id);
    assert.equal(got.valuations.length, 2);
    assert.equal(got.value, 105000, 'current-dated valuation moves the value');
    // a backdated entry is kept as history but must not move the current value
    await fetch(`${BASE}/api/assets/${id}/valuations`, {
      method: 'POST', headers: h, body: JSON.stringify({ date: '2026-03-01', value: 102000, note: 'backfill' })
    });
    list = await (await fetch(`${BASE}/api/assets`, { headers: h })).json();
    got = list.assets.find((x) => x.id === id);
    assert.equal(got.valuations.length, 3);
    assert.equal(got.value, 105000, 'backfill stays historical');
    assert.equal(got.valuationDate, today);
  });

  it('13. loan payment posts exactly one transfer and reduces outstanding', async () => {
    const { h } = await mkUser('pay');
    const loan = await (await fetch(`${BASE}/api/liabilities`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ name: 'Home', type: 'home_loan', principal: 100000, annualRatePct: 9, startDate: '2026-01-01', emi: 5000, nextDueDate: '2026-10-01', lender: 'HDFC' })
    })).json();
    const before = (await (await fetch(`${BASE}/api/transactions`, { headers: h })).json()).transactions.length;
    const pay = await fetch(`${BASE}/api/liabilities/${loan.liability.id}/payments`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ date: '2026-10-01', account: 'HDFC Savings', amount: 5000, interest: 750, note: 'oct emi' })
    });
    assert.equal(pay.status, 201);
    const out = await pay.json();
    assert.equal(out.liability.outstanding, 100000 - 4250, 'principal slice reduces outstanding');
    assert.equal(out.transaction.type, 'transfer', 'payment is a transfer, not an expense');
    const after = (await (await fetch(`${BASE}/api/transactions`, { headers: h })).json()).transactions;
    assert.equal(after.length, before + 1, 'exactly one ledger row');
    // overpay and unknown account rejected
    assert.equal((await fetch(`${BASE}/api/liabilities/${loan.liability.id}/payments`, {
      method: 'POST', headers: h, body: JSON.stringify({ account: 'HDFC Savings', amount: 99999999 })
    })).status, 400);
    assert.equal((await fetch(`${BASE}/api/liabilities/${loan.liability.id}/payments`, {
      method: 'POST', headers: h, body: JSON.stringify({ account: 'Nope', amount: 100 })
    })).status, 400);
    // transfer excluded from income/expense analytics
    const backup = await (await fetch(`${BASE}/api/portability/backup`, { headers: h })).json();
    const payTx = backup.data.transactions.find((t) => t.source === 'loan_payment');
    assert.ok(payTx && payTx.type === 'transfer', 'payment never counts as spending');
  });

  it('14. portability carries assets and liabilities; replace stays scoped', async () => {
    const a = await mkUser('portA');
    const b = await mkUser('portB');
    await fetch(`${BASE}/api/assets`, { method: 'POST', headers: a.h, body: JSON.stringify({ name: 'Gold', type: 'gold', value: 100 }) });
    await fetch(`${BASE}/api/liabilities`, {
      method: 'POST', headers: a.h,
      body: JSON.stringify({ name: 'Home', type: 'home_loan', principal: 1000, annualRatePct: 9, startDate: '2026-01-01', emi: 100 })
    });
    const backup = await (await fetch(`${BASE}/api/portability/backup`, { headers: a.h })).json();
    assert.ok((backup.data.assets || []).some((x) => x.name === 'Gold'), 'assets exported');
    assert.ok((backup.data.liabilities || []).some((x) => x.name === 'Home'), 'liabilities exported');
    assert.ok(!JSON.stringify(backup).toLowerCase().includes('securityevents'), 'still no security data');
    // merge into B: both arrive exactly once
    const m1 = await (await fetch(`${BASE}/api/portability/restore`, {
      method: 'POST', headers: b.h, body: JSON.stringify({ backup, mode: 'merge' })
    })).json();
    assert.equal(m1.inserted.assets, 1);
    assert.equal(m1.inserted.liabilities, 1);
    const m2 = await (await fetch(`${BASE}/api/portability/restore`, {
      method: 'POST', headers: b.h, body: JSON.stringify({ backup, mode: 'merge' })
    })).json();
    assert.equal(m2.inserted.assets || 0, 0, 'no duplicate assets on re-merge');
  });

  it('15. unauthorized asset/debt calls are blocked', async () => {
    assert.equal((await fetch(`${BASE}/api/assets`)).status, 401);
    assert.equal((await fetch(`${BASE}/api/liabilities`)).status, 401);
    assert.equal((await fetch(`${BASE}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  });
});
