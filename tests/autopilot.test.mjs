// Autopilot engine tests. Run with: npm test
// Pure unit tests always run. Live API tests (CRUD, isolation, approval,
// idempotency) run only when FINTRACK_TEST_URL is set, e.g.
// FINTRACK_TEST_URL=http://localhost:3000 npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOPILOT_TRIGGERS, validateRule, matchConditions, detectSalary,
  isUnusualAmount, budgetBreaches, monthSummary, previousMonthPrefix,
  idempotencyKey
} from '../src/services/autopilotEngine.js';

const goodRule = {
  name: 'Flag big spends',
  trigger: 'transaction_added',
  conditions: [{ field: 'amount', op: 'gt', value: 5000 }],
  actions: [{ kind: 'notify', message: 'Big spend recorded' }],
  requireApproval: false
};

describe('autopilot engine (pure)', () => {
  it('accepts a valid rule, rejects bad triggers/actions', () => {
    assert.deepEqual(validateRule(goodRule), []);
    assert.ok(validateRule({ ...goodRule, trigger: 'nope' }).length > 0);
    assert.ok(validateRule({ ...goodRule, actions: [] }).length > 0);
    assert.ok(validateRule({ ...goodRule, actions: [{ kind: 'create_draft', txType: 'expense' }] }).length > 0,
      'draft needs category + account');
    assert.deepEqual(validateRule({
      ...goodRule, actions: [{ kind: 'create_draft', txType: 'expense', category: 'Investment', account: 'Bank' }]
    }), []);
    assert.ok(validateRule({
      ...goodRule, trigger: 'month_closed',
      actions: [{ kind: 'create_draft', txType: 'expense', category: 'X', account: 'Y' }]
    }).some((e) => e.includes('only allowed on transaction_added')),
      'drafts rejected on non-transaction triggers');
  });

  it('validates condition fields per trigger', () => {
    assert.ok(validateRule({
      ...goodRule, trigger: 'budget_threshold',
      conditions: [{ field: 'amount', op: 'gt', value: 1 }]
    }).some((e) => e.includes('category, spent, pct')));
    assert.deepEqual(validateRule({
      ...goodRule, trigger: 'budget_threshold', conditions: [{ field: 'pct', op: 'gte', value: 80 }],
      params: { thresholdPct: 80 }
    }), []);
    assert.ok(validateRule({
      ...goodRule, trigger: 'budget_threshold', conditions: [],
      params: { thresholdPct: 0 }
    }).length > 0);
  });

  it('matches numeric, string and list conditions', () => {
    const txn = { amount: 6000, category: 'Food', type: 'expense', account: 'Cash Wallet', merchant: 'BigBasket' };
    assert.equal(matchConditions(txn, [{ field: 'amount', op: 'gt', value: 5000 }]), true);
    assert.equal(matchConditions(txn, [{ field: 'amount', op: 'lt', value: 5000 }]), false);
    assert.equal(matchConditions(txn, [{ field: 'category', op: 'eq', value: 'food' }]), true);
    assert.equal(matchConditions(txn, [{ field: 'merchant', op: 'contains', value: 'bigb' }]), true);
    assert.equal(matchConditions(txn, [{ field: 'category', op: 'in', value: ['Travel', 'Food'] }]), true);
    assert.equal(matchConditions(txn, [
      { field: 'amount', op: 'gt', value: 5000 },
      { field: 'type', op: 'eq', value: 'income' }
    ]), false, 'AND semantics');
  });

  it('detects salary income, ignores lookalikes', () => {
    assert.equal(detectSalary({ type: 'income', category: 'Salary', amount: 1 }), true);
    assert.equal(detectSalary({ type: 'income', category: 'Other', merchant: 'Acme Payroll' }), true);
    assert.equal(detectSalary({ type: 'expense', category: 'Salary', amount: 1 }), false);
    assert.equal(detectSalary({ type: 'income', category: 'Interest', amount: 1 }), false);
  });

  it('flags unusual amounts only with enough history', () => {
    assert.equal(isUnusualAmount(50000, [1000, 1200, 900, 1100]).unusual, false, 'abstains under 5 points');
    const chk = isUnusualAmount(50000, [1000, 1200, 900, 1100, 1000, 1300]);
    assert.equal(chk.unusual, true);
    assert.ok(chk.threshold >= 3000);
    assert.equal(isUnusualAmount(1500, [1000, 1200, 900, 1100, 1000, 1300]).unusual, false);
  });

  it('finds budget breaches at threshold', () => {
    const M = new Date().toISOString().slice(0, 7);
    const txns = [
      { date: `${M}-01`, type: 'expense', amount: 9000, category: 'Food', status: 'completed' },
      { date: `${M}-02`, type: 'expense', amount: 1000, category: 'Travel', status: 'completed' },
      { date: `${M}-03`, type: 'expense', amount: 5000, category: 'Food', status: 'pending' }
    ];
    const b = budgetBreaches(txns, { Food: 10000, Travel: 5000 }, M, 80);
    assert.equal(b.length, 1);
    assert.equal(b[0].category, 'Food');
    assert.equal(b[0].pct, 90);
  });

  it('summarises months and steps back correctly', () => {
    const s = monthSummary([
      { date: '2026-07-01', type: 'income', amount: 50000, status: 'completed' },
      { date: '2026-07-02', type: 'expense', amount: 20000, status: 'completed' },
      { date: '2026-07-03', type: 'refund', amount: 2000, status: 'completed' }
    ], '2026-07');
    assert.deepEqual(s, { income: 50000, spent: 18000, net: 32000, savings_rate: 64 });
    assert.equal(previousMonthPrefix('2026-08-15'), '2026-07');
    assert.equal(previousMonthPrefix('2026-01-10'), '2025-12');
  });

  it('builds distinct idempotency keys', () => {
    const a = idempotencyKey('r1', 'transaction_added', 't1');
    assert.notEqual(a, idempotencyKey('r1', 'transaction_added', 't2'));
    assert.notEqual(a, idempotencyKey('r2', 'transaction_added', 't1'));
    assert.ok(AUTOPILOT_TRIGGERS.length === 6);
  });
});

// ── Live API tests ───────────────────────────────────────
const BASE = process.env.FINTRACK_TEST_URL;

describe('autopilot api (needs FINTRACK_TEST_URL)', { skip: !BASE }, () => {
  const stamp = Date.now().toString(36);
  const mkUser = async (tag) => {
    const email = `auto_${tag}_${stamp}@example.com`.toLowerCase();
    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Autopilot123', name: `Auto ${tag}` })
    });
    assert.equal(signup.status, 201);
    const { token } = await signup.json();
    return { email, h: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
  };
  const post = async (h, path, body, method = 'POST') =>
    fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });

  it('rule fires on matching txn, stays silent otherwise (conditions)', async () => {
    const { h } = await mkUser('fire');
    const rule = await (await post(h, '/api/autopilot/rules', {
      name: 'Big spend watch', trigger: 'transaction_added',
      conditions: [{ field: 'amount', op: 'gt', value: 5000 }],
      actions: [{ kind: 'notify', message: 'Big spend!' }], requireApproval: false
    })).json();
    assert.ok(rule.rule.id);
    const tx = (m) => ({ date: '2026-09-10', type: 'expense', amount: m, category: 'Food', account: 'Cash Wallet', merchant: 'Probe', status: 'completed' });
    await post(h, '/api/transactions', tx(6000));
    await post(h, '/api/transactions', tx(100));
    const notifs = await (await fetch(`${BASE}/api/notifications`, { headers: h })).json();
    assert.equal(notifs.notifications.filter((n) => n.ruleId === rule.rule.id).length, 1);
    assert.equal(notifs.unread >= 1, true);
    // cleanup probe txns (keeps the shared dev DB tidy)
    const list = await (await fetch(`${BASE}/api/transactions`, { headers: h })).json();
    for (const t of list.transactions.filter((t) => t.merchant === 'Probe')) {
      await post(h, `/api/transactions/${t.id}`, undefined, 'DELETE');
    }
  });

  it('approval flow creates a scheduled draft only after approve', async () => {
    const { h } = await mkUser('approve');
    const rule = await (await post(h, '/api/autopilot/rules', {
      name: 'Draft SIP', trigger: 'transaction_added',
      conditions: [{ field: 'category', op: 'eq', value: 'Investment' }],
      actions: [{ kind: 'create_draft', txType: 'expense', category: 'Investment', account: 'Cash Wallet' }],
      requireApproval: true
    })).json();
    await post(h, '/api/transactions', {
      date: '2026-09-10', type: 'expense', amount: 7000, category: 'Investment',
      account: 'Cash Wallet', merchant: 'ProbeDraft', status: 'completed'
    });
    const notifs = await (await fetch(`${BASE}/api/notifications`, { headers: h })).json();
    const appr = notifs.notifications.find((n) => n.ruleId === rule.rule.id && n.kind === 'approval');
    assert.ok(appr, 'approval item created');
    const before = await (await fetch(`${BASE}/api/transactions`, { headers: h })).json();
    assert.equal(before.transactions.filter((t) => t.source === 'autopilot').length, 0, 'nothing written before approval');
    const done = await post(h, `/api/autopilot/approve/${appr.id}`);
    assert.equal(done.status, 201);
    const after = await (await fetch(`${BASE}/api/transactions`, { headers: h })).json();
    const draft = after.transactions.find((t) => t.source === 'autopilot');
    assert.ok(draft && draft.status === 'scheduled', 'scheduled draft created on approve');
    const again = await post(h, `/api/autopilot/approve/${appr.id}`);
    assert.equal(again.status, 400, 'double approve rejected');
  });

  it('budget evaluate is idempotent; rules are isolated per user', async () => {
    const a = await mkUser('isoA');
    const b = await mkUser('isoB');
    const rule = await (await post(a.h, '/api/autopilot/rules', {
      name: 'Food watch', trigger: 'budget_threshold',
      conditions: [{ field: 'pct', op: 'gte', value: 50 }],
      actions: [{ kind: 'notify', message: 'Food burning' }],
      requireApproval: false, params: { thresholdPct: 50 }
    })).json();
    await post(a.h, '/api/budgets', { budgets: { Food: 1000 } }, 'PUT');
    await post(a.h, '/api/transactions', {
      date: '2026-09-10', type: 'expense', amount: 600, category: 'Food',
      account: 'Cash Wallet', merchant: 'ProbeB', status: 'completed'
    });
    // the create hook auto-evaluates budgets, so the rule should already have fired once
    const autoRuns = await (await fetch(`${BASE}/api/autopilot/runs?limit=200`, { headers: a.h })).json();
    const autoCount = autoRuns.runs.filter((r) => r.ruleId === rule.rule.id).length;
    assert.equal(autoCount >= 1, true, 'create hook auto-fired the budget rule');
    const first = await (await post(a.h, '/api/autopilot/evaluate', { trigger: 'budget_threshold', month: '2026-09' })).json();
    assert.equal(first.fired, 0, 'explicit replay after auto-fire is idempotent');
    const runs1 = await (await fetch(`${BASE}/api/autopilot/runs?limit=200`, { headers: a.h })).json();
    const count1 = runs1.runs.filter((r) => r.ruleId === rule.rule.id).length;
    const second = await (await post(a.h, '/api/autopilot/evaluate', { trigger: 'budget_threshold', month: '2026-09' })).json();
    const runs2 = await (await fetch(`${BASE}/api/autopilot/runs?limit=200`, { headers: a.h })).json();
    assert.equal(first.fired, 0, 'replay fires nothing');
    assert.equal(runs2.runs.filter((r) => r.ruleId === rule.rule.id).length, count1, 'no duplicate runs');
    // isolation: B cannot see / touch A's rule
    assert.equal((await fetch(`${BASE}/api/autopilot/rules`, { headers: b.h }).then((r) => r.json())
      .then((j) => j.rules.some((r) => r.id === rule.rule.id))), false);
    assert.equal((await post(b.h, `/api/autopilot/rules/${rule.rule.id}`, { status: 'paused' }, 'PUT')).status, 404);
    assert.equal((await post(b.h, `/api/autopilot/rules/${rule.rule.id}`, undefined, 'DELETE')).status, 404);
  });

  it('rejects invalid rules and bad evaluate triggers', async () => {
    const { h } = await mkUser('valid');
    assert.equal((await post(h, '/api/autopilot/rules', { name: 'x' })).status, 400);
    assert.equal((await post(h, '/api/autopilot/evaluate', { trigger: 'transaction_added' })).status, 400);
    assert.equal((await post(h, '/api/autopilot/approve/nonexistent', {})).status, 404);
  });
});
