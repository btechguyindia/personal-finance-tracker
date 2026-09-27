// Database Reliability tests — Milestone 2 (concurrency + recovery).
// Unit tests always run: optimistic-concurrency CAS semantics are verified
// against a faithful in-memory double of the Postgres conditional write
// (same compare-and-swap contract as lib/neon.js saveDoc).
// Live API tests run only when FINTRACK_TEST_URL is set, using freshly
// signed-up TEMP users against an ISOLATED server — never production.
//   FINTRACK_TEST_URL=http://localhost:3220 npm test
//
// DISCLOSED GAP: no live-Neon concurrency test exists here (no isolated
// Neon test database is configured). Cross-instance conflict behavior is
// covered by the CAS unit tests + the guarded 409 path; production is
// verified via /api/storage/status version checks after deploy.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadDoc, saveDoc, VersionConflictError } from '../lib/neon.js';

// Faithful double of the three statements lib/neon.js issues, with true
// atomic compare-and-swap on the UPDATE (as Postgres guarantees). saveDoc
// passes (payload, STORE_KEY, expectedVersion), so values[2] is the version.
function makePgDouble() {
  let row = null;
  const db = async (strings, ...values) => {
    const sql = strings.join('?');
    if (sql.startsWith('CREATE TABLE') || sql.startsWith('ALTER TABLE')) return [];
    if (sql.startsWith('SELECT data')) {
      return row ? [{ data: row.data, version: row.version, updated_at: row.updatedAt }] : [];
    }
    if (sql.startsWith('INSERT INTO')) {
      if (!row) row = { data: values[1], version: 1, updatedAt: new Date().toISOString() };
      return [];
    }
    if (sql.startsWith('UPDATE')) {
      if (row && row.version === values[2]) {
        row = { data: values[0], version: row.version + 1, updatedAt: new Date().toISOString() };
        return [{ version: row.version }];
      }
      return [];
    }
    if (sql.startsWith('SELECT version')) {
      return row ? [{ version: row.version }] : [];
    }
    throw new Error(`unexpected SQL in double: ${sql.slice(0, 60)}`);
  };
  db._peek = () => row;
  return db;
}
const tick = () => new Promise((r) => setImmediate(r));

describe('optimistic concurrency (unit, PG double)', () => {
  it('1. first load creates v1; sequential saves bump the version', async () => {
    const db = makePgDouble();
    const first = await loadDoc(() => ({ n: 0 }), db);
    assert.equal(first.version, 1);
    const s2 = await saveDoc({ n: 1 }, first.version, db);
    assert.equal(s2.version, 2);
    const s3 = await saveDoc({ n: 2 }, s2.version, db);
    assert.equal(s3.version, 3);
    assert.equal((await loadDoc(() => ({}), db)).data.n, 2);
  });

  it('2. two overlapping writers: one wins, one gets VERSION_CONFLICT, no silent overwrite', async () => {
    const db = makePgDouble();
    const base = await loadDoc(() => ({ txns: [] }), db); // both read v1
    const writerA = (async () => { await tick(); return saveDoc({ txns: ['A'] }, base.version, db); })();
    const writerB = (async () => { await tick(); await tick(); return saveDoc({ txns: ['B'] }, base.version, db); })();
    const results = await Promise.allSettled([writerA, writerB]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    assert.equal(lost[0].reason.code, 'VERSION_CONFLICT');
    assert.ok(lost[0].reason instanceof VersionConflictError);
    // loser's data is NOT in the store
    const cur = await loadDoc(() => ({}), db);
    assert.equal(cur.data.txns.length, 1, 'exactly one writer survived');
    assert.ok(cur.data.txns[0] === 'A' || cur.data.txns[0] === 'B', 'survivor is a real write');
    assert.equal(cur.version, 2, 'version bumped exactly once');
  });

  it('3. retry-after-refresh succeeds and preserves both writers\u2019 intent when re-applied', async () => {
    const db = makePgDouble();
    const v1 = (await loadDoc(() => ({ log: [] }), db)).version;
    await saveDoc({ log: ['A'] }, v1, db);
    await assert.rejects(saveDoc({ log: ['B'] }, v1, db), /changed since you read it/);
    const fresh = await loadDoc(() => ({}), db);
    const merged = await saveDoc({ log: [...fresh.data.log, 'B'] }, fresh.version, db);
    assert.equal(merged.version, 3);
    assert.deepEqual((await loadDoc(() => ({}), db)).data.log, ['A', 'B']);
  });

  it('4. conflict error carries the current version for diagnostics (no payloads)', async () => {
    const db = makePgDouble();
    const v1 = (await loadDoc(() => ({}), db)).version;
    await saveDoc({ x: 1 }, v1, db);
    await saveDoc({ x: 2 }, 2, db);
    const err = await saveDoc({ x: 3 }, v1, db).then(() => null, (e) => e);
    assert.equal(err.code, 'VERSION_CONFLICT');
    assert.equal(err.currentVersion, 3);
    assert.ok(!JSON.stringify(err).includes('x'), 'no data in the error');
  });
});

// ── Live API tests (isolated temp users) ──
const BASE = process.env.FINTRACK_TEST_URL;

describe('reliability api (needs FINTRACK_TEST_URL)', { skip: !BASE }, () => {
  const stamp = Date.now().toString(36);
  const mkUser = async (tag, password = 'Rel12345') => {
    const email = `rel_${tag}_${stamp}@example.com`.toLowerCase();
    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: `Rel ${tag}` })
    });
    assert.equal(signup.status, 201);
    const { token } = await signup.json();
    return { h: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
  };
  const tx = (i, extra = {}) => ({
    date: '2026-09-10', type: 'expense', amount: 10 + i, category: 'Food',
    account: 'Cash Wallet', merchant: `Rel${i}`, status: 'completed', ...extra
  });

  it('5. twenty concurrent creates all persist with unique ids (no lost update)', async () => {
    const { h } = await mkUser('conc');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        fetch(`${BASE}/api/transactions`, { method: 'POST', headers: h, body: JSON.stringify(tx(i)) })
          .then(async (r) => ({ status: r.status, json: await r.json() })))
    );
    assert.ok(results.every((r) => r.status === 201), 'all 20 created');
    const ids = results.map((r) => r.json.transaction.id);
    assert.equal(new Set(ids).size, 20, 'unique ids');
    const list = await (await fetch(`${BASE}/api/transactions`, { headers: h })).json();
    assert.ok(list.transactions.length >= 20, 'all 20 persisted');
  });

  it('6. concurrent writes to different collections all persist', async () => {
    const { h } = await mkUser('mix');
    const [t, b, g] = await Promise.all([
      fetch(`${BASE}/api/transactions`, { method: 'POST', headers: h, body: JSON.stringify(tx(1)) }).then((r) => r.status),
      fetch(`${BASE}/api/budgets`, { method: 'PUT', headers: h, body: JSON.stringify({ budgets: { Food: 777 } }) }).then((r) => r.status),
      fetch(`${BASE}/api/goals`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'RG', target: 1000 }) }).then((r) => r.status)
    ]);
    assert.deepEqual([t, b, g], [201, 200, 201]);
    const budgets = await (await fetch(`${BASE}/api/budgets`, { headers: h })).json();
    assert.equal(budgets.budgets.Food, 777);
  });

  it('7. idempotent replay returns the original instead of duplicating', async () => {
    const { h } = await mkUser('idem');
    const body = { ...tx(1), idempotencyKey: `idem_${stamp}` };
    const first = await (await fetch(`${BASE}/api/transactions`, { method: 'POST', headers: h, body: JSON.stringify(body) })).json();
    const second = await (await fetch(`${BASE}/api/transactions`, { method: 'POST', headers: h, body: JSON.stringify(body) })).json();
    assert.equal(second.transaction.id, first.transaction.id, 'same record');
    assert.equal(second.idempotentReplay, true);
    const list = await (await fetch(`${BASE}/api/transactions`, { headers: h })).json();
    assert.equal(list.transactions.filter((t) => t.idempotencyKey === `idem_${stamp}`).length, 1, 'exactly one row');
  });

  it('8. concurrent import confirms with one key import rows exactly once', async () => {
    const { h } = await mkUser('impconc');
    const rows = [tx(1), tx(2)].map((r) => ({ ...r }));
    const key = `impkey_${stamp}`;
    const [a, b] = await Promise.all([0, 1].map(() =>
      fetch(`${BASE}/api/import/confirm`, {
        method: 'POST', headers: h, body: JSON.stringify({ rows, key })
      }).then((r) => r.json())));
    assert.equal((a.imported || 0) + (b.imported || 0), 2, 'rows imported exactly once across both calls');
    assert.ok((a.deduped || b.deduped) === true, 'loser got the deduped answer');
  });

  it('9. racing update + delete settles exactly once with no hang or duplicate', async () => {
    const { h } = await mkUser('race');
    const created = await (await fetch(`${BASE}/api/transactions`, { method: 'POST', headers: h, body: JSON.stringify(tx(1)) })).json();
    const id = created.transaction.id;
    const [u, d] = await Promise.all([
      fetch(`${BASE}/api/transactions/${id}`, { method: 'PUT', headers: h, body: JSON.stringify({ ...tx(1), amount: 999 }) }).then((r) => r.status),
      fetch(`${BASE}/api/transactions/${id}`, { method: 'DELETE', headers: h }).then((r) => r.status)
    ]);
    assert.ok(new Set([u, d]).size === 2 && [u, d].every((s) => [200, 404].includes(s)), `one wins one 404s, got ${u}/${d}`);
    const list = await (await fetch(`${BASE}/api/transactions`, { headers: h })).json();
    assert.ok(list.transactions.filter((t) => t.id === id).length <= 1, 'no duplication');
  });

  it('10. storage status reports store, version and per-user counts', async () => {
    const { h } = await mkUser('stor');
    await fetch(`${BASE}/api/transactions`, { method: 'POST', headers: h, body: JSON.stringify(tx(1)) });
    const st = await (await fetch(`${BASE}/api/storage/status`, { headers: h })).json();
    assert.equal(typeof st.neon, 'boolean');
    assert.ok(st.counts && st.counts.transactions >= 1, 'counts present');
    assert.equal((await fetch(`${BASE}/api/storage/status`)).status, 401, 'auth required');
  });
});
