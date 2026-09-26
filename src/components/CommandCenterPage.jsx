import React, { useMemo, useState } from 'react';
import { safeToSpend, billsDue, cashRunwayDays, runwayWithCash, overspendAlerts, upcomingLarge, dailyChecklist, canAfford, assetCash } from '../services/commandCenter.js';
import { currentMonthKey, formatINR } from '../services/finance.js';
import { todayISO } from '../services/analyticsService.js';

export default function CommandCenterPage({ transactions, accounts, budgets, recurring, goals }) {
  const monthKey = currentMonthKey();
  const now = todayISO();
  const [price, setPrice] = useState('');
  const [buffer, setBuffer] = useState(5000);
  const safe = useMemo(() => safeToSpend({ transactions, accounts, recurring, goals, minBuffer: Number(buffer) || 0, now }), [transactions, accounts, recurring, goals, buffer, now]);
  const runway = useMemo(() => { const r = cashRunwayDays({ transactions, now }); return { ...r, ...runwayWithCash(safe.cash, r.avgDailyBurn) }; }, [transactions, safe.cash, now]);
  const due7 = useMemo(() => billsDue(transactions, recurring, now, 7), [transactions, recurring, now]);
  const due30 = useMemo(() => billsDue(transactions, recurring, now, 30), [transactions, recurring, now]);
  const over = useMemo(() => overspendAlerts(transactions, budgets, monthKey), [transactions, budgets, monthKey]);
  const large = useMemo(() => upcomingLarge(transactions, recurring, now, 10000, 60), [transactions, recurring, now]);
  const checklist = useMemo(() => dailyChecklist({ transactions, recurring, budgets, goals, monthKey, now }), [transactions, recurring, budgets, goals, monthKey, now]);
  const afford = useMemo(() => (price ? canAfford({ price, transactions, accounts, recurring, budgets, goals, monthKey, minBuffer: Number(buffer) || 0, now }) : null), [price, transactions, accounts, recurring, budgets, goals, monthKey, buffer, now]);

  return (
    <div>
      <div className="grid-3">
        <div className="stat"><div className="stat-label">Safe-to-spend (30d bills + buffer covered)</div><div className="stat-value">{formatINR(safe.safe)}</div><div className="stat-sub">Cash {formatINR(safe.cash)} − bills {formatINR(safe.billsTotal)} − goals {formatINR(safe.goalReserve)} − buffer {formatINR(Number(buffer) || 0)}{safe.shortfall ? ` · shortfall ${formatINR(safe.shortfall)}` : ''}</div></div>
        <div className="stat"><div className="stat-label">Cash runway</div><div className="stat-value">{runway.days === null ? 'n/a' : `${runway.days} days`}</div><div className="stat-sub">Burn {formatINR(runway.avgDailyBurn)}/day (60d avg)</div></div>
        <div className="stat"><div className="stat-label">Bills 7d / 30d</div><div className="stat-value">{due7.length} / {due30.length}</div><div className="stat-sub">30d total {formatINR(due30.reduce((s, b) => s + b.amount, 0))}</div></div>
      </div>
      <div className="card wide">
        <div className="card-head"><h3>🤔 Can I afford this?</h3><span className="muted small">checks cash + 30d bills + goals + buffer + budget</span></div>
        <div className="row">
          <input className="input" type="number" min="0" placeholder="Price, e.g. 25000" value={price} onChange={(e) => setPrice(e.target.value)} />
          <label>Min buffer ₹<input className="input" type="number" value={buffer} onChange={(e) => setBuffer(e.target.value)} style={{ width: 110 }} /></label>
        </div>
        {afford && <ul className="legend">{afford.reasons.map((r, i) => <li key={i}><span>{r}</span></li>)}</ul>}
      </div>
      <div className="grid-2">
        <div className="card"><div className="card-head"><h3>🧾 Bills due (7d)</h3></div>
          {due7.length === 0 ? <div className="empty">Nothing due in 7 days.</div> : <ul className="legend">{due7.map((b, i) => <li key={i}><span>{b.date} · {b.name}</span><span>{formatINR(b.amount)}</span></li>)}</ul>}</div>
        <div className="card"><div className="card-head"><h3>🚨 Budget alerts</h3></div>
          {over.alerts.length === 0 ? <div className="empty">All budgets within limits.</div> : <ul className="legend">{over.alerts.map((a) => <li key={a.category}><span>{a.category} {a.warning ? '(85%+)' : '(OVER)'}</span><span>{formatINR(a.spent)}/{formatINR(a.limit)}</span></li>)}</ul>}</div>
      </div>
      <div className="grid-2">
        <div className="card"><div className="card-head"><h3>🐘 Upcoming large (≥₹10k, 60d)</h3></div>
          {large.length === 0 ? <div className="empty">No large upcoming items.</div> : <ul className="legend">{large.map((b, i) => <li key={i}><span>{b.date} · {b.name}</span><span>{formatINR(b.amount)}</span></li>)}</ul>}</div>
        <div className="card"><div className="card-head"><h3>✅ Daily checklist</h3></div>
          <ul className="legend">{checklist.map((c) => <li key={c.id}><span>{c.done ? '☑' : '☐'} {c.label}</span></li>)}</ul></div>
      </div>
    </div>
  );
}
