import React, { useMemo } from 'react';
import { milestoneTimeline } from '../services/milestones.js';
import { overview, formatINR } from '../services/finance.js';
import { currentMonthKey } from '../services/finance.js';

export default function MilestonesPage({ transactions, accounts, budgets, goals }) {
  const monthKey = currentMonthKey();
  const ov = useMemo(() => overview(transactions, accounts, budgets, monthKey), [transactions, accounts, budgets, monthKey]);
  const tl = useMemo(() => milestoneTimeline({ transactions, accounts, goals, netWorth: ov.netWorth }), [transactions, accounts, goals, ov.netWorth]);
  return (
    <div>
      <div className="card wide"><div className="card-head"><h3>🏆 Milestones — net worth {formatINR(ov.netWorth)}</h3></div>
        {tl.map((m) => <div key={m.id} style={{ marginBottom: 12 }}><div className="row"><b>{m.done ? '✅' : '⬜'} {m.name}</b><span className="muted">{formatINR(m.saved)}/{formatINR(m.target)} · {m.progress}%</span></div>
          <div className="goal-bar"><div style={{ width: `${m.progress}%`, background: m.done ? 'var(--good)' : undefined }} /></div>
          <div className="muted small">{m.note}{m.completedDate ? ` · completed ${m.completedDate}` : ''}</div></div>)}
        <p className="muted small">Plan vs actual: targets derive from your 3-month essential average; completion dates stamp when net worth first covers each milestone. Goal contributions stack in Savings Goals.</p>
      </div>
    </div>
  );
}
