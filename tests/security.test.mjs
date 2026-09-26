// Security control room tests. Run with: npm test
// Pure unit tests always run. Live API tests run only when FINTRACK_TEST_URL
// is set against an isolated local server, e.g.
// FINTRACK_TEST_URL=http://localhost:3220 npm test
// (never point destructive deletion tests at production).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SECURITY_EVENT_CAP, capList, coarseDevice } from '../src/services/security.js';

describe('security helpers (pure)', () => {
  it('labels browsers and OSes coarsely, never invents location', () => {
    assert.equal(coarseDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36'), 'Chrome · Windows');
    assert.equal(coarseDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari · iOS');
    assert.equal(coarseDevice('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'), 'Firefox · Linux');
    assert.equal(coarseDevice(''), 'Unknown device');
    assert.equal(coarseDevice(null), 'Unknown device');
    assert.ok(!coarseDevice('anything').toLowerCase().includes('india'));
  });

  it('caps logs to the newest entries', () => {
    const list = Array.from({ length: 305 }, (_, i) => ({ id: i }));
    const capped = capList(list, 300);
    assert.equal(capped.length, 300);
    assert.equal(capped[0].id, 5, 'drops oldest first');
    assert.equal(SECURITY_EVENT_CAP, 300);
    assert.deepEqual(capList(null), []);
  });
});

const BASE = process.env.FINTRACK_TEST_URL;

describe('security api (needs FINTRACK_TEST_URL)', { skip: !BASE }, () => {
  const stamp = Date.now().toString(36);
  const mkUser = async (tag, password = 'Security123') => {
    const email = `sec_${tag}_${stamp}@example.com`.toLowerCase();
    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: `Sec ${tag}` })
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

  it('logins create unique sessions; listings leak no verifiers', async () => {
    const { h } = await mkUser('sess');
    const second = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `sec_sess_${stamp}@example.com`.toLowerCase(), password: 'Security123' })
    });
    assert.equal(second.status, 200);
    const sessions = await (await fetch(`${BASE}/api/security/sessions`, { headers: h })).json();
    assert.equal(sessions.sessions.length, 2);
    assert.equal(sessions.sessions.filter((s) => s.current).length, 1);
    const raw = JSON.stringify(sessions);
    assert.ok(!raw.includes('tokenHash'), 'no verifiers listed');
    assert.ok(!raw.match(/[0-9a-f]{64}/), 'no raw tokens listed');
  });

  it('revoking one session kills only that session; others survive', async () => {
    const { h, email, password } = await mkUser('revoke');
    const t2 = await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })).json();
    const h2 = { 'Content-Type': 'application/json', Authorization: `Bearer ${t2.token}` };
    const sessions = await (await fetch(`${BASE}/api/security/sessions`, { headers: h })).json();
    const other = sessions.sessions.find((s) => !s.current);
    assert.ok(other, 'a second session exists');
    assert.equal((await call(h, `/api/security/sessions/${other.id}/revoke`)).status, 200);
    assert.equal((await fetch(`${BASE}/api/auth/me`, { headers: h2 })).status, 401, 'revoked is dead');
    assert.equal((await fetch(`${BASE}/api/auth/me`, { headers: h })).status, 200, 'survivor lives');
    const gone = await call(h, `/api/security/sessions/${other.id}/revoke`);
    assert.equal(gone.status, 404, 'unknown ids 404 without leaking');
  });

  it('revoke-others preserves the current session', async () => {
    const { h, email, password } = await mkUser('others');
    const t2 = await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })).json();
    const h2 = { 'Content-Type': 'application/json', Authorization: `Bearer ${t2.token}` };
    const out = await call(h, '/api/security/sessions/revoke-others');
    assert.equal(out.status, 200);
    assert.equal(out.json.revoked, 1);
    assert.equal((await fetch(`${BASE}/api/auth/me`, { headers: h })).status, 200);
    assert.equal((await fetch(`${BASE}/api/auth/me`, { headers: h2 })).status, 401);
  });

  it('a user cannot touch another user’s sessions', async () => {
    const a = await mkUser('isoA');
    const b = await mkUser('isoB');
    const sa = await (await fetch(`${BASE}/api/security/sessions`, { headers: a.h })).json();
    const target = sa.sessions[0].id;
    assert.equal((await call(b.h, `/api/security/sessions/${target}/revoke`)).status, 404);
    const sb = await (await fetch(`${BASE}/api/security/sessions`, { headers: b.h })).json();
    assert.ok(!sb.sessions.some((s) => s.id === target), 'ids never cross users');
  });

  it('logins and failures are recorded without secrets', async () => {
    const { h, email } = await mkUser('events');
    await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong-pass-1' })
    });
    const ev = await (await fetch(`${BASE}/api/security/events?limit=50`, { headers: h })).json();
    const kinds = ev.events.map((e) => e.kind);
    assert.ok(kinds.includes('login'), 'signup+login recorded');
    assert.ok(kinds.includes('login_failed'), 'failure recorded');
    const raw = JSON.stringify(ev);
    assert.ok(!raw.includes('wrong-pass-1'), 'attempted password never stored');
    assert.ok(!raw.includes('tokenHash'), 'no verifiers in events');
    const other = await mkUser('eventsB');
    const evB = await (await fetch(`${BASE}/api/security/events?limit=50`, { headers: other.h })).json();
    // strict isolation: B must not see A's event rows
    const aIds = new Set(ev.events.map((e) => e.id));
    assert.ok(!evB.events.some((e) => aIds.has(e.id)), 'no cross-user rows');
  });

  it('password change needs the right current password, revokes others, hashes only', async () => {
    const { h, email, password } = await mkUser('pw');
    const t2 = await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })).json();
    const h2 = { 'Content-Type': 'application/json', Authorization: `Bearer ${t2.token}` };
    assert.equal((await call(h, '/api/auth/change-password', { current: 'nope-nope', next: 'NewPass456' })).status, 401);
    const ok = await call(h, '/api/auth/change-password', { current: password, next: 'NewPass456' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.otherSessionsRevoked, 1);
    assert.equal((await fetch(`${BASE}/api/auth/me`, { headers: h })).status, 200, 'current survives');
    assert.equal((await fetch(`${BASE}/api/auth/me`, { headers: h2 })).status, 401, 'other revoked');
    const relog = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'NewPass456' })
    });
    assert.equal(relog.status, 200, 'new password works');
    const ov = await (await fetch(`${BASE}/api/security/overview`, { headers: h })).json();
    assert.ok(ov.passwordUpdatedAt, 'password update timestamp tracked');
  });

  it('deletion needs phrase + password, wipes only that user, repeats safely', async () => {
    const a = await mkUser('delA');
    const b = await mkUser('delB');
    // B owns data that must survive
    await call(b.h, '/api/transactions', {
      date: '2026-09-10', type: 'expense', amount: 50, category: 'Food',
      account: 'Cash Wallet', status: 'completed'
    });
    await call(a.h, '/api/transactions', {
      date: '2026-09-10', type: 'expense', amount: 60, category: 'Food',
      account: 'Cash Wallet', status: 'completed'
    });
    assert.equal((await call(a.h, '/api/security/delete-account', { password: a.password, confirmation: 'nope' })).status, 400);
    assert.equal((await call(a.h, '/api/security/delete-account', { password: 'wrong', confirmation: 'DELETE MY ACCOUNT' })).status, 401);
    // failed attempts are still logged while the account exists
    const evBefore = await (await fetch(`${BASE}/api/security/events?limit=50`, { headers: a.h })).json();
    assert.ok(evBefore.events.some((e) => e.kind === 'deletion_failed'), 'failed deletion logged');
    const done = await call(a.h, '/api/security/delete-account', { password: a.password, confirmation: 'DELETE MY ACCOUNT' });
    assert.equal(done.status, 200);
    assert.deepEqual(Object.keys(done.json), ['ok'], 'no data leaked in response');
    assert.equal((await fetch(`${BASE}/api/auth/me`, { headers: a.h })).status, 401, 'sessions dead');
    assert.equal((await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: a.email, password: a.password })
    })).status, 401, 'account gone');
    const bList = await (await fetch(`${BASE}/api/transactions`, { headers: b.h })).json();
    assert.equal(bList.transactions.length, 1, 'other user untouched');
    assert.equal(bList.transactions[0].amount, 50);
    // repeat with the dead token behaves safely
    assert.equal((await call(a.h, '/api/security/delete-account', { password: a.password, confirmation: 'DELETE MY ACCOUNT' })).status, 401);
  });
});
