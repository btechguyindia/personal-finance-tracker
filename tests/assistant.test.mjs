// Rule-based assistant tests. Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assistantReply } from '../src/services/assistant.js';

const M = new Date().toISOString().slice(0, 7);
const txns = [
  { date: `${M}-02`, type: 'income', amount: 80000, account: 'Bank', category: 'Salary', status: 'completed' },
  { date: `${M}-05`, type: 'expense', amount: 12000, account: 'Bank', category: 'Food', status: 'completed' },
  { date: `${M}-08`, type: 'expense', amount: 8000, account: 'Bank', category: 'Food', status: 'completed' },
  { date: `${M}-10`, type: 'expense', amount: 5000, account: 'Bank', category: 'Travel', status: 'completed' },
  { date: `${M}-11`, type: 'expense', amount: 4000, account: 'Bank', category: 'Food', status: 'pending' }
];
const ctx = {
  transactions: txns,
  budgets: { Food: 15000, Travel: 3000 },
  accounts: [{ name: 'Bank', balance: 55000, isLiability: false }, { name: 'Card', balance: 5000, isLiability: true }],
  goals: [{ name: 'Trip', target: 100000, current: 25000, status: 'active' }],
  userName: 'Test'
};

describe('assistant', () => {
  it('summarises monthly spending (pending excluded)', () => {
    const r = assistantReply('how much did I spend this month?', ctx);
    assert.ok(r.includes('25,000'), r);
    assert.ok(r.includes('80,000'), r);
  });

  it('names the top category', () => {
    const r = assistantReply('what is my top category?', ctx);
    assert.ok(r.includes('Food'), r);
    assert.ok(r.includes('20,000'), r);
  });

  it('flags over-budget categories', () => {
    const r = assistantReply('am I over budget?', ctx);
    assert.ok(r.includes('Travel'), r);
  });

  it('computes the savings rate', () => {
    const r = assistantReply('what is my savings rate?', ctx);
    assert.ok(r.includes('68.8%'), r);
  });

  it('reports balances and goals', () => {
    assert.ok(assistantReply('what is my net worth?', ctx).includes('50,000'));
    assert.ok(assistantReply('how are my goals?', ctx).includes('Trip'));
  });

  it('handles empty data + greetings + fallback', () => {
    assert.ok(assistantReply('spent?', { transactions: [] }).includes('No transactions'));
    assert.ok(assistantReply('hello', ctx).includes('Test'));
    assert.ok(assistantReply('xyz gibberish', ctx).includes('spending'));
  });
});
