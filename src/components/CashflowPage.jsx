import React, { useMemo, useState } from 'react';
import { projectCashflow, scenarioCompare } from '../services/cashflow.js';
import { formatINR } from '../services/finance.js';
import { todayISO, addDaysISO } from '../services/analyticsService.js';

export default function CashflowPage({ transactions, accounts, recurring }) {
  const now = todayISO();
  const [minBal, setMinBal] = useState(10000);
  const [horizon, setHorizon] = useState(90);
  const [plannedName, setPlannedName] = useState('');
  const [plannedAmt, setPlannedAmt] = useState('');
  const [plannedDate, setPlannedDate] = useState(now);
  const [planned, setPlanned] = useState([]);
  const [delayDays, setDelayDays] = useState(30);
  const [dailyCut, setDailyCut] = useState(200);

  const proj = useMemo(() => projectCashflow({ transactions, accounts, recurring, planned, horizonDays: horizon, minBalance: Number(minBal) || 0, now }), [transactions, accounts, recurring, planned, horizon, minBal, now]);
  const scenarios = useMemo(() => scenarioCompare({ transactions, accounts, recurring, planned, horizonDays: horizon, now },
    [{ name: `Delay purchase ${delayDays}d`, delayPurchaseName: planned[0]?.name, delayDays: Number(delayDays) || 0 }, { name: `Cut ₹${dailyCut}/day`, dailyCut: Number(dailyCut) || 0 }]),
    [transactions, accounts, recurring, planned, horizon, now, delayDays, dailyCut]);

  const addPlanned = () => {
    if (!plannedName || !(Number(plannedAmt) > 0)) return;
    setPlanned((p) => [...p, { name: plannedName, amount: Number(plannedAmt), type: 'expense', date: plannedDate || now }]);
    setPlannedName(''); setPlannedAmt('');
  };

  return (
    <div>
      <div className="card wide">
        <div className="card-head"><h3>🔮 Cash-flow projection</h3><span className="muted small">start {formatINR(proj.startCash)} → end {formatINR(proj.endBalance)}</span></div>
        <div className="row">
          <label>Horizon <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>{[7, 30, 60, 90, 180].map((h) => <option key={h} value={h}>{h} days</option>)}</select></label>
          <label>Min balance ₹<input className="input" type="number" value={minBal} onChange={(e) => setMinBal(e.target.value)} style={{ width: 120 }} /></label>
        </div>
        <div className="grid-3">{proj.snapshots.map((s) => <div key={s.horizon} className="stat"><div className="stat-label">{s.horizon}d → {s.date}</div><div className="stat-value" style={{ color: s.belowMin ? 'var(--bad)' : undefined }}>{formatINR(s.balance)}</div><div className="stat-sub">{s.belowMin ? '⚠ below minimum' : 'above minimum'}</div></div>)}</div>
        {proj.breaches.length > 0
          ? <div className="warn">⚠ Balance falls below minimum on: {proj.breaches.map((b) => `${b.date} (${formatINR(b.balance)} — ${b.event})`).join('; ')}</div>
          : <div className="muted">No breaches of minimum in horizon. Exact breach dates listed here when they occur.</div>}
      </div>
      <div className="card wide">
        <div className="card-head"><h3>🛒 Planned purchases</h3></div>
        <div className="row">
          <input className="input" placeholder="Name" value={plannedName} onChange={(e) => setPlannedName(e.target.value)} />
          <input className="input" type="number" placeholder="₹" value={plannedAmt} onChange={(e) => setPlannedAmt(e.target.value)} />
          <input className="input" type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
          <button className="btn primary" onClick={addPlanned}>Add</button>
          {planned.length > 0 && <button className="btn" onClick={() => setPlanned([])}>Clear</button>}
        </div>
        {planned.length > 0 && <ul className="legend">{planned.map((p, i) => <li key={i}><span>{p.date} · {p.name}</span><span>{formatINR(p.amount)}</span></li>)}</ul>}
      </div>
      <div className="card wide">
        <div className="card-head"><h3>🧪 Alternative scenarios</h3></div>
        <div className="row">
          <label>Delay days <input className="input" type="number" value={delayDays} onChange={(e) => setDelayDays(e.target.value)} style={{ width: 90 }} /></label>
          <label>Daily cut ₹<input className="input" type="number" value={dailyCut} onChange={(e) => setDailyCut(e.target.value)} style={{ width: 90 }} /></label>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Scenario</th><th>End balance</th><th>Breaches</th></tr></thead>
          <tbody>{scenarios.map((s) => <tr key={s.name}><td>{s.name}</td><td className="num">{formatINR(s.result.endBalance)}</td><td>{s.result.breaches.length ? s.result.breaches.map((b) => b.date).join(', ') : 'none'}</td></tr>)}</tbody></table></div>
        <p className="muted small">Includes expected salary/income (recurring income), rent/subs/EMIs (recurring expenses), planned purchases above, and scheduled ledger items. Low-balance warnings list exact dates.</p>
      </div>
      <div className="card wide"><div className="card-head"><h3>📅 Projected events ({proj.events.length})</h3></div>
        <div className="table-wrap"><table><thead><tr><th>Date</th><th>Name</th><th>Type</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>{proj.events.slice(0, 100).map((e, i) => <tr key={i}><td>{e.date}</td><td>{e.name}</td><td>{e.type} · {e.kind}</td><td className="num">{formatINR(e.amount)}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
}
