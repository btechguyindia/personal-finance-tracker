import React, { useState } from 'react';
import { api } from '../services/api.js';
import { formatINR } from '../services/finance.js';

export default function GoalsPage({ goals, accounts, transactions, onChanged }) {
  const [form, setForm] = useState({ name: '', target: '', targetDate: '', notes: '', linkedAccount: '', linkedCategory: '' });
  const [contrib, setContrib] = useState({ goalId: '', amount: '', account: '', note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const addGoal = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api.createGoal({ ...form, target: Number(form.target) });
      setForm({ name: '', target: '', targetDate: '', notes: '', linkedAccount: '', linkedCategory: '' });
      onChanged();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const contribute = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api.contributeGoal(contrib.goalId, {
        amount: Number(contrib.amount), account: contrib.account || null,
        note: contrib.note, date: new Date().toISOString().slice(0, 10)
      });
      setContrib({ goalId: '', amount: '', account: '', note: '' });
      onChanged();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const saveLink = async (g, patch) => {
    setError('');
    try { await api.updateGoal(g.id, patch); onChanged(); }
    catch (err) { setError(err.message); }
  };

  const remove = async (id, n) => {
    if (!window.confirm(`Delete goal "${n}" and its contributions?`)) return;
    try { await api.deleteGoal(id); onChanged(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>New savings goal</h3></div>
          <form onSubmit={addGoal} className="form-grid two">
            <label>Goal name<input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="e.g. Emergency fund" /></label>
            <label>Target (₹)<input className="input" type="number" min="1" step="0.01" value={form.target} onChange={(e) => set('target', e.target.value)} required /></label>
            <label>Deadline<input className="input" type="date" value={form.targetDate} onChange={(e) => set('targetDate', e.target.value)} /></label>
            <label>Notes<input className="input" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" /></label>
            <label>Auto-allocate from account<select value={form.linkedAccount} onChange={(e) => set('linkedAccount', e.target.value)}>
              <option value="">Manual only</option>
              {accounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select></label>
            <label>Auto category (optional)<input className="input" value={form.linkedCategory} onChange={(e) => set('linkedCategory', e.target.value)} placeholder="e.g. Investment" /></label>
          </form>
          <p className="muted small">Link an account (e.g. investment wallet) and every completed transfer <b>into</b> it auto-counts toward the goal — plus any ledger row tagged <code>goal:&lt;name&gt;</code>. Manual contributions stack on top.</p>
          <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={addGoal} disabled={busy}>{busy ? 'Saving…' : 'Create goal'}</button></div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Add contribution</h3></div>
          <p className="muted small">Contributions track progress only — they are <b>not</b> counted as new income.</p>
          <form onSubmit={contribute} className="form-grid two">
            <label>Goal<select value={contrib.goalId} onChange={(e) => setContrib({ ...contrib, goalId: e.target.value })} required>
              <option value="">Select…</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select></label>
            <label>Amount (₹)<input className="input" type="number" min="1" step="0.01" value={contrib.amount} onChange={(e) => setContrib({ ...contrib, amount: e.target.value })} required /></label>
            <label>From account<select value={contrib.account} onChange={(e) => setContrib({ ...contrib, account: e.target.value })}>
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select></label>
            <label>Note<input className="input" value={contrib.note} onChange={(e) => setContrib({ ...contrib, note: e.target.value })} placeholder="Optional" /></label>
          </form>
          <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={contribute} disabled={busy}>{busy ? 'Saving…' : 'Add contribution'}</button></div>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card wide">
        <div className="card-head"><h3>Savings goals ({goals.length})</h3></div>
        {goals.length === 0 ? <div className="empty"><span className="big-ico">🎯</span>No goals yet. Create one above — e.g. Emergency fund.</div> : goals.map((g) => {
          const total = g.total ?? g.current ?? 0;
          const pct = g.progressPct ?? (g.target > 0 ? Math.min(100, (total / g.target) * 100) : 0);
          return (
            <div className="card" key={g.id}>
              <div className="card-head">
                <div><b>{g.name}</b>
                  <div className="muted small">
                    {g.targetDate ? `Deadline: ${g.targetDate}${g.daysLeft !== null && g.daysLeft !== undefined ? ` (${g.daysLeft} day${Math.abs(g.daysLeft) === 1 ? '' : 's'}${g.daysLeft < 0 ? ' overdue' : ' left'})` : ''}` : 'No deadline'}
                    {g.requiredPerMonth ? ` · need ≈ ${formatINR(g.requiredPerMonth)}/mo` : ''}
                    {g.notes ? ` · ${g.notes}` : ''}
                  </div>
                </div>
                <button className="btn danger" onClick={() => remove(g.id, g.name)}>Delete</button>
              </div>
              <div className="row"><b style={{ fontSize: 18 }}>{formatINR(total)}</b><span className="muted">of {formatINR(g.target)} · {pct.toFixed(0)}%</span></div>
              <div className="goal-bar" style={{ marginTop: 8 }}><div style={{ width: `${pct}%` }} /></div>
              <div className="muted small" style={{ marginTop: 6 }}>
                Manual {formatINR(g.current || 0)} + auto-allocated {formatINR(g.auto || 0)}{g.autoCount ? ` (${g.autoCount} ledger row${g.autoCount === 1 ? '' : 's'})` : ''} from your ledger.
                {!g.linkedAccount && !g.linkedCategory ? ' Link an account to auto-allocate SIPs/transfers.' : ` Auto-source: ${g.linkedAccount || 'any account'}${g.linkedCategory ? ` · ${g.linkedCategory}` : ''}.`}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <label className="muted small">Auto account
                  <select value={g.linkedAccount || ''} onChange={(e) => saveLink(g, { linkedAccount: e.target.value })}>
                    <option value="">Manual only</option>
                    {accounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                  </select>
                </label>
                <label className="muted small">Auto category
                  <input className="input" value={g.linkedCategory || ''} onChange={(e) => saveLink(g, { linkedCategory: e.target.value })} placeholder="e.g. Investment" style={{ maxWidth: 160 }} />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
