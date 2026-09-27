// Data Portability Center tests — Phase 3.
// Pure tests always run. Live API tests run only when FINTRACK_TEST_URL is set
// and use freshly signed-up TEMP users only — never the real account, and they
// clean up their records with merge/replace flows scoped to themselves.
//   FINTRACK_TEST_URL=http://localhost:3220 npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_FORMAT, BACKUP_VERSION, BACKUP_MAX_TRANSACTIONS, BACKUP_MAX_BYTES,
  PORTABLE_COLLECTIONS, RESTORE_REPLACE_PHRASE,
  normalizeBackup, validateBackupData, summarizeBackup,
  buildManifest, verifyManifest, canonicalStringify, diffPreview
} from '../src/services/portability.js';

const goodBackup = () => ({
  format: BACKUP_FORMAT, version: BACKUP_VERSION,
  exportedAt: '2026-09-27T00:00:00.000Z',
  user: { id: 'u_test' },
  manifest: undefined,
  data: {
    transactions: [
      { id: 'T1', date: '2026-09-02', type: 'expense', amount: 100, category: 'Food', account: 'Cash', status: 'completed' },
      { id: 'T2', date: '2026-09-03', type: 'income', amount: 1000, category: 'Salary', account: 'Bank', status: 'completed' }
    ],
    budgets: { Food: 500 },
    accounts: [{ id: 'ac_1', name: 'Cash', type: 'cash', openingBalance: 0 }],
    categories: [{ id: 'c_1', name: 'Food', kind: 'expense' }],
    upiIds: [{ id: 'upi_1', upiId: 'test@okhdfc' }],
    goals: [{ id: 'g_1', name: 'Trip', target: 5000, current: 100 }],
    contributions: [{ id: 'gc_1', goalId: 'g_1', amount: 100, date: '2026-09-04' }],
    recurring: [{ id: 'r_1', name: 'Rent', amount: 500, type: 'expense', frequency: 'monthly', startDate: '2026-09-01' }],
    imports: [{ key: 'imp_1', rowCount: 2 }],
    autopilotRules: [],
    autopilotRuns: [],
    notifications: [],
    preferences: { theme: 'dark', fyStartMonth: 4 }
  }
});

describe('portability pure (Phase 3)', () => {
  it('1. normalize accepts versioned backups, rejects unknown shapes/versions', () => {
    assert.equal(normalizeBackup(goodBackup()).ok, true);
    assert.ok(!normalizeBackup(null).ok);
    assert.ok(!normalizeBackup({ foo: 1 }).ok);
    const bad = goodBackup(); bad.version = 999;
    assert.match(normalizeBackup(bad).errors.join(' '), /unsupported backup version/);
    // legacy /api/export shape is normalized, not rejected
    const legacy = { transactions: [{ date: '2026-09-01', type: 'expense', amount: 5, category: 'Food', account: 'Cash' }], budgets: [{ category: 'Food', amount: 10 }] };
    const n = normalizeBackup(legacy);
    assert.equal(n.ok, true);
    assert.equal(n.data.budgets.Food, 10);
  });

  it('2. export allowlist excludes all security-sensitive collections', () => {
    for (const banned of ['users', 'sessions', 'resets', 'securityEvents', 'audit', 'password', 'hash', 'token']) {
      assert.ok(!PORTABLE_COLLECTIONS.includes(banned), `${banned} must never be exportable`);
    }
    for (const needed of ['transactions', 'accounts', 'budgets', 'categories', 'upiIds', 'goals', 'contributions', 'recurring', 'imports', 'autopilotRules', 'autopilotRuns', 'notifications', 'preferences']) {
      assert.ok(PORTABLE_COLLECTIONS.includes(needed), `${needed} must be exportable`);
    }
  });

  it('3. duplicate ids and invalid money are rejected; precision/unknowns warn', () => {
    const b = goodBackup();
    b.data.transactions.push({ id: 'T1', date: '2026-09-05', type: 'expense', amount: 10, category: 'Food', account: 'Cash' });
    b.data.transactions.push({ id: 'T9', date: '2026-09-05', type: 'expense', amount: 0, category: 'Food', account: 'Cash' });
    b.data.transactions.push({ id: 'T10', date: '2026-09-05', type: 'expense', amount: 10.999, category: 'Food', account: 'Cash',zzz: 1 });
    const r = validateBackupData(b.data, { ownerId: 'u_test' });
    assert.ok(r.errors.some((e) => e.includes('duplicate id "T1"')), 'duplicate id detected');
    assert.ok(r.errors.some((e) => e.includes('T9') && e.includes('amount')), 'zero amount rejected');
    assert.ok(r.warnings.some((w) => w.includes('rounds to paise')), 'sub-paise precision warns');
    assert.ok(r.warnings.some((w) => w.includes('unknown field "zzz"')), 'unknown field warns');
    assert.equal(r.invalid.transactions, 2);
  });

  it('3b. zero opening balance and zero goal progress are valid balances', () => {
    const b = goodBackup();
    b.data.accounts[0].openingBalance = 0;
    b.data.goals[0].current = 0;
    const r = validateBackupData(b.data, { ownerId: 'u_test' });
    assert.equal(r.invalid.accounts, 0, JSON.stringify(r.errors));
    assert.equal(r.invalid.goals, 0, JSON.stringify(r.errors));
  });

  it('4. ownership mismatch errors; dangling refs warn without failing', () => {
    const b = goodBackup();
    b.data.transactions[0].userId = 'u_someone_else';
    b.data.contributions.push({ id: 'gc_9', goalId: 'g_missing', amount: 5, date: '2026-09-05' });
    const r = validateBackupData(b.data, { ownerId: 'u_test', knownAccounts: [] });
    assert.ok(r.errors.some((e) => e.includes('different user')), 'foreign record rejected');
    assert.ok(r.dangling.some((d) => d.includes('g_missing')), 'dangling goalId reported');
  });

  it('5. manifest counts + sha256 verify; tampering is detected', () => {
    const b = goodBackup();
    const m = buildManifest(b.data, { appVersion: '1.0.0' });
    assert.equal(m.counts.transactions, 2);
    assert.equal(m.currency, 'INR');
    assert.match(m.money, /paise/);
    assert.equal(m.integrity.algo, 'sha256');
    assert.equal(verifyManifest(b.data, m).ok, true);
    const tampered = JSON.parse(JSON.stringify(b.data));
    tampered.transactions[0].amount = 99999;
    assert.equal(verifyManifest(tampered, m).ok, false);
  });

  it('5b. manifest survives a JSON round-trip with undefined fields present', () => {
    // Regression: live export objects carry `undefined` (e.g. unset avatar)
    // which the wire format drops. Hash input must equal wire bytes.
    const b = goodBackup();
    b.data.preferences = { theme: 'dark', avatar: undefined, displayName: undefined };
    const clean = JSON.parse(JSON.stringify(b.data));
    const m = buildManifest(clean, { appVersion: '1.0.0' });
    const roundTripped = JSON.parse(JSON.stringify({ ...b, data: clean, manifest: m }));
    assert.equal(verifyManifest(roundTripped.data, roundTripped.manifest).ok, true);
    assert.equal(canonicalStringify({ a: 1, u: undefined }), canonicalStringify({ a: 1 }));
  });

  it('5c. idempotencyKey on transactions is a known field (no false warning)', () => {
    const b = goodBackup();
    b.data.transactions[0].idempotencyKey = 'idem_123';
    const r = validateBackupData(b.data, { ownerId: 'u_test' });
    assert.ok(!r.warnings.some((w) => w.includes('idempotencyKey')), 'no warning for idempotencyKey');
    assert.equal(r.invalid.transactions, 0);
  });

  it('6. canonical form is deterministic regardless of key order', () => {
    assert.equal(canonicalStringify({ b: 1, a: { y: 2, x: 1 } }), canonicalStringify({ a: { x: 1, y: 2 }, b: 1 }));
  });

  it('7. preview diff: merge adds without removing; replace reports removals', () => {
    const live = {
      transactions: [{ id: 'T1', type: 'expense', amountPaise: 10000, status: 'completed' }],
      accounts: [], categories: [], upiIds: [], goals: [], contributions: [],
      recurring: [], autopilotRules: [], autopilotRuns: [], notifications: [], imports: [],
      budgets: { Food: 100 }
    };
    const incoming = {
      transactions: [
        { id: 'T1', type: 'expense', amount: 500, status: 'completed' },
        { id: 'T2', type: 'income', amount: 1000, status: 'completed' }
      ],
      budgets: { Food: 200, Travel: 50 }
    };
    const m = diffPreview(live, incoming, 'merge');
    assert.equal(m.per.transactions.added, 1);
    assert.equal(m.per.transactions.conflictCount, 1);
    assert.equal(m.per.transactions.removed, 0);
    // colliding T1 must not inflate the merge balance projection
    assert.equal(m.balanceEffect.deltaIncomePaise, 100000);
    assert.equal(m.balanceEffect.deltaExpensePaise, 0);
    const r = diffPreview(live, incoming, 'replace');
    assert.equal(r.per.transactions.replaced, 1);
    assert.equal(r.per.transactions.removed, 0);
    assert.deepEqual(r.per.budgets.detail.updated, ['Food']);
    assert.deepEqual(r.per.budgets.detail.added, ['Travel']);
  });

  it('8. oversized backups are capped', () => {
    assert.ok(BACKUP_MAX_BYTES >= 4 * 1024 * 1024, 'byte cap defined');
    const b = goodBackup();
    b.data.transactions = Array.from({ length: BACKUP_MAX_TRANSACTIONS + 1 }, (_, i) => (
      { id: `TX${i}`, date: '2026-09-01', type: 'expense', amount: 1, category: 'Food', account: 'Cash' }
    ));
    assert.ok(!normalizeBackup(b).ok, 'over-limit transaction count rejected');
  });
});

// ── Live API tests (isolated temp users) ──
const BASE = process.env.FINTRACK_TEST_URL;

describe('portability api (needs FINTRACK_TEST_URL)', { skip: !BASE }, () => {
  const stamp = Date.now().toString(36);
  const mkUser = async (tag, password = 'Port12345') => {
    const email = `port_${tag}_${stamp}@example.com`.toLowerCase();
    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: `Port ${tag}` })
    });
    assert.equal(signup.status, 201);
    const { token } = await signup.json();
    return { email, password, h: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
  };
  const call = async (h, path, body, method = 'POST') => {
    const r = await fetch(`${BASE}${path}`, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await r.json(); } catch { /* non-JSON */ }
    return { status: r.status, json };
  };
  const liveTxCount = async (h) => (await (await fetch(`${BASE}/api/transactions`, { headers: h })).json()).transactions.length;
  const seedTxn = (id, amount = 100) => ({
    id, date: '2026-09-10', type: 'expense', amount, category: 'Food',
    account: 'Cash Wallet', merchant: 'Seed', status: 'completed'
  });

  it('9. export includes owned collections and excludes all secrets', async () => {
    const { h } = await mkUser('exp');
    await call(h, '/api/transactions', seedTxn('TXE1'));
    const r = await fetch(`${BASE}/api/portability/backup`, { headers: h });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.format, BACKUP_FORMAT);
    assert.equal(b.version, BACKUP_VERSION);
    assert.ok(b.manifest && b.manifest.integrity.value, 'manifest with integrity hash');
    assert.ok(b.manifest.counts.transactions >= 1, 'transactions exported');
    const raw = JSON.stringify(b).toLowerCase();
    for (const leak of ['"hash"', '"salt"', '"token"', 'securityevents', '"audit"', 'password']) {
      assert.ok(!raw.includes(leak), `export must not contain ${leak}`);
    }
    assert.ok(!('users' in (b.data || {}) || 'sessions' in (b.data || {})), 'no user/session collections');
  });

  it('10. export never includes another user\u2019s records', async () => {
    const a = await mkUser('isoA');
    const b = await mkUser('isoB');
    await call(a.h, '/api/transactions', seedTxn('TXA1', 111));
    await call(b.h, '/api/transactions', seedTxn('TXB1', 222));
    const got = await (await fetch(`${BASE}/api/portability/backup`, { headers: a.h })).json();
    const amounts = got.data.transactions.map((t) => t.amount);
    assert.ok(!amounts.includes(222), 'user B record absent from user A export');
    assert.ok(amounts.includes(111), 'own record present');
  });

  it('11. validate rejects bad format, bad version, bad money; preview is read-only', async () => {
    const { h } = await mkUser('val');
    assert.equal((await call(h, '/api/portability/validate', { backup: { nope: 1 } })).status, 400);
    const vbad = goodBackup(); vbad.version = 999;
    assert.equal((await call(h, '/api/portability/validate', { backup: vbad })).status, 400);
    const mbad = goodBackup(); mbad.data.transactions[0].amount = -5;
    const badRep = await call(h, '/api/portability/validate', { backup: mbad });
    assert.equal(badRep.status, 200);
    assert.equal(badRep.json.valid, false);
    const before = await liveTxCount(h);
    const pv = await call(h, '/api/portability/preview', { backup: goodBackup(), mode: 'merge' });
    assert.equal(pv.status, 200);
    assert.ok(pv.json.diff && pv.json.balanceEffect, 'preview shape');
    assert.equal(await liveTxCount(h), before, 'preview modified nothing');
    const vv = await call(h, '/api/portability/validate', { backup: goodBackup() });
    assert.equal(await liveTxCount(h), before, 'validate modified nothing');
    assert.equal(vv.json.valid, true);
  });

  it('12. merge inserts once, reports conflicts, never overwrites', async () => {
    const { h } = await mkUser('merge');
    const first = await call(h, '/api/portability/restore', { backup: goodBackup(), mode: 'merge' });
    assert.equal(first.status, 200);
    assert.ok(first.json.inserted.transactions >= 2, 'first merge inserts');
    // tamper live copy, then re-merge the same backup: collisions skip
    const list = await (await fetch(`${BASE}/api/transactions`, { headers: h })).json();
    const t1 = list.transactions.find((t) => t.id === 'T1');
    await fetch(`${BASE}/api/transactions/${t1.id}`, {
      method: 'PUT', headers: h,
      body: JSON.stringify({ ...t1, amount: 777 })
    });
    const second = await call(h, '/api/portability/restore', { backup: goodBackup(), mode: 'merge' });
    assert.equal(second.status, 200);
    assert.equal(second.json.inserted.transactions || 0, 0, 'no duplicates on re-merge');
    assert.ok((second.json.conflicts.transactions || []).includes('T1'), 'conflict reported');
    const after = await (await fetch(`${BASE}/api/transactions`, { headers: h })).json();
    assert.equal(after.transactions.find((t) => t.id === 'T1').amount, 777, 'existing record untouched');
  });

  it('13. replace needs password + phrase, stays scoped, keeps security history', async () => {
    const { password, h } = await mkUser('repl');
    const other = await mkUser('replOther');
    // NOTE: the server mints its own ids — capture the created one.
    const created = await call(other.h, '/api/transactions', seedTxn('TXO1', 333));
    assert.equal(created.status, 201);
    const otherTxnId = created.json.transaction.id;
    const evBefore = await (await fetch(`${BASE}/api/security/events?limit=200`, { headers: h })).json();
    // no password → 401, nothing wiped
    assert.equal((await call(h, '/api/portability/restore', { backup: goodBackup(), mode: 'replace', confirmation: RESTORE_REPLACE_PHRASE })).status, 401);
    // wrong phrase → 400, nothing wiped
    assert.equal((await call(h, '/api/portability/restore', { backup: goodBackup(), mode: 'replace', confirmation: 'nope', password })).status, 400);
    const ok = await call(h, '/api/portability/restore', { backup: goodBackup(), mode: 'replace', confirmation: RESTORE_REPLACE_PHRASE, password });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.mode, 'replace');
    // other user untouched
    const oList = await (await fetch(`${BASE}/api/transactions`, { headers: other.h })).json();
    assert.ok(oList.transactions.some((t) => t.id === otherTxnId), 'other user data preserved');
    // security history preserved (only grows via new events, never wiped)
    const evAfter = await (await fetch(`${BASE}/api/security/events?limit=200`, { headers: h })).json();
    assert.ok(evAfter.events.length >= evBefore.events.length, 'security history not wiped');
    // invalid backup aborts replace before any wipe
    const mineBefore = await call(h, '/api/transactions', seedTxn('TXR1', 444));
    assert.equal(mineBefore.status, 201);
    const mineTnxId = mineBefore.json.transaction.id;
    const mbad = goodBackup(); mbad.data.transactions[0].amount = -5;
    assert.equal((await call(h, '/api/portability/restore', { backup: mbad, mode: 'replace', confirmation: RESTORE_REPLACE_PHRASE, password })).status, 400);
    const mine = await (await fetch(`${BASE}/api/transactions`, { headers: h })).json();
    assert.ok(mine.transactions.some((t) => t.id === mineTnxId), 'failed replace left data recoverable');
  });

  it('14. unauthorized callers are blocked everywhere', async () => {
    const anon = { 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${BASE}/api/portability/backup`)).status, 401);
    for (const [path, body] of [
      ['/api/portability/validate', { backup: goodBackup() }],
      ['/api/portability/preview', { backup: goodBackup(), mode: 'merge' }],
      ['/api/portability/restore', { backup: goodBackup(), mode: 'merge' }]
    ]) {
      assert.equal((await call(anon, path, body)).status, 401, `${path} requires auth`);
    }
  });

  it('15. oversized payloads are rejected safely', async () => {
    const { h } = await mkUser('big');
    const big = goodBackup();
    big.data.transactions = Array.from({ length: 60000 }, (_, i) => (
      { id: `BIG${i}`, date: '2026-09-01', type: 'expense', amount: 1, category: 'Food', account: 'Cash', merchant: 'padding-padding-padding' }
    ));
    const r = await call(h, '/api/portability/validate', { backup: big });
    assert.ok([400, 413].includes(r.status), `oversize rejected, got ${r.status}`);
  });
});
