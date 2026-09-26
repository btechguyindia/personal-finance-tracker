import React, { useState } from 'react';
import { api, getTheme, setTheme } from '../services/api.js';

export default function SettingsPage({ user, preferences, onPrefsChanged, onTheme, onWipe }) {
  const [name, setName] = useState(user?.name || '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [theme, setThemeState] = useState(getTheme());

  const prefs = preferences || {};
  const setPref = async (patch) => {
    setError(''); setMsg('');
    try {
      const saved = await api.savePreferences(patch);
      onPrefsChanged(saved);
      setMsg('Preferences saved.');
    } catch (err) { setError(err.message); }
  };

  const changeTheme = (t) => {
    setThemeState(t);
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    onTheme(t);
    setPref({ theme: t });
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setError(''); setMsg('');
    if (pw.next !== pw.confirm) { setError('New passwords do not match.'); return; }
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setMsg('Password changed.');
    } catch (err) { setError(err.message); }
  };

  const exportData = async () => {
    setError(''); setMsg('');
    try {
      const data = await api.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fintrack-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg('Backup downloaded.');
    } catch (err) { setError(err.message); }
  };

  const wipe = async () => {
    if (!window.confirm('Delete ALL your transactions, accounts, budgets, goals and rules? This cannot be undone.')) return;
    if (!window.confirm('Really wipe everything and start fresh?')) return;
    try { await onWipe(); setMsg('All data wiped. Fresh start.'); }
    catch (err) { setError(err.message); }
  };

  return (
    <div>
      {msg && <div className="success">{msg}</div>}
      {error && <div className="error">{error}</div>}
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Profile</h3></div>
          <p><b>{user?.name}</b></p>
          <p className="muted small">{user?.email}</p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)' }}>Display name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={user?.name} disabled title="Name changes coming soon" />
          </label>
        </div>
        <div className="card">
          <div className="card-head"><h3>Appearance</h3></div>
          <div className="seg">
            <button className={theme === 'light' ? 'on' : ''} onClick={() => changeTheme('light')}>☀️ Light</button>
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => changeTheme('dark')}>🌙 Dark</button>
          </div>
          <p className="muted small">Theme is saved to your preferences and this device.</p>
        </div>
        <div className="card">
          <div className="card-head"><h3>Regional</h3></div>
          <div className="form-grid two">
            <label>Currency<input className="input" value={prefs.currency || 'INR'} onChange={(e) => setPref({ currency: e.target.value })} /></label>
            <label>Timezone<input className="input" value={prefs.timezone || 'Asia/Kolkata'} onChange={(e) => setPref({ timezone: e.target.value })} /></label>
            <label>FY starts (month)<select value={prefs.fyStartMonth || 4} onChange={(e) => setPref({ fyStartMonth: Number(e.target.value) })}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}
            </select></label>
          </div>
          <p className="muted small">April (4) = Indian financial year Apr–Mar, used by the Analytics FY preset.</p>
        </div>
        <div className="card">
          <div className="card-head"><h3>Change password</h3></div>
          <form onSubmit={changePassword} className="form-grid two">
            <label className="span-2" style={{ gridColumn: 'span 2' }}>Current password<input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" /></label>
            <label>New password<input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required autoComplete="new-password" /></label>
            <label>Confirm new<input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required autoComplete="new-password" /></label>
          </form>
          <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={changePassword}>Update password</button></div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Backup &amp; privacy</h3></div>
          <p className="muted small">Download everything (transactions, accounts, budgets, goals, rules) as JSON. Store it somewhere safe.</p>
          <div className="row"><button className="btn" onClick={exportData}>⬇ Download backup</button></div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Danger zone</h3></div>
          <p className="muted small">Wipe all financial data and start fresh. Your login is kept.</p>
          <div className="row"><button className="btn danger" onClick={wipe}>Wipe all my data</button></div>
        </div>
      </div>
    </div>
  );
}
