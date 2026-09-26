import React, { useCallback, useEffect, useState } from 'react';
import { api, clearToken } from '../services/api.js';

const KIND_ICON = {
  login: '🔑', login_failed: '⚠️', logout: '⎋', password_changed: '🔒',
  password_reset: '🔒', session_revoked: '🧹', sessions_revoked_others: '🧹',
  deletion_failed: '⛔', data_wiped: '🧨'
};

const fmtLocal = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

export default function SecurityPage({ onLogout }) {
  const [overview, setOverview] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [delStep, setDelStep] = useState(0);
  const [delPw, setDelPw] = useState('');
  const [delPhrase, setDelPhrase] = useState('');

  const refresh = useCallback(async () => {
    const [ov, sess, ev] = await Promise.all([
      api.getSecurityOverview(), api.getSecuritySessions(), api.getSecurityEvents(50)
    ]);
    setOverview(ov); setSessions(sess); setEvents(ev);
  }, []);

  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [refresh]);

  const act = async (fn, okMsg) => {
    setError(''); setNotice(''); setBusy(true);
    try { await fn(); setNotice(okMsg); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const revokeOne = (s) => {
    const msg = s.current
      ? 'Revoke THIS session? You will be signed out immediately.'
      : `Revoke the session "${s.device}"? It will stop working immediately.`;
    if (!window.confirm(msg)) return;
    act(async () => {
      const out = await api.revokeSecuritySession(s.id);
      if (out.revokedCurrent) { clearToken(); onLogout(); }
    }, 'Session revoked.');
  };

  const revokeOthers = () => {
    if (!window.confirm('Sign out all other devices? This session stays signed in.')) return;
    act(async () => {
      const out = await api.revokeOtherSessions();
      setNotice(`Signed out ${out.revoked} other session(s).`);
    }, '');
  };

  const logoutHere = () => {
    if (!window.confirm('Sign out of this device?')) return;
    act(async () => { await api.logout(); clearToken(); onLogout(); }, '');
  };

  const changePassword = (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) { setError('New passwords do not match.'); return; }
    act(async () => {
      const out = await api.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setNotice(`Password changed.${out.otherSessionsRevoked ? ` ${out.otherSessionsRevoked} other device(s) signed out — this one stays signed in.` : ' This device stays signed in.'}`);
    }, '');
  };

  const deleteAccount = (e) => {
    e.preventDefault();
    if (delPhrase !== 'DELETE MY ACCOUNT') { setError('Type DELETE MY ACCOUNT exactly to confirm.'); return; }
    act(async () => {
      await api.deleteAccount(delPw, delPhrase);
      clearToken();
      onLogout(true);
    }, '');
  };

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="success" style={{ marginTop: error ? 10 : 0 }}>{notice}</div>}

      <div className="grid-4">
        <div className="kpi"><div className="k-label">Active sessions</div>
          <div className="k-value">{overview ? overview.sessions : '…'}</div>
          <div className="k-sub">This device highlighted below</div></div>
        <div className="kpi"><div className="k-label">Last sign-in</div>
          <div className="k-value" style={{ fontSize: 17 }}>{overview ? fmtLocal(overview.lastLoginAt) : '…'}</div>
          <div className="k-sub">Local time · UTC stored</div></div>
        <div className="kpi"><div className="k-label">Password updated</div>
          <div className="k-value" style={{ fontSize: 17 }}>{overview ? (overview.passwordUpdatedAt ? fmtLocal(overview.passwordUpdatedAt).split(',')[0] : 'Before tracking') : '…'}</div>
          <div className="k-sub">Other devices sign out on change</div></div>
        <div className="kpi good"><div className="k-label">Current session</div>
          <div className="k-value" style={{ fontSize: 17 }}>{overview ? (overview.currentSession ? 'Valid' : 'Unknown') : '…'}</div>
          <div className="k-sub">7-day expiry · revocable anytime</div></div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>🖥️ Active sessions ({sessions.length})</h3>
            {sessions.length > 1 && <button className="btn" disabled={busy} onClick={revokeOthers}>Revoke all others</button>}
          </div>
          {sessions.length === 0 ? <div className="empty">No sessions — please log in again.</div> :
            sessions.map((s) => (
              <div className="acct-card" key={s.id}>
                <div>
                  <b>{s.device}{s.current ? ' · this device' : ''}</b>
                  <div className="muted small">Since {fmtLocal(s.createdAt)}{s.lastSeenAt ? ` · seen ${fmtLocal(s.lastSeenAt)}` : ''}</div>
                </div>
                <div className="row">
                  {s.current && <span className="pill completed">current</span>}
                  <button className="btn danger" disabled={busy} onClick={() => revokeOne(s)}>Revoke</button>
                </div>
              </div>
            ))}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={busy} onClick={logoutHere}>⎋ Sign out this device</button>
          </div>
          <p className="muted small">Only a coarse device/browser label is stored — never precise identity or location. Raw login tokens are never stored; only verifiers.</p>
        </div>

        <div className="card">
          <div className="card-head"><h3>🕒 Security activity</h3><span className="muted small">newest first</span></div>
          {events.length === 0 ? <div className="empty">No security events yet.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>When</th><th>Event</th><th>Detail</th></tr></thead>
              <tbody>{events.slice(0, 20).map((e) => (
                <tr key={e.id}>
                  <td>{fmtLocal(e.at)}</td>
                  <td>{KIND_ICON[e.kind] || '·'} {e.kind.replaceAll('_', ' ')}</td>
                  <td>{e.detail}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="muted small">Sign-ins, sign-outs, password changes, revocations and failed attempts. Kept to the latest 300 per account. Never contains passwords or tokens.</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>🔒 Change password</h3></div>
          <form onSubmit={changePassword} className="form-grid two">
            <label className="span-2">Current password
              <input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" />
            </label>
            <label>New password
              <input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required autoComplete="new-password" minLength={8} />
            </label>
            <label>Confirm new
              <input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required autoComplete="new-password" />
            </label>
          </form>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={busy} onClick={changePassword}>Update password</button>
          </div>
          <p className="muted small">Minimum 8 characters. All other devices are signed out; this one stays signed in.</p>
        </div>

        <div className="card">
          <div className="card-head"><h3>⛔ Delete account</h3></div>
          {delStep === 0 && (
            <div>
              <p className="muted small">Permanently deletes <b>everything</b> tied to this login: transactions, accounts, budgets, goals, rules, notifications, sessions and history. Your login itself is removed. This cannot be undone. Other users are never affected.</p>
              <button className="btn danger" onClick={() => setDelStep(1)}>Start deletion…</button>
            </div>
          )}
          {delStep === 1 && (
            <form onSubmit={deleteAccount}>
              <p className="muted small">Step 2 of 2 — confirm with your password and the exact phrase below.</p>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)' }}>Account password
                <input className="input" type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)} required autoComplete="current-password" />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>Type <code>DELETE MY ACCOUNT</code>
                <input className="input" value={delPhrase} onChange={(e) => setDelPhrase(e.target.value)} required placeholder="DELETE MY ACCOUNT" />
              </label>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn danger" type="submit" disabled={busy}>{busy ? 'Deleting…' : 'Delete everything, forever'}</button>
                <button className="btn" type="button" onClick={() => { setDelStep(0); setDelPw(''); setDelPhrase(''); setError(''); }}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
