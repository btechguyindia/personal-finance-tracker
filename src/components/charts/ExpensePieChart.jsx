import React, { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatINR, groupSmallSlices } from '../../services/analyticsService.js';

// ExpensePieChart — expense distribution by category (§2 Chart A).
// Props: rows [{category,amount,share,color}], total, onSelect(category), title
export default function ExpensePieChart({ rows, total, onSelect, title = 'Expense distribution by category' }) {
  const [hidden, setHidden] = useState(new Set());
  const [groupOthers, setGroupOthers] = useState(true);

  const visible = useMemo(() => {
    const base = rows.filter((r) => !hidden.has(r.category));
    return groupOthers ? groupSmallSlices(base.filter((r) => r.amount > 0), 4) : base.filter((r) => r.amount > 0);
  }, [rows, hidden, groupOthers]);
  const nonPositive = rows.filter((r) => r.amount <= 0 && !hidden.has(r.category));

  const toggle = (cat) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="card" role="figure" aria-label={title}>
      <div className="card-head">
        <h3>{title}</h3>
        <label className="small-check">
          <input type="checkbox" checked={groupOthers} onChange={(e) => setGroupOthers(e.target.checked)} />
          Group small (&lt;4%) as Others
        </label>
      </div>
      {visible.length === 0 ? (
        <div className="empty">No positive expense slices to plot in this period{nonPositive.length ? ' (net refunds shown in legend).' : '.'}</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={visible}
                dataKey="amount"
                nameKey="category"
                outerRadius={95}
                label={({ category, share }) => `${category} ${share.toFixed(0)}%`}
                labelLine={false}
                onClick={(d) => d && onSelect && onSelect(d.category === 'Others' ? null : d.category)}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
              >
                {visible.map((r) => (
                  <Cell key={r.category} fill={r.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name, props) => [
                  `${formatINR(value)} (${props.payload.share.toFixed(1)}%)`,
                  props.payload.category
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="legend">
            {rows.map((r) => (
              <li key={r.category} className={hidden.has(r.category) ? 'off' : ''}>
                <button onClick={() => toggle(r.category)} aria-pressed={!hidden.has(r.category)} title="Click to hide/show">
                  <span className="dot" style={{ background: r.color }} />
                  {r.category}
                </button>
                <span>{formatINR(r.amount)} · {r.share.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
          <div className="card-foot">Total: {formatINR(total)}</div>
        </>
      )}
    </div>
  );
}
