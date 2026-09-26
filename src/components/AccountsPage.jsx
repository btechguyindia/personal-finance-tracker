import React, { useState } from 'react';
import { api } from '../services/api.js';
import { formatINR } from '../services/finance.js';

const TYPES = [
  { v: 'cash', label: '💵 Cash wallet' },
  { v: 'savings', label: '🏦 Savings account' },
  { v: 'current', label: '🏢 Current account' },
  { v: 'upi', label: '📱 UPI-linked account' },
  { v: 'credit_card', label: '💳 Credit card' },
  { v: 'wallet', label: '👛 Prepaid wallet' },
  { v: 'investment', label: '📈 Investment account' },
  { v: 'other', label: '📦 Other' }
];

export default function AccountsPage({ accounts, onChanged }) {
  const [form, setForm] = useState({ name: '', type: 'savings', institution: '', openingBalance: '', status: 'active' });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const reset = () => { setEditing(null); setForm({ name: '', type: 'savings', institution: '', openingBalance: '', status: 'active' }); setError(''); };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const payload = { ...form, openingBalance: Number(form.openingBalance) || 0 };
      if (editing) await api.updateAccount(editing, payload);
      else await api.createAccount(payload);
      reset(); onChanged();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const startEdit = (a) => {
    setEditing(a.id);
    setForm({ name: a.name, type: a.type, institution: a.institution || '', openingBalance: String(a.openingBalance || 0), status: a.status || 'active' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (a) => {
    if (!window.confirm(`Delete account "${a.name}"? Only accounts with no transactions can be deleted.`)) return;
    try { await api.deleteAccount(a.id); onChanged(); }
    catch (err) { setError(err.message); }
  };

  const totalAssets = accounts.filter((a) => !a.isLiability).reduce((s, a) => s + (a.balance || 0), 0);
  const totalDebt = accounts.filter((a) => a.isLiability).reduce((s, a) => s + (a.balance || 0), 0);

  return (
    <div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi good"><div className="k-label">Total assets</div><div className="k-value">{formatINR(totalAssets)}</div><div className="k-sub">Across {accounts.filter((a) => !a.isLiability).length} accounts</div></div>
        <div className="kpi bad"><div className="k-label">Credit card debt</div><div className="k-value">{formatINR(totalDebt)}</div><div className="k-sub">Outstanding liability</div></div>
        <div className="kpi"><div className="k-label">Net worth</div><div className="k-value">{formatINR(totalAssets - totalDebt)}</div><div className="k-sub">Assets − liabilities</div></div>
        <div className="kpi"><div className="k-label">Accounts</div><div className="k-value">{accounts.length}</div><div className="k-sub">Balances from ledger + opening</div></div>
      </div>

      <div className="card">
        <div className="card-head"><h3>{editing ? 'Edit account' : 'Add account'}</h3></div>
        <form onSubmit={submit} className="form-grid">
          <label>Account name<input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="e.g. HDFC Savings" /></label>
          <label>Type<select value={form.type} onChange={(e) => set('type', e.target.value)}>{TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</select></label>
          <label>Institution (optional)<input className="input" value={form.institution} onChange={(e) => set('institution', e.target.value)} placeholder="e.g. HDFC Bank" /></label>
          <label>Opening balance (₹)<input className="input" type="number" step="0.01" value={form.openingBalance} onChange={(e) => set('openingBalance', e.target.value)} placeholder="0" /></label>
          <label>Status<select value={form.status} onChange={(e) => set('status', e.target.value)}><option value="active">Active</option><option value="archived">Archived</option></select></label>
          <div className="row span-3">
            <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add account'}</button>
            {editing && <button type="button" className="btn" onClick={reset}>Cancel</button>}
          </div>
          {error && <div className="error span-3">{error}</div>}
        </form>
        <p className="muted small">Balance = opening + money received − money paid (completed transactions). Renaming an account moves its history with it. Opening balances are never silently changed.</p>
      </div>

      <div className="card wide">
        <div className="card-head"><h3>All accounts ({accounts.length})</h3></div>
        {accounts.length === 0 ? <div className="empty">No accounts yet.</div> : accounts.map((a) => (
          <div className="acct-card" key={a.id}>
            <div className="row">
              <span className="acct-ico">{a.type === 'cash' ? '💵' : a.type === 'credit_card' ? '💳' : a.type === 'investment' ? '📈' : a.type === 'upi' ? '📱' : a.type === 'wallet' ? '👛' : '🏦'}</span>
              <div>
                <b>{a.name}</b> <span className={`pill ${a.status}`}>{a.status}</span>{' '}
                {a.isLiability && <span className="pill transfer">liability</span>}
                <div className="muted small">{a.type.replace('_', ' ')}{a.institution ? ` · ${a.institution}` : ''} · Opening {formatINR(a.openingBalance)}</div>
              </div>
            </div>
            <div className="row">
              <b className="num" style={{ fontSize: 17 }}>{formatINR(a.balance)}</b>
              <button className="btn" onClick={() => startEdit(a)}>Edit</button>
              <button className="btn danger" onClick={() => remove(a)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
