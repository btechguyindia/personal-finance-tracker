import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { formatINR } from '../services/finance.js';
import { AUTOPILOT_TRIGGERS } from '../services/autopilotEngine.js';

const TRIGGER_LABELS = {
  transaction_added: 'Transaction added',
  salary_detected: 'Salary detected',
  budget_threshold: 'Budget threshold crossed',
  recurring_approaching: 'Recurring payment approaching',
  unusual_transaction: 'Unusual transaction flagged',
  month_closed: 'Month closed'
};

const FIELD_OPTIONS = {
  transaction_added: ['amount', 'category', 'type', 'account', 'merchant'],
  salary_detected: ['amount', 'category', 'type', 'account', 'merchant'],
  unusual_transaction: ['amount', 'category', 'type', 'account', 'merchant'],
  recurring_approaching: ['amount', 'category', 'type', 'account', 'merchant'],
  budget_threshold: ['category', 'spent', 'pct'],
  month_closed: ['income', 'spent', 'net', 'savings_rate']
};

const OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'in', 'contains'];
const OP_LABELS = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠', in: 'is one of', contains: 'contains' };

const emptyRule = () => ({
  name: '', trigger: 'transaction_added',
  conditions: [{ field: 'amount', op: 'gt', value: '5000' }],
  actions: [{ kind: 'notify', message: '' }],
  requireApproval: false, params: {}
});

function ConditionRow({ c, fields, onChange, onRemove }) {
  return (
    <div className="row">
      <select value={c.field} onChange={(e) => onChange({ ...c, field: e.target.value })}>
        {fields.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value })}>
        {OPS.map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
      </select>
      <input className="input" value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })}
        placeholder={c.op === 'in' ? 'comma, separated, values' : 'value'} style={{ flex: 1, minWidth: 0 }} />
      <button type="button" className="btn" onClick={onRemove}>✕</button>
    </div>
  );
}

function ActionRow({ a, onChange, onRemove }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row">
        <select value={a.kind} onChange={(e) => onChange({ ...a, kind: e.target.value })}>
          <option value="notify">🔔 Notify me</option>
          <option value="suggest">💡 Suggest</option>
          <option value="create_draft">📝 Prepare draft</option>
        </select>
        <button type="button" className="btn" onClick={onRemove}>✕</button>
      </div>
      {(a.kind === 'notify' || a.kind === 'suggest') && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Message
          <input className="input" value={a.message || ''} onChange={(e) => onChange({ ...a, message: e.target.value })}
            placeholder={a.kind === 'suggest' ? 'e.g. Move this to Investments?' : 'e.g. Large expense recorded'} maxLength={500} />
        </label>
      )}
      {a.kind === 'suggest' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Suggested category (optional)
          <input className="input" value={a.category || ''} onChange={(e) => onChange({ ...a, category: e.target.value })} placeholder="e.g. Investment" />
        </label>
      )}
      {a.kind === 'create_draft' && (
        <div className="form-grid two" style={{ marginTop: 8 }}>
          <label>Type<select value={a.txType || 'expense'} onChange={(e) => onChange({ ...a, txType: e.target.value })}>
            <option value="expense">Expense</option><option value="income">Income</option>
          </select></label>
          <label>Category<input className="input" value={a.category || ''} onChange={(e) => onChange({ ...a, category: e.target.value })} placeholder="e.g. Investment" /></label>
          <label>Account<input className="input" value={a.account || ''} onChange={(e) => onChange({ ...a, account: e.target.value })} placeholder="e.g. HDFC Savings" /></label>
          <label>Note<input className="input" value={a.note || ''} onChange={(e) => onChange({ ...a, note: e.target.value })} placeholder="Optional" /></label>
        </div>
      )}
      {a.kind === 'create_draft' && (
        <p className="muted small" style={{ margin: '8px 0 0' }}>Draft uses the triggering transaction's amount and is saved as <b>scheduled</b> — it never moves money until you complete it.</p>
      )}
    </div>
  );
}

export default function AutopilotPage() {
  const [rules, setRules] = useState([]);
  const [runs, setRuns] = useState([]);
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [form, setForm] = useState(emptyRule());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('rules');

  const refresh = useCallback(async () => {
    const [r, rn, n] = await Promise.all([
      api.getAutopilotRules(), api.getAutopilotRuns(50), api.getNotifications()
    ]);
    setRules(r); setRuns(rn); setNotifs(n.notifications); setUnread(n.unread);
  }, []);

  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [refresh]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        conditions: form.conditions.map((c) => ({
          ...c,
          value: c.op === 'in'
            ? String(c.value).split(',').map((s) => s.trim()).filter(Boolean)
            : (['amount', 'spent', 'pct', 'income', 'net', 'savings_rate'].includes(c.field) ? Number(c.value) : String(c.value).trim())
        })),
        params: form.trigger === 'budget_threshold'
          ? { thresholdPct: Number(form.params?.thresholdPct) || 80 }
          : form.trigger === 'recurring_approaching'
            ? { daysBefore: Number(form.params?.daysBefore) || 3 }
            : {}
      };
      await api.createAutopilotRule(payload);
      setForm(emptyRule());
      setNotice('Rule created and active.');
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const toggle = async (r) => {
    try { await api.updateAutopilotRule(r.id, { status: r.status === 'active' ? 'paused' : 'active' }); await refresh(); }
    catch (err) { setError(err.message); }
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete rule "${r.name}"? Past runs stay in the log.`)) return;
    try { await api.deleteAutopilotRule(r.id); await refresh(); }
    catch (err) { setError(err.message); }
  };

  const runChecks = async (trigger) => {
    setError(''); setNotice(''); setBusy(true);
    try {
      const out = await api.evaluateAutopilot(trigger);
      setNotice(`${TRIGGER_LABELS[trigger]}: evaluated ${out.evaluated}, fired ${out.fired}.`);
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const markRead = async (n) => {
    try { await api.markNotificationRead(n.id); await refresh(); }
    catch (err) { setError(err.message); }
  };

  const approve = async (n) => {
    if (!window.confirm('Add this draft as a scheduled transaction? It will NOT move money until completed.')) return;
    try {
      await api.approveDraft(n.id);
      setNotice('Draft approved — find it in Transactions (scheduled).');
      await refresh();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="success" style={{ marginTop: error ? 10 : 0 }}>{notice}</div>}
      <div className="card">
        <div className="row">
          {['rules', 'inbox', 'runs'].map((t) => (
            <button key={t} className={`btn${tab === t ? ' primary' : ''}`} onClick={() => setTab(t)}>
              {t === 'rules' ? `Rules (${rules.length})` : t === 'inbox' ? `Inbox${unread ? ` (${unread} new)` : ''}` : `Run log (${runs.length})`}
            </button>
          ))}
          <span className="muted small" style={{ marginLeft: 'auto' }}>Rules suggest &amp; draft — they never move money.</span>
        </div>
      </div>

      {tab === 'rules' && (
        <div>
          <div className="card wide">
            <div className="card-head"><h3>✈️ New autopilot rule</h3></div>
            <form onSubmit={submit}>
              <div className="form-grid two">
                <label>Rule name<input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} placeholder="e.g. Flag big spends" /></label>
                <label>Trigger<select value={form.trigger} onChange={(e) => setForm({ ...emptyRule(), name: form.name, trigger: e.target.value })}>
                  {AUTOPILOT_TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}
                </select></label>
              </div>
              {form.trigger === 'budget_threshold' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>Fire when spend reaches (% of budget)
                  <input className="input" type="number" min="1" max="1000" value={form.params?.thresholdPct || 80}
                    onChange={(e) => set('params', { thresholdPct: Number(e.target.value) })} style={{ maxWidth: 160 }} />
                </label>
              )}
              {form.trigger === 'recurring_approaching' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>Warn when due within (days)
                  <input className="input" type="number" min="1" max="30" value={form.params?.daysBefore || 3}
                    onChange={(e) => set('params', { daysBefore: Number(e.target.value) })} style={{ maxWidth: 160 }} />
                </label>
              )}
              <h4>Conditions (all must match — empty = always fires)</h4>
              {form.conditions.map((c, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <ConditionRow c={c} fields={FIELD_OPTIONS[form.trigger]}
                    onChange={(nc) => set('conditions', form.conditions.map((x, j) => (j === i ? nc : x)))}
                    onRemove={() => set('conditions', form.conditions.filter((_, j) => j !== i))} />
                </div>
              ))}
              <div className="row" style={{ marginBottom: 8 }}>
                <button type="button" className="btn" disabled={form.conditions.length >= 10}
                  onClick={() => set('conditions', [...form.conditions, { field: FIELD_OPTIONS[form.trigger][0], op: 'gt', value: '' }])}>
                  + Add condition
                </button>
              </div>
              <h4>Actions</h4>
              {form.actions.map((a, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <ActionRow a={a}
                    onChange={(na) => set('actions', form.actions.map((x, j) => (j === i ? na : x)))}
                    onRemove={() => set('actions', form.actions.filter((_, j) => j !== i))} />
                </div>
              ))}
              <div className="row" style={{ marginBottom: 8 }}>
                <button type="button" className="btn" disabled={form.actions.length >= 5}
                  onClick={() => set('actions', [...form.actions, { kind: 'notify', message: '' }])}>
                  + Add action
                </button>
              </div>
              <label className="small-check">
                <input type="checkbox" checked={form.requireApproval} onChange={(e) => set('requireApproval', e.target.checked)} />
                Require my approval before drafts are created
              </label>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn primary" type="submit" disabled={busy || form.actions.length === 0}>
                  {busy ? 'Saving…' : 'Create rule'}
                </button>
              </div>
            </form>
          </div>

          <div className="card wide">
            <div className="card-head"><h3>Active rules</h3>
              <div className="row">
                <button className="btn" disabled={busy} onClick={() => runChecks('budget_threshold')}>Run budget check</button>
                <button className="btn" disabled={busy} onClick={() => runChecks('recurring_approaching')}>Check upcoming</button>
                <button className="btn" disabled={busy} onClick={() => runChecks('month_closed')}>Close last month</button>
              </div>
            </div>
            {rules.length === 0 ? <div className="empty">No rules yet. Transaction triggers fire automatically; use the buttons above for on-demand checks.</div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Rule</th><th>Trigger</th><th>Actions</th><th>Runs</th><th>Last fired</th><th>Status</th><th></th></tr></thead>
                <tbody>{rules.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.name}</b><div className="muted small">{(r.conditions || []).length} condition(s){r.requireApproval ? ' · approval on' : ''}</div></td>
                    <td>{TRIGGER_LABELS[r.trigger] || r.trigger}</td>
                    <td>{(r.actions || []).map((a) => a.kind).join(', ')}</td>
                    <td className="num">{r.runCount || 0}</td>
                    <td>{r.lastRunAt ? r.lastRunAt.slice(0, 16).replace('T', ' ') : '—'}</td>
                    <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                    <td><div className="row">
                      <button className="btn" onClick={() => toggle(r)}>{r.status === 'active' ? 'Pause' : 'Enable'}</button>
                      <button className="btn danger" onClick={() => remove(r)}>Delete</button>
                    </div></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {tab === 'inbox' && (
        <div className="card wide">
          <div className="card-head"><h3>📥 Autopilot inbox</h3><span className="muted small">newest first</span></div>
          {notifs.length === 0 ? <div className="empty">Nothing yet — rules will post here when they fire.</div> :
            notifs.map((n) => (
              <div className="acct-card" key={n.id}>
                <div>
                  <b>{n.kind === 'approval' ? '✅ ' : n.kind === 'suggestion' ? '💡 ' : '🔔 '}{n.title}</b>
                  <div className="muted small">{n.body}</div>
                  <div className="muted small">{n.createdAt.slice(0, 16).replace('T', ' ')} · {n.status}{n.ruleId ? ' · rule' : ''}</div>
                </div>
                <div className="row">
                  {n.kind === 'approval' && n.status === 'unread' && (
                    <button className="btn primary" onClick={() => approve(n)}>Approve draft</button>
                  )}
                  {n.status === 'unread' && <button className="btn" onClick={() => markRead(n)}>Mark read</button>}
                </div>
              </div>
            ))}
        </div>
      )}

      {tab === 'runs' && (
        <div className="card wide">
          <div className="card-head"><h3>🧾 Execution log</h3><span className="muted small">only fired runs are logged · idempotent replays skipped silently</span></div>
          {runs.length === 0 ? <div className="empty">No runs yet.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>At</th><th>Trigger</th><th>Decision</th><th>Detail</th></tr></thead>
              <tbody>{runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.at.slice(0, 16).replace('T', ' ')}</td>
                  <td>{TRIGGER_LABELS[r.trigger] || r.trigger}</td>
                  <td><span className={`pill ${r.decision === 'fired' ? 'completed' : 'paused'}`}>{r.decision}</span></td>
                  <td>{r.detail}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}
