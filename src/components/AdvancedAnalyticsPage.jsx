import React, { useMemo, useState } from 'react';
import { sankeyData, spendingVelocity, lifestyleInflation, stressTest, anomalyMap } from '../services/advancedAnalytics.js';
import { getDateRange, formatINR } from '../services/analyticsService.js';
import { currentMonthKey } from '../services/finance.js';
import { cashRunwayDays } from '../services/commandCenter.js';
import { todayISO } from '../services/analyticsService.js';

export default function AdvancedAnalyticsPage({ transactions, budgets }) {
  const monthKey = currentMonthKey();
  const now = todayISO();
  const range = useMemo(() => { try { return getDateRange('this-month'); } catch { return { start: monthKey + '-01', end: now }; } }, [monthKey, now]);
  const [thresh, setThresh] = useState(2);
  const sankey = useMemo(() => sankeyData(transactions, range), [transactions, range]);
  const budgetTotal = Object.values(budgets || {}).reduce((s, v) => s + Number(v || 0), 0);
  const vel = useMemo(() => spendingVelocity(transactions, monthKey, budgetTotal), [transactions, monthKey, budgetTotal]);
  const life = useMemo(() => lifestyleInflation(transactions, 6), [transactions]);
  const runway = useMemo(() => cashRunwayDays({ transactions, now }), [transactions, now]);
  const stress = useMemo(() => {
    const cash = (transactions || []).length ? 50000 : 0; // labeled estimate — replace with asset cash when wired
    return stressTest({ cash, avgDailyBurn: runway.avgDailyBurn, upcomingBills: 20000 });
  }, [runway]);
  const anom = useMemo(() => anomalyMap(transactions, 6, Number(thresh) || 2), [transactions, thresh]);
  const [selFlow, setSelFlow] = useState(null);

  return (
    <div>
      <div className="card wide"><div className="card-head"><h3>A. Sankey — money flows (click a flow for txns)</h3><span className="muted small">{range.start}→{range.end}</span></div>
        {sankey.links.length === 0 ? <div className="empty">No flows in range.</div> :
          <div className="table-wrap"><table><thead><tr><th>From → To</th><th style={{ textAlign: 'right' }}>Amount</th><th>Txns</th></tr></thead>
            <tbody>{sankey.links.slice(0, 30).map((l, i) => <tr key={i} onClick={() => setSelFlow(l)} style={{ cursor: 'pointer', background: selFlow === l ? 'var(--accent-soft)' : undefined }}><td>{l.from} → {l.to}</td><td className="num">{formatINR(l.amount)}</td><td className="muted small">{l.txnIds.length}</td></tr>)}</tbody></table></div>}
        {selFlow && <p className="muted small">Flow {selFlow.from}→{selFlow.to} · txns: {selFlow.txnIds.join(', ')}</p>}
      </div>
      <div className="grid-2">
        <div className="card"><div className="card-head"><h3>B. Spending velocity</h3><span className="muted small">{vel.status}</span></div>
          <div className="muted">Pace {formatINR(vel.dailyPace)}/day · budget {formatINR(budgetTotal)} over {vel.daysInMonth}d.</div>
          <div className="table-wrap"><table><thead><tr><th>Day</th><th>Cum</th><th>Planned</th><th>Gap</th></tr></thead>
            <tbody>{vel.rows.filter((r) => r.day <= vel.today || r.day % 5 === 0).map((r) => <tr key={r.day}><td>{r.day}</td><td className="num">{formatINR(r.cumulative)}</td><td className="num">{formatINR(r.planned)}</td><td className="num" style={{ color: r.ahead > 0 ? 'var(--bad)' : 'var(--good)' }}>{r.ahead > 0 ? '+' : ''}{formatINR(Math.round(r.ahead))}</td></tr>)}</tbody></table></div></div>
        <div className="card"><div className="card-head"><h3>C. Lifestyle inflation</h3></div><p className="muted small">{life.note}</p>
          <div className="table-wrap"><table><thead><tr><th>Month</th><th>Ess</th><th>Disc</th><th>Disc%</th><th>Income</th></tr></thead>
            <tbody>{life.rows.map((r) => <tr key={r.month}><td>{r.month}</td><td className="num">{formatINR(r.essential)}</td><td className="num">{formatINR(r.discretionary)}</td><td className="num">{r.discShare === null ? 'n/a' : `${r.discShare}%`}</td><td className="num">{formatINR(r.income)}</td></tr>)}</tbody></table></div></div>
      </div>
      <div className="grid-2">
        <div className="card"><div className="card-head"><h3>D. Stress-test (scenarios, not predictions)</h3></div>
          {stress.map((s) => <div key={s.name} className="insight"><div><b>{s.survives ? '✅' : '❌'} {s.name}</b> — remaining {formatINR(s.remaining)}</div><div className="muted small">{s.detail}</div></div>)}</div>
        <div className="card"><div className="card-head"><h3>E. Category anomaly map</h3><label>σ threshold <input className="input" type="number" step="0.5" value={thresh} onChange={(e) => setThresh(e.target.value)} style={{ width: 70 }} /></label></div>
          <div className="table-wrap"><table><thead><tr><th>Category</th>{anom.months.map((m) => <th key={m}>{m.slice(5)}</th>)}</tr></thead>
            <tbody>{anom.grid.map((g) => <tr key={g.category}><td>{g.category}</td>{g.cells.map((c) => <td key={c.month} className="num" title={`z=${c.z.toFixed(2)}`} style={c.hot ? { background: '#fee2e2', color: '#991b1b', fontWeight: 700 } : undefined}>{c.amount ? formatINR(c.amount) : '—'}</td>)}</tr>)}</tbody></table></div>
          <p className="muted small">Highlighted cells are ≥{thresh}σ above the category mean — unusual, not necessarily problematic.</p></div>
      </div>
    </div>
  );
}
