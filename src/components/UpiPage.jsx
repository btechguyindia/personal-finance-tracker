import React, { useMemo, useState } from 'react';
import { api } from '../services/api.js';
import { formatINR } from '../services/finance.js';

// UPI section: saved UPI IDs are ORGANIZERS for your own tracking.
// This app never connects to UPI, never asks for PIN/OTP, never moves money.
export default function UpiPage({ upiIds, transactions, accounts, onChanged }) {
  const [upiId, setUpiId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');

  const upiTxns = useMemo(() => transactions.filter((t) =>
    (t.paymentMethod === 'UPI') || (t.upiRef && t.upiRef.length > 0)
  ).sort((a, b) => (a.date < b.date ? 1 : -1)), [transactions]);

  const totals = useMemo(() => {
    let inn = 0, out = 0;
    for (const t of upiTxns) {
      if (t.status && t.status !== 'completed') continue;
      if (t.type === 'income' || t.type === 'refund') inn += Number(t.amount);
      else if (t.type === 'expense') out += Number(t.amount);
    }
    return { in: inn, out, net: inn - out };
  }, [upiTxns]);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.addUpiId(upiId.trim(), accountId || null);
      setUpiId(''); setAccountId('');
      onChanged();
    } catch (err) { setError(err.message); }
  };

  const remove = async (id) => {
    if (!window.confirm('Remove this UPI ID?')) return;
    try { await api.deleteUpiId(id); onChanged(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi good"><div className="k-label">UPI received</div><div className="k-value">{formatINR(totals.in)}</div><div className="k-sub">Completed only</div></div>
        <div className="kpi bad"><div className="k-label">UPI paid</div><div className="k-value">{formatINR(totals.out)}</div><div className="k-sub">Completed only</div></div>
        <div className="kpi"><div className="k-label">UPI net</div><div className="k-value">{formatINR(totals.net)}</div><div className="k-sub">{upiTxns.length} UPI transactions</div></div>
        <div className="kpi"><div className="k-label">Saved UPI IDs</div><div className="k-value">{upiIds.length}</div><div className="k-sub">Identifiers, not access</div></div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Saved UPI IDs</h3></div>
        <p className="muted small">These are labels for organizing your own records (e.g. myname@okaxis). They do <b>not</b> connect to any bank or fetch history. Never enter a UPI PIN, OTP or banking password here — FinTrack will never ask for them.</p>
        <form onSubmit={add} className="form-grid">
          <label>UPI ID<input className="input" value={upiId} onChange={(e) => setUpiId(e.target.value)} required placeholder="myname@okaxis" /></label>
          <label>Linked account<select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— none —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
        </form>
        <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={add}>Save UPI ID</button></div>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
        <div style={{ marginTop: 12 }}>
          {upiIds.length === 0 ? <div className="empty">No UPI IDs saved yet.</div> : upiIds.map((u) => (
            <div className="acct-card" key={u.id}>
              <div><b>📱 {u.upiId}</b><div className="muted small">{u.accountId ? `Linked: ${(accounts.find((a) => a.id === u.accountId) || {}).name || '—'}` : 'No linked account'}</div></div>
              <button className="btn danger" onClick={() => remove(u.id)}>Remove</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card wide">
        <div className="card-head"><h3>UPI transactions ({upiTxns.length})</h3></div>
        {upiTxns.length === 0 ? (
          <div className="empty">No UPI transactions. Add them manually from Transactions (payment method = UPI, optional UPI ref) or import a CSV.</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Merchant / party</th><th>UPI ref</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>{upiTxns.slice(0, 200).map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td><td>{t.merchant || '—'} <span className={`pill ${t.type}`}>{t.type}</span></td>
                <td>{t.upiRef || '—'}</td><td><span className={`pill ${t.status}`}>{t.status}</span></td>
                <td className="num">{t.type === 'income' ? '+' : t.type === 'refund' ? '−' : '−'}{formatINR(Math.abs(t.amount))}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
