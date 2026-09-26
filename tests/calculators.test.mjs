// Calculator accuracy tests. Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  emi, amortization, yearlySchedule, simpleInterest,
  compoundMaturity, sipFutureValue, discountPrice
} from '../src/services/calculators.js';

describe('calculators', () => {
  it('EMI: ₹1,00,000 @ 10% for 12 months ≈ ₹8,791.59', () => {
    const { emi: e, totalPayment, totalInterest } = emi(100000, 10, 12);
    assert.ok(Math.abs(e - 8791.59) < 0.05, `got ${e}`);
    assert.ok(Math.abs(totalPayment - e * 12) < 0.01);
    assert.ok(Math.abs(totalInterest - (totalPayment - 100000)) < 0.01);
  });

  it('EMI with 0% rate splits principal evenly', () => {
    assert.deepEqual(emi(120000, 0, 12), { emi: 10000, totalPayment: 120000, totalInterest: 0 });
  });

  it('EMI with zero principal/months returns zeros', () => {
    assert.deepEqual(emi(0, 10, 12), { emi: 0, totalPayment: 0, totalInterest: 0 });
    assert.deepEqual(emi(100000, 10, 0), { emi: 0, totalPayment: 0, totalInterest: 0 });
  });

  it('amortization reconciles: Σprincipal ≈ P, closing balance 0', () => {
    const rows = amortization(500000, 9, 24);
    assert.equal(rows.length, 24);
    const princ = rows.reduce((s, r) => s + r.principal, 0);
    assert.ok(Math.abs(princ - 500000) < 1, `Σprincipal=${princ}`);
    assert.equal(rows[23].balance, 0);
    const intr = rows.reduce((s, r) => s + r.interest, 0);
    const { totalInterest } = emi(500000, 9, 24);
    assert.ok(Math.abs(intr - totalInterest) < 2, `Σinterest=${intr} vs ${totalInterest}`);
  });

  it('yearly schedule rolls 24 months into 2 rows', () => {
    const years = yearlySchedule(amortization(500000, 9, 24));
    assert.equal(years.length, 2);
    assert.equal(years[0].year, 1);
    assert.equal(years[1].balance, 0);
  });

  it('simple interest: 10000 @ 10% for 2y → 2000', () => {
    assert.deepEqual(simpleInterest(10000, 10, 2), { interest: 2000, total: 12000 });
  });

  it('compound maturity matches A = P(1+r/4)^(4t)', () => {
    const { maturity, interest } = compoundMaturity(100000, 8, 5, 4);
    const expected = Math.round(100000 * Math.pow(1 + 0.08 / 4, 20) * 100) / 100;
    assert.equal(maturity, expected);
    assert.equal(interest, Math.round((expected - 100000) * 100) / 100);
  });

  it('SIP with 0% return equals invested amount', () => {
    assert.deepEqual(sipFutureValue(10000, 0, 12), { invested: 120000, maturity: 120000, gains: 0 });
  });

  it('SIP: 10000/mo @ 12% for 12mo ≈ 1,28,093', () => {
    const { maturity, invested, gains } = sipFutureValue(10000, 12, 12);
    assert.equal(invested, 120000);
    assert.ok(Math.abs(maturity - 128093) < 5, `got ${maturity}`);
    assert.ok(Math.abs(gains - (maturity - invested)) < 0.01);
  });

  it('discount: MRP 1000, 20% off + 10% coupon + 18% GST', () => {
    const d = discountPrice(1000, 20, 10, 18);
    assert.equal(d.afterDiscount, 800);
    assert.equal(d.afterExtra, 720);
    assert.equal(d.tax, 129.6);
    assert.equal(d.final, 849.6);
    assert.equal(d.savings, 280);
  });

  it('discount clamps percentages to sane ranges', () => {
    const d = discountPrice(1000, 150, -5, 0);
    assert.equal(d.afterDiscount, 0);
    assert.equal(d.final, 0);
  });
});
