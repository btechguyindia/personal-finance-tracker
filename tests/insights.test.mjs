import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  tipOfTheDay, personalizedTips, smartSuggestions, healthScore,
  sipFutureValue, estimateNewRegimeTax, fiftyThirtyTwenty,
  emergencyFundCalc, LEARN_LINKS
} from '../src/services/insightsService.js';

const tx = (o) => ({ status: 'completed', ...o });

describe('insights service', () => {
  it('tip of the day is deterministic per date', () => {
    const a = tipOfTheDay('2026-09-26');
    const b = tipOfTheDay('2026-09-26');
    assert.equal(a.title, b.title);
    assert.ok(a.body.length > 10);
  });

  it('personalized tips handle empty ledger', () => {
    const tips = personalizedTips([], '2026-09');
    assert.ok(tips.length >= 1);
  });

  it('personalized tips flag food dominance', () => {
    const rows = [
      tx({ date: '2026-09-02', type: 'income', amount: 50000, account: 'Bank', category: 'Salary' }),
      tx({ date: '2026-09-03', type: 'expense', amount: 9000, account: 'Bank', category: 'Food' }),
      tx({ date: '2026-09-04', type: 'expense', amount: 1000, account: 'Bank', category: 'Health' }),
    ];
    const tips = personalizedTips(rows, '2026-09');
    assert.ok(tips.some((t) => /food/i.test(t.title)));
  });

  it('suggestions surface over-budget categories', () => {
    const rows = [
      tx({ date: '2026-09-03', type: 'expense', amount: 9000, account: 'Bank', category: 'Food' }),
    ];
    const s = smartSuggestions(rows, { Food: 5000 }, [], '2026-09');
    assert.ok(s.some((x) => /over budget/i.test(x.title)));
  });

  it('health score stays within 0-100', () => {
    const rows = [
      tx({ date: '2026-09-02', type: 'income', amount: 80000, account: 'Bank', category: 'Salary' }),
      tx({ date: '2026-09-03', type: 'expense', amount: 30000, account: 'Bank', category: 'Food' }),
    ];
    const h = healthScore(rows, [{ name: 'Bank', type: 'savings', balance: 200000 }], { Food: 40000 }, '2026-09');
    assert.ok(h.score >= 0 && h.score <= 100);
    assert.equal(h.parts.length, 5);
  });

  it('SIP math: zero return equals invested', () => {
    const r = sipFutureValue(10000, 0, 5);
    assert.equal(r.total, r.invested);
    assert.equal(r.gains, 0);
  });

  it('SIP math: positive return grows', () => {
    const r = sipFutureValue(10000, 12, 10);
    assert.ok(r.total > r.invested);
    assert.equal(r.total, r.invested + r.gains);
  });

  it('tax estimator: low income pays nothing (87A)', () => {
    const t = estimateNewRegimeTax(900000);
    assert.equal(t.total, 0);
  });

  it('tax estimator: high income pays slab tax', () => {
    const t = estimateNewRegimeTax(2500000);
    assert.ok(t.total > 100000);
  });

  it('50/30/20 splits needs vs wants', () => {
    const rows = [
      tx({ date: '2026-09-02', type: 'income', amount: 100000, account: 'Bank', category: 'Salary' }),
      tx({ date: '2026-09-03', type: 'expense', amount: 30000, account: 'Bank', category: 'Housing' }),
      tx({ date: '2026-09-04', type: 'expense', amount: 10000, account: 'Bank', category: 'Entertainment' }),
    ];
    const s = fiftyThirtyTwenty(rows, '2026-09');
    assert.equal(s.needs, 30000);
    assert.equal(s.wants, 10000);
    assert.equal(s.saved, 60000);
  });

  it('emergency fund targets 6 months', () => {
    const e = emergencyFundCalc(30000, 90000);
    assert.equal(e.target, 180000);
    assert.equal(e.gap, 90000);
  });

  it('learn links are all https', () => {
    assert.ok(LEARN_LINKS.length >= 6);
    for (const l of LEARN_LINKS) assert.ok(l.url.startsWith('https://'));
  });
});
