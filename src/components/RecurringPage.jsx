import React, { useState } from 'react';
import { api } from '../services/api.js';
import { formatINR } from '../services/finance.js';

const FREQS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

function isDue(r) {
  if (r.status !== 'active' || r.autoCreate === false) return false;
  const today = new Date().toISOString().slice(0, 10);
  return (r.nextDate || r.startDate) <= today;
}

export default function RecurringPage({ rules, accounts, onChanged }) {
  const [form, setForm] = useState({ name: '', amount: '', type: 'expense', frequency: 'monthly', account: '', category: '', startDate: '', endDate: '', autoCreate: true });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice('');
    try {
      const res = await api.createRecurring({ ...form, amount: Number(form.amount) });
      setForm({ name: '', amount: '', type: 'expense', frequency: 'monthly', account: '', category: '', startDate: '', endDate: '', autoCreate: true });
      if (res?.autoPosted > 0) setNotice(`Rule saved — ${res.autoPosted} due occurrence(s) auto-created as transactions.`);
      onChanged();
    } catch (err) { setError(err.message); }
  };

  const setStatus = async (id, status) => {
    try { await api.setRecurringStatus(id, status); onChanged(); }
    catch (err) { setError(err.message); }
  };

  const toggleAuto = async (r) => {
    try { await api.setRecurringAuto(r.id, r.autoCreate === false); onChanged(); }
    catch (err) { setError(err.message); }
  };

  const runDue = async () => {
    setError(''); setNotice(''); setBusy(true);
    try {
      const res = await api.runRecurringDue();
      setNotice(res.posted > 0 ? `Auto-created ${res.posted} transaction(s) from due schedules.` : 'Nothing due — all schedules are up to date.');
      onChanged();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const postNow = async (id) => {
    setError(''); setNotice('');
    try {
      await api.postRecurringNow(id);
      setNotice('Posted to your ledger as a completed transaction.');
      onChanged();
    } catch (err) { setError(err.message); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this recurring rule? Already-posted transactions stay in your ledger.')) return;
    try { await api.deleteRecurring(id); onChanged(); }
    catch (err) { setError(err.message); }
  };

  const dueCount = rules.filter(isDue).length;

  return (
    <div>
      <div className="card">
        <div className="card-head"><h3>New recurring rule</h3>
          <button className="btn primary" onClick={runDue} disabled={busy}>{busy ? 'Posting…' : `Post due now${dueCount ? ` (${dueCount})` : ''}`}</button>
        </div>
        <p className="muted small">Rent, SIPs and subscriptions <b>auto-create completed transactions</b> on schedule (daily → yearly). Due items post automatically when you open the app; use “Post due now” to catch up, or “Post” on a row to book one immediately. Pause a rule to skip auto-posting.</p>
        <form onSubmit={submit} className="form-grid">
          <label>Name<input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="e.g. House rent / Nifty SIP / Netflix" /></label>
          <label>Amount (₹)<input className="input" type="number" min="1" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} required /></label>
          <label>Type<select value={form.type} onChange={(e) => set('type', e.target.value)}><option value="expense">Expense</option><option value="income">Income</option></select></label>
          <label>Frequency<select value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>{FREQS.map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
          <label>Account<input className="input" value={form.account} onChange={(e) => set('account', e.target.value)} list="rec-acct" />
            <datalist id="rec-acct">{accounts.map((a) => <option key={a.id} value={a.name} />)}</datalist></label>
          <label>Category<input className="input" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Housing" /></label>
          <label>Start date<input className="input" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} required /></label>
          <label>End date (optional)<input className="input" type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} /></label>
          <label className="small-check"><input type="checkbox" checked={form.autoCreate} onChange={(e) => set('autoCreate', e.target.checked)} /> Auto-create transactions on schedule</label>
        </form>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={submit}>Add rule</button></div>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
        {notice && <div className="muted" style={{ marginTop: 10 }}>{notice}</div>}
      </div>
      <div className="card wide">
        <div className="card-head"><h3>Recurring rules ({rules.length}{dueCount ? ` · ${dueCount} due` : ''})</h3></div>
        {rules.length === 0 ? <div className="empty"><span className="big-ico">🔁</span>No recurring rules. Add salary, rent, SIPs, subscriptions…</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Type</th><th>Frequency</th><th>Next auto-post</th><th>Auto</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr></thead>
            <tbody>{rules.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b><div className="muted small">{r.account || ''}{r.category ? ` · ${r.category}` : ''}{r.lastPostedDate ? ` · last posted ${r.lastPostedDate}` : ''}</div></td>
                <td><span className={`pill ${r.type === 'income' ? 'income' : 'expense'}`}>{r.type}</span></td>
                <td>{r.frequency}</td>
                <td>{r.nextDate || r.startDate} {isDue(r) && <span className="pill expense">due</span>}</td>
                <td><button className="btn" onClick={() => toggleAuto(r)} title="Toggle auto-create">{r.autoCreate === false ? 'off' : 'on'}</button></td>
                <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                <td className="num">{formatINR(r.amount)}</td>
                <td><div className="row">
                  <button className="btn" onClick={() => postNow(r.id)}>Post</button>
                  {r.status === 'active'
                    ? <button className="btn" onClick={() => setStatus(r.id, 'paused')}>Pause</button>
                    : <button className="btn" onClick={() => setStatus(r.id, 'active')}>Resume</button>}
                  <button className="btn danger" onClick={() => remove(r.id)}>Delete</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
