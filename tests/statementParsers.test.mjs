import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHDFC, parseSBI, parseICICI, parseUPI, autoDetectBank, parseDate, parseAmount } from '../src/services/statementParsers.js';

describe('bank statement presets', () => {
  it('parses HDFC debit/credit columns', () => {
    const csv = `Date,Narration,Value Dat,Debit Amount,Credit Amount,Chq/Ref Number,Closing Balance
12/09/2026,UPI-SWIGGY-417700001111,12/09/2026,450.00,0,,12500.00
13/09/2026,NEFT SALARY SEPT,13/09/2026,0,"85,000.00",,97500.00`;
    const rows = parseHDFC(csv, 'HDFC Savings');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].type, 'expense');
    assert.equal(rows[0].amount, 450);
    assert.equal(rows[0].date, '2026-09-12');
    assert.equal(rows[1].type, 'income');
    assert.equal(rows[1].amount, 85000);
    assert.equal(rows[1].account, 'HDFC Savings');
  });

  it('parses SBI DD-Mon-YYYY dates', () => {
    const csv = `Txn Date,Description,Ref No./Cheque No.,Debit,Credit,Balance
12 Sep 2026,UPI/DR/SWIGGY/417700001112, ,450.00,,50000.00
13 Sep 2026,SALARY CREDIT SEP,,,"85,000.00",135000.00`;
    const rows = parseSBI(csv, 'SBI Salary');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].date, '2026-09-12');
    assert.equal(rows[0].type, 'expense');
    assert.equal(rows[1].type, 'income');
  });

  it('parses ICICI withdrawal/deposit columns', () => {
    const csv = `S No.,Value Date,Transaction Date,Transaction Remarks,Withdrawal Amt (INR),Deposit Amt (INR),Balance (INR)
1,12-09-2026,12-09-2026,UPI/NETFLIX/SUBSCRIPTION,199.00,0.00,20000.00
2,13-09-2026,13-09-2026,NEFT SALARY,0.00,85000.00,105000.00`;
    const rows = parseICICI(csv, 'ICICI Savings');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].category, 'Entertainment');
    assert.equal(rows[1].type, 'income');
  });

  it('parses UPI app exports', () => {
    const csv = `Date,Note,Amount,Type
2026-09-12,Paid Swiggy,450,DEBIT
2026-09-13,Salary received,85000,CREDIT`;
    const rows = parseUPI(csv, 'UPI');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].type, 'expense');
    assert.equal(rows[1].type, 'income');
  });

  it('auto-detects bank layouts', () => {
    assert.equal(autoDetectBank('Date,Narration,Value Dat,Debit Amount,Credit Amount'), 'hdfc');
    assert.equal(autoDetectBank('S No.,Value Date,Transaction Date,Transaction Remarks,Withdrawal Amt,Deposit Amt'), 'icici');
  });

  it('date/amount helpers handle Indian formats', () => {
    assert.equal(parseDate('12/09/26'), '2026-09-12');
    assert.equal(parseDate('12 Sep 2026'), '2026-09-12');
    assert.equal(parseAmount('"85,000.00"'), 85000);
  });
});
