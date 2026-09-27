// Assets & Debt — balance-sheet workspace: net-worth summary, asset register
// with valuation history, liabilities with amortization + scenario planner,
// and explicit loan-payment recording (exactly one transfer, no double count).
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import { formatINR } from '../services/analyticsService.js';
import {
  ASSET_REGISTER_TYPES, LIABILITY_REGISTER_TYPES,
  amortize, compareScenarios, netWorth
} from '../services/loans.js';

const TYPE_LABEL = {
  cash: 'Cash', bank: 'Bank', fixed_deposit: 'Fixed deposit', investment: 'Investment',
  gold: 'Gold', property: 'Property', vehicle: 'Vehicle', other: 'Other',
  personal_loan: 'Personal loan', education_loan: 'Education loan', home_loan: 'Home loan',
  vehicle_loan: 'Vehicle loan', credit_card: 'Credit card', other_debt: 'Other debt'
};
const inr = (paise) => formatINR((Number(paise) || 0) / 100);

const emptyAsset = { name: '', type: 'bank', value: '', purchaseDate: '', purchasePrice: '', valuationDate: '', notes: '', linkedAccount: '' };
const emptyLiability = { name: '', type: 'home_loan', principal: '', outstanding: '', annualRatePct: '', startDate: '', maturityDate: '', emi: '', nextDueDate: '', lender: '', notes: '' };

export default function AssetsDebtPage({ accounts = [] }) {
  const [assets, setAssets] = useState([]);
  const [debts, setDebts] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAsset, setShowAsset] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [assetForm, setAssetForm] = useState(emptyAsset);
  const [showDebt, setShowDebt] = useState(false);
  const [editingDebt, setEditingDebt] = useState(null);
  const [debtForm, setDebtForm] = useState(emptyLiability);
  const [focusDebt, setFocusDebt] = useState(null);
  const [valForm, setValForm] = useState({ date: '', value: '', note: '' });
  const [extra, setExtra] = useState('');
  const [prepay, setPrepay] = useState({ amount: '', date: '' });
  const [payForm, setPayForm] = useState({ date: '', account: '', amount: '', interest: '', note: '' });

  const load = async () => {
    try {
      const [a, l] = await Promise.all([api.listAssets(), api.listLiabilities()]);
      setAssets(a); setDebts(l);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const balances = useMemo(
    () => (accounts || []).map((a) => ({ name: a.name, balancePaise: a.balancePaise ?? Math.round((a.balance || 0) * 100) })),
    [accounts]
  );
  const nw = useMemo(() => netWorth({ assets, liabilities: debts, balances }), [assets, debts, balances]);

  const mutate = async (fn, okMsg) => {
    setError(''); setMsg(''); setBusy(true);
    try { await fn(); await load(); if (okMsg) setMsg(okMsg); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const openAsset = (a) => {
    setEditingAsset(a || null);
    setAssetForm(a ? {
      name: a.name, type: a.type, value: a.value, purchaseDate: a.purchaseDate || '',
      purchasePrice: a.purchasePrice ?? '', valuationDate: a.valuationDate || '',
      notes: a.notes || '', linkedAccount: a.linkedAccount || ''
    } : emptyAsset);
    setShowAsset(true);
  };
  const saveAsset = () => mutate(async () => {
    const payload = { ...assetForm, value: Number(assetForm.value) };
    if (editingAsset) await api.updateAsset(editingAsset.id, payload);
    else await api.createAsset(payload);
    setShowAsset(false);
  }, editingAsset ? 'Asset updated — history kept.' : 'Asset added.');

  const openDebt = (l) => {
    setEditingDebt(l || null);
    setDebtForm(l ? {
      name: l.name, type: l.type, principal: l.principal, outstanding: l.outstanding,
      annualRatePct: l.annualRatePct, startDate: l.startDate || '', maturityDate: l.maturityDate || '',
      emi: l.emi, nextDueDate: l.nextDueDate || '', lender: l.lender || '', notes: l.notes || ''
    } : emptyLiability);
    setShowDebt(true);
  };
  const saveDebt = () => mutate(async () => {
    const payload = {
      ...debtForm, principal: Number(debtForm.principal),
      outstanding: debtForm.outstanding === '' ? undefined : Number(debtForm.outstanding),
      annualRatePct: Number(debtForm.annualRatePct || 0), emi: Number(debtForm.emi)
    };
    if (editingDebt) await api.updateLiability(editingDebt.id, payload);
    else await api.createLiability(payload);
    setShowDebt(false);
    setFocusDebt(null);
  }, editingDebt ? 'Liability updated.' : 'Liability added.');

  const focus = focusDebt ? debts.find((d) => d.id === focusDebt) : null;
  const schedule = useMemo(() => {
    if (!focus) return null;
    return amortize({
      principalPaise: focus.outstandingPaise, annualRatePct: focus.annualRatePct,
      emiPaise: focus.emiPaise, startDate: focus.nextDueDate || focus.startDate
    });
  }, [focus]);
  const scenarios = useMemo(() => {
    if (!focus) return [];
    const pre = prepay.amount ? [{ date: prepay.date || focus.nextDueDate || focus.startDate, paise: Math.round(Number(prepay.amount) * 100) }] : [];
    return compareScenarios(
      { outstandingPaise: focus.outstandingPaise, annualRatePct: focus.annualRatePct, emiPaise: focus.emiPaise, nextDueDate: focus.nextDueDate, startDate: focus.startDate },
      { extraMonthlyPaise: Math.round(Number(extra || 0) * 100), prepayments: pre }
    );
  }, [focus, extra, prepay]);

  return (
    <div>
      {error && <div className="card"><div className="error">{error}</div></div>}
      {msg && <div className="card"><div className="success">{msg}</div></div>}

      <div className="cards" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat"><div className="stat-label">Total assets</div><div className="stat-value">{inr(nw.totalAssetsPaise)}</div><div className="stat-sub">{nw.assets.length} asset(s)</div></div>
        <div className="stat"><div className="stat-label">Total liabilities</div><div className="stat-value">{inr(nw.totalLiabilitiesPaise)}</div><div className="stat-sub">{nw.liabilities.length} loan(s), cards excluded</div></div>
        <div className={`stat ${nw.netWorthPaise >= 0 ? 'good' : 'bad'}`}><div className="stat-label">Net worth</div><div className="stat-value">{inr(nw.netWorthPaise)}</div><div className="stat-sub">assets − liabilities</div></div>
        <div className="stat"><div className="stat-label">Debt-to-asset</div><div className="stat-value">{nw.debtToAssetPct === null ? 'n/a' : `${nw.debtToAssetPct.toFixed(1)}%`}</div><div className="stat-sub">{nw.status === 'complete' ? 'Complete picture' : 'Partial — see flags'}</div></div>
      </div>
      {(nw.flags.length > 0 || nw.excluded.length > 0) && (
        <div className="card wide"><div className="muted small">
          {nw.estimateSharePct > 0 && <div>Based on manual estimates for {nw.estimateSharePct.toFixed(0)}% of asset value — estimates are not market prices.</div>}
          {nw.flags.map((f, i) => <div key={i}>• {f}</div>)}
          {nw.excluded.map((e) => <div key={e.id}>• “{e.name}”: {e.reason}.</div>)}
        </div></div>
      )}

      <div className="grid-2">
        <div className="card"><div className="card-head"><h3>Asset allocation</h3></div>
          {nw.allocation.length === 0 ? <div className="empty">No assets yet.</div> : (
            <ul className="legend">{nw.allocation.map((a) => (
              <li key={a.type}><span>{TYPE_LABEL[a.type] || a.type}</span><span>{inr(a.paise)}</span></li>
            ))}</ul>
          )}
        </div>
        <div className="card"><div className="card-head"><h3>Debt mix</h3></div>
          {nw.debtMix.length === 0 ? <div className="empty">No loans recorded. Debt-free looks good on you.</div> : (
            <ul className="legend">{nw.debtMix.map((d) => (
              <li key={d.type}><span>{TYPE_LABEL[d.type] || d.type}</span><span>{inr(d.paise)}</span></li>
            ))}</ul>
          )}
        </div>
      </div>

      <div className="card wide">
        <div className="card-head"><h3>Assets</h3><button className="btn primary" onClick={() => openAsset(null)}>+ Add asset</button></div>
        {assets.length === 0 ? <div className="empty">Record property, gold, deposits, investments… linked bank assets use live balances (never double-counted).</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Type</th><th style={{ textAlign: 'right' }}>Value</th><th>Source</th><th>Valuation</th><th></th></tr></thead>
            <tbody>{assets.map((a) => {
              const row = nw.assets.find((r) => r.id === a.id);
              return (
                <tr key={a.id}>
                  <td>{a.name}</td><td>{TYPE_LABEL[a.type] || a.type}</td>
                  <td style={{ textAlign: 'right' }}>{inr(row ? row.valuePaise : a.valuePaise)}</td>
                  <td>{row?.source === 'linked' ? <span className="pill completed" title="Live balance from the linked account — the single source of truth">linked: {a.linkedAccount}</span> : <span className="pill scheduled" title="Manually entered estimate, not a market price">estimate</span>}</td>
                  <td className="muted small">{a.valuationDate || '—'}{row?.stale ? ' · stale' : ''}</td>
                  <td><div className="row">
                    <button className="btn" onClick={() => openAsset(a)}>Edit</button>
                    <button className="btn" onClick={() => { setFocusDebt(null); setValForm({ date: '', value: '', note: '' }); setEditingAsset(a); }}>Valuations ({a.valuations.length})</button>
                    <button className="btn danger" onClick={() => mutate(() => api.deleteAsset(a.id), 'Asset deleted.')}>Delete</button>
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        {editingAsset && !showAsset && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-head"><h3>Valuation history — {editingAsset.name}</h3>
              <button className="btn" onClick={() => setEditingAsset(null)}>Close</button></div>
            <ul className="legend">{editingAsset.valuations.map((v, i) => (
              <li key={i}><span>{v.date}{v.note ? ` · ${v.note}` : ''}</span><span>{inr(v.valuePaise)}</span></li>
            ))}</ul>
            <div className="row" style={{ marginTop: 8 }}>
              <label>Date<input className="input" type="date" value={valForm.date} onChange={(e) => setValForm({ ...valForm, date: e.target.value })} /></label>
              <label>Value (₹)<input className="input" type="number" min="0" step="0.01" value={valForm.value} onChange={(e) => setValForm({ ...valForm, value: e.target.value })} /></label>
              <label>Note<input className="input" value={valForm.note} onChange={(e) => setValForm({ ...valForm, note: e.target.value })} placeholder="Optional" /></label>
              <button className="btn primary" disabled={busy || valForm.value === ''} onClick={() => mutate(() => api.addValuation(editingAsset.id, { ...valForm, value: Number(valForm.value) }).then((a) => setEditingAsset(a)), 'Valuation recorded.')}>Add valuation</button>
            </div>
          </div>
        )}
      </div>

      <div className="card wide">
        <div className="card-head"><h3>Liabilities</h3><button className="btn primary" onClick={() => openDebt(null)}>+ Add loan</button></div>
        {debts.length === 0 ? <div className="empty">Record home, vehicle, education or personal loans to plan payoffs.</div> : (
          <div className="table-wrap"><table>
            <thead><tr>
              <th>Name</th><th>Type</th>
              <th style={{ textAlign: 'right' }} title="Original borrowed amount">Principal</th>
              <th style={{ textAlign: 'right' }} title="What you still owe today">Outstanding</th>
              <th style={{ textAlign: 'right' }} title="Contracted equated monthly instalment">EMI</th>
              <th>Rate</th><th></th>
            </tr></thead>
            <tbody>{debts.map((l) => (
              <tr key={l.id}>
                <td>{l.name}{l.lender ? <div className="muted small">{l.lender}</div> : null}</td>
                <td>{TYPE_LABEL[l.type] || l.type}</td>
                <td style={{ textAlign: 'right' }}>{inr(l.principalPaise)}</td>
                <td style={{ textAlign: 'right' }}>{inr(l.outstandingPaise)}</td>
                <td style={{ textAlign: 'right' }}>{inr(l.emiPaise)}</td>
                <td>{l.annualRatePct}%{l.rateType !== 'fixed' ? ` (${l.rateType})` : ''}</td>
                <td><div className="row">
                  <button className="btn" onClick={() => { setFocusDebt(focusDebt === l.id ? null : l.id); setEditingAsset(null); }}>{focusDebt === l.id ? 'Hide plan' : 'Plan & pay'}</button>
                  <button className="btn" onClick={() => openDebt(l)}>Edit</button>
                  <button className="btn danger" onClick={() => mutate(() => api.deleteLiability(l.id), 'Liability deleted.')}>Delete</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {focus && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-head"><h3>{focus.name} — schedule &amp; scenarios</h3>
              <span className="muted small" title="Total of all future EMIs">Total payable {inr((schedule?.totalPaidPaise || 0))} · <span title="Total interest over the remaining life">interest {inr(schedule?.totalInterestPaise || 0)}</span> · payoff {schedule?.payoffDate || 'never at this EMI'}</span></div>
            {schedule?.unpayable && <div className="error">This EMI does not cover monthly interest — the balance would never fall. Raise the EMI or record the rate correctly.</div>}
            <p className="muted small">Assumptions: {(schedule?.assumptions || []).join(' ')}</p>
            <h4>Compare strategies (view-only — nothing is posted)</h4>
            <div className="row">
              <label>Extra monthly (₹)<input className="input" type="number" min="0" step="100" value={extra} onChange={(e) => setExtra(e.target.value)} /></label>
              <label>One-time prepayment (₹)<input className="input" type="number" min="0" step="100" value={prepay.amount} onChange={(e) => setPrepay({ ...prepay, amount: e.target.value })} /></label>
              <label>Prepay date<input className="input" type="date" value={prepay.date} onChange={(e) => setPrepay({ ...prepay, date: e.target.value })} /></label>
            </div>
            <div className="table-wrap"><table>
              <thead><tr><th>Strategy</th><th style={{ textAlign: 'right' }}>Monthly</th><th>Payoff</th><th style={{ textAlign: 'right' }} title="Total interest over the remaining life">Total interest</th><th style={{ textAlign: 'right' }}>Interest saved</th></tr></thead>
              <tbody>{scenarios.map((s) => (
                <tr key={s.key}><td>{s.label}</td>
                  <td style={{ textAlign: 'right' }}>{s.key === 'emi' ? inr(focus.emiPaise) : s.unpayable ? '—' : inr((schedule?.schedule[0]?.emiPaise || focus.emiPaise) + (s.key === 'extra' || s.key === 'both' ? Math.round(Number(extra || 0) * 100) : 0))}</td>
                  <td>{s.payoffDate || 'never'}</td>
                  <td style={{ textAlign: 'right' }}>{inr(s.totalInterestPaise)}</td>
                  <td style={{ textAlign: 'right' }}>{inr(s.interestSavedVsEmiPaise)}</td></tr>
              ))}</tbody>
            </table></div>
            <h4>Record a payment (explicit — posts one transfer)</h4>
            <div className="row">
              <label>Date<input className="input" type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} /></label>
              <label>From account<select value={payForm.account} onChange={(e) => setPayForm({ ...payForm, account: e.target.value })}>
                <option value="">Select…</option>{(accounts || []).map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
              </select></label>
              <label>Total paid (₹)<input className="input" type="number" min="0.01" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></label>
              <label title="Interest slice of this payment">Interest in it (₹)<input className="input" type="number" min="0" step="0.01" value={payForm.interest} onChange={(e) => setPayForm({ ...payForm, interest: e.target.value })} /></label>
              <button className="btn primary" disabled={busy || !payForm.account || !payForm.amount} onClick={() => mutate(() => api.recordLoanPayment(focus.id, {
                date: payForm.date || undefined, account: payForm.account,
                amount: Number(payForm.amount), interest: Number(payForm.interest || 0), note: payForm.note || undefined
              }).then(() => { setPayForm({ date: '', account: '', amount: '', interest: '', note: '' }); setFocusDebt(null); }), 'Payment recorded — one transfer posted, outstanding reduced.')}>Record payment</button>
            </div>
            <p className="muted small">Posts a transfer {payForm.account || '…'} → {focus.name} (never income/expense) and reduces outstanding by the principal slice. Card bill payments stay transfers to the card account.</p>
          </div>
        )}
      </div>

      {showAsset && (
        <div className="modal-back" onClick={() => setShowAsset(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>{editingAsset ? 'Edit asset' : 'Add asset'}</h3><button className="btn" onClick={() => setShowAsset(false)}>✕</button></div>
            <div className="form-grid">
              <label>Name<input className="input" value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} /></label>
              <label>Type<select value={assetForm.type} onChange={(e) => setAssetForm({ ...assetForm, type: e.target.value })}>{ASSET_REGISTER_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
              <label>Value (₹)<input className="input" type="number" min="0" step="0.01" value={assetForm.value} onChange={(e) => setAssetForm({ ...assetForm, value: e.target.value })} /></label>
              <label title="When linked, the LIVE account balance is used — your entered value is ignored, never added twice">Linked account<select value={assetForm.linkedAccount} onChange={(e) => setAssetForm({ ...assetForm, linkedAccount: e.target.value })}>
                <option value="">None (manual estimate)</option>{(accounts || []).map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
              </select></label>
              <label>Purchase date<input className="input" type="date" value={assetForm.purchaseDate} onChange={(e) => setAssetForm({ ...assetForm, purchaseDate: e.target.value })} /></label>
              <label>Purchase price (₹)<input className="input" type="number" min="0" step="0.01" value={assetForm.purchasePrice} onChange={(e) => setAssetForm({ ...assetForm, purchasePrice: e.target.value })} /></label>
              <label>Valuation date<input className="input" type="date" value={assetForm.valuationDate} onChange={(e) => setAssetForm({ ...assetForm, valuationDate: e.target.value })} /></label>
              <label>Notes<input className="input" value={assetForm.notes} onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })} /></label>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={busy || !assetForm.name || assetForm.value === ''} onClick={saveAsset}>{editingAsset ? 'Save' : 'Add asset'}</button>
              <button className="btn" onClick={() => setShowAsset(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showDebt && (
        <div className="modal-back" onClick={() => setShowDebt(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>{editingDebt ? 'Edit liability' : 'Add liability'}</h3><button className="btn" onClick={() => setShowDebt(false)}>✕</button></div>
            <div className="form-grid">
              <label>Name<input className="input" value={debtForm.name} onChange={(e) => setDebtForm({ ...debtForm, name: e.target.value })} placeholder="e.g. HDFC Home Loan" /></label>
              <label>Type<select value={debtForm.type} onChange={(e) => setDebtForm({ ...debtForm, type: e.target.value })}>{LIABILITY_REGISTER_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
              <label title="Original borrowed amount">Principal (₹)<input className="input" type="number" min="0.01" step="0.01" value={debtForm.principal} onChange={(e) => setDebtForm({ ...debtForm, principal: e.target.value })} /></label>
              <label title="What you still owe today (defaults to principal)">Outstanding (₹)<input className="input" type="number" min="0" step="0.01" value={debtForm.outstanding} onChange={(e) => setDebtForm({ ...debtForm, outstanding: e.target.value })} placeholder="= principal" /></label>
              <label>Annual rate %<input className="input" type="number" min="0" max="100" step="0.01" value={debtForm.annualRatePct} onChange={(e) => setDebtForm({ ...debtForm, annualRatePct: e.target.value })} /></label>
              <label title="Contracted equated monthly instalment">EMI (₹)<input className="input" type="number" min="0.01" step="0.01" value={debtForm.emi} onChange={(e) => setDebtForm({ ...debtForm, emi: e.target.value })} /></label>
              <label>Start date<input className="input" type="date" value={debtForm.startDate} onChange={(e) => setDebtForm({ ...debtForm, startDate: e.target.value })} /></label>
              <label>Next due date<input className="input" type="date" value={debtForm.nextDueDate} onChange={(e) => setDebtForm({ ...debtForm, nextDueDate: e.target.value })} /></label>
              <label>Lender<input className="input" value={debtForm.lender} onChange={(e) => setDebtForm({ ...debtForm, lender: e.target.value })} /></label>
            </div>
            <p className="muted small">Credit-card entries are tracked via card accounts and excluded from liability totals (no double count). Only monthly EMI is supported in this phase.</p>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={busy || !debtForm.name || !debtForm.principal || !debtForm.emi || !debtForm.startDate} onClick={saveDebt}>{editingDebt ? 'Save' : 'Add liability'}</button>
              <button className="btn" onClick={() => setShowDebt(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
