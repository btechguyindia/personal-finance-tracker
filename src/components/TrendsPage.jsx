import React, { useMemo } from 'react';
import { trendsBundle, healthScore } from '../services/insightsService.js';
import { currentMonthKey, formatINR } from '../services/finance.js';

function MiniBars({ months }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.expense, m.income)));
  return (
    <div>
      {months.map((m) => (
        <div key={m.month} style={{ marginBottom: 10 }}>
          <div className="row"><span className="muted">{m.month}</span>
            <span className="muted small">spent {formatINR(m.expense)} · earned {formatINR(m.income)} · net {formatINR(m.net)}</span></div>
          <div className="goal-bar" title={'Spent ' + m.expense}>
            <div style={{ width: ((m.expense / max) * 100) + '%' }} />
          </div>
          <div className="goal-bar" style={{ marginTop: 4 }} title={'Earned ' + m.income}>
            <div style={{ width: ((m.income / max) * 100) + '%', background: 'var(--good)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TrendsPage({ transactions, accounts, budgets }) {
  const monthKey = currentMonthKey();
  const bundle = useMemo(() => trendsBundle(transactions), [transactions]);
  const health = useMemo(
    () => healthScore(transactions, accounts, budgets, monthKey),
    [transactions, accounts, budgets, monthKey]
  );

  if (!transactions || transactions.length === 0) {
    return (
      <div className="card wide"><div className="empty"><span className="big-ico">📈</span>
        <h3 style={{ margin: '0 0 6px' }}>No trends yet</h3>
        <p className="muted">Add transactions or import a statement — trends, movers and your health score appear here.</p>
      </div></div>
    );
  }

  return (
    <div>
      <div className="card wide" style={{ borderLeft: `4px solid ${health.score >= 60 ? 'var(--good)' : 'var(--warn)'}` }}>
        <div className="card-head"><h3>💚 Financial health — {health.score}/100 · {health.grade}</h3>
          <span className="muted small">explainable, from your ledger</span></div>
        <div className="goal-bar"><div style={{ width: `${health.score}%`, background: health.score >= 60 ? 'var(--good)' : 'var(--warn)' }} /></div>
        <div className="grid-3" style={{ marginTop: 12 }}>
          {health.parts.map((p) => (
            <div key={p.label} className="stat">
              <div className="stat-label">{p.label}</div>
              <div className="stat-value" style={{ fontSize: 19 }}>{p.points}/{p.max}</div>
              <div className="stat-sub">{p.note}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>📈 Last 6 months</h3><span className="muted small">blue spent · green earned</span></div>
          {bundle.months.length === 0 ? <div className="empty">Not enough history yet.</div> : <MiniBars months={bundle.months} />}
        </div>
        <div className="card">
          <div className="card-head"><h3>🔥 Category movers</h3><span className="muted small">this month vs last</span></div>
          {bundle.movers.length === 0 ? <div className="empty">Nothing to compare yet.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Last mo</th><th style={{ textAlign: 'right' }}>This mo</th><th style={{ textAlign: 'right' }}>Δ</th></tr></thead>
              <tbody>{bundle.movers.map((m) => (
                <tr key={m.category}>
                  <td>{m.category}</td>
                  <td className="num">{formatINR(m.previous)}</td>
                  <td className="num">{formatINR(m.current)}</td>
                  <td className="num" style={{ color: m.diff > 0 ? 'var(--bad)' : 'var(--good)' }}>
                    {m.diff > 0 ? '+' : ''}{formatINR(m.diff)}{m.pct !== null ? ` (${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(0)}%)` : ' (new)'}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>

      <div className="card wide">
        <div className="card-head"><h3>📅 Weekday pattern</h3><span className="muted small">last 3 months</span></div>
        {!bundle.weekday ? <div className="empty">Not enough data.</div> : (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div>🛍️ <b>Heaviest:</b> {bundle.weekday.worst.day} <span className="muted">({formatINR(Math.round(bundle.weekday.worst.total))} total · {formatINR(Math.round(bundle.weekday.worst.average))}/day)</span></div>
            <div>🧘 <b>Lightest:</b> {bundle.weekday.best.day} <span className="muted">({formatINR(Math.round(bundle.weekday.best.total))} total)</span></div>
          </div>
        )}
        <p className="muted small">Tip: schedule no-spend days on your heaviest weekday.</p>
      </div>
    </div>
  );
}
