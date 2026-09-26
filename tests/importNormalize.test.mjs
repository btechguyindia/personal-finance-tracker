import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeImportRow, normalizeType, normalizeStatus, normalizeCategory,
  isBareAccountRef
} from '../src/services/importNormalize.js';
import { parseUPI, autoDetectBank } from '../src/services/statementParsers.js';

describe('import normalization (bank debit/credit exports)', () => {
  it('maps debit/credit to expense/income', () => {
    assert.equal(normalizeType('debit'), 'expense');
    assert.equal(normalizeType('CREDIT'), 'income');
    assert.equal(normalizeType('expense'), 'expense');
  });

  it('maps bank statuses; dead rows skip with a reason', () => {
    assert.equal(normalizeStatus('SUCCESSFUL'), 'completed');
    assert.equal(normalizeStatus('Success'), 'completed');
    assert.equal(normalizeStatus(''), 'completed');
    const dead = normalizeStatus('FAILED');
    assert.ok(dead && dead.skip, 'failed rows must skip, never import');
  });

  it('maps app category labels', () => {
    assert.equal(normalizeCategory('Food & Dining'), 'Food');
    assert.equal(normalizeCategory('Bills & Utilities'), 'Housing');
    assert.equal(normalizeCategory('UPI Payment'), 'Miscellaneous');
    assert.equal(normalizeCategory('Health'), 'Health');
  });

  it('stashes bare account numbers, keeps real accounts', () => {
    assert.ok(isBareAccountRef('6052458790'));
    assert.ok(!isBareAccountRef('HDFC Savings'));
    const { row } = normalizeImportRow({ date: '2026-03-27', type: 'debit', amount: 70, category: 'Food & Dining', account: '6052458790', status: 'SUCCESS' });
    assert.equal(row.type, 'expense');
    assert.equal(row.status, 'completed');
    assert.equal(row.category, 'Food');
    assert.equal(row.account, '');
    assert.ok(row.description.includes('6052458790'));
  });

  it('credit reversals become refunds, not income', () => {
    const { row } = normalizeImportRow({ date: '2026-04-25', type: 'credit', amount: 50, category: 'Reversal', account: 'X', status: 'SUCCESS' });
    assert.equal(row.type, 'refund');
  });

  it('failed rows skip instead of erroring cryptically', () => {
    const out = normalizeImportRow({ date: '2026-04-25', type: 'debit', amount: 50, category: 'UPI Payment', account: 'X', status: 'FAILED' });
    assert.equal(out.skipped, true);
    assert.match(out.reason, /no money moved/);
  });

  it('auto-detects debit/credit app exports as upi', () => {
    const csv = `Date,Type,Amount,Category,Account,Status
2026-03-27,debit,70,Food & Dining,6052458790,SUCCESS
2026-03-31,credit,30,Income,6052458790,SUCCESS`;
    assert.equal(autoDetectBank(csv), 'upi');
  });

  it('parses the debit/credit app layout end to end', () => {
    const csv = `Date,Type,Amount,Category,Account,Status
2026-03-26,debit,10,Transfer,6052458790,SUCCESS
2026-03-27,debit,70,Food & Dining,6052458790,SUCCESS
2026-03-31,credit,30,Income,6052458790,SUCCESS
2026-04-25,credit,50,Reversal,6052458790,SUCCESS
2026-04-25,debit,50,UPI Payment,6052458790,FAILED`;
    const rows = parseUPI(csv, 'Cash Wallet');
    assert.equal(rows.length, 4, 'failed row must be dropped');
    assert.equal(rows[0].type, 'expense');
    assert.equal(rows[0].category, 'Transfer');
    assert.equal(rows[1].category, 'Food');
    assert.equal(rows[2].type, 'income');
    assert.equal(rows[3].type, 'refund');
    for (const r of rows) {
      assert.equal(r.status, 'completed');
      assert.equal(r.account, 'Cash Wallet');
      assert.ok(r.date && r.amount > 0);
    }
  });
});
