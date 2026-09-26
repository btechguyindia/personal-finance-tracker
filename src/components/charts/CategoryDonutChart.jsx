import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatINR } from '../../services/analyticsService.js';

// CategoryDonutChart — generic donut (subcategories, payment methods).
// Props: rows [{key/label, amount, share, color?}], onSelect, title, emptyText
const PALETTE = ['#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#06b6d4', '#f97316', '#6366f1', '#84cc16', '#14b8a6'];

export default function CategoryDonutChart({ rows, onSelect, title, emptyText = 'No data in this period.' }) {
  const data = (rows || []).map((r, i) => ({
    name: r.subcategory || r.method || r.category || r.name,
    amount: r.amount,
    share: r.share,
    color: r.color || PALETTE[i % PALETTE.length],
    raw: r
  }));
  const total = data.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="card" role="figure" aria-label={title}>
      <div className="card-head"><h3>{title}</h3></div>
      {data.length === 0 ? (
        <div className="empty">{emptyText}</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie
                data={data}
                dataKey="amount"
                nameKey="name"
                innerRadius={55}
                outerRadius={90}
                onClick={(d) => onSelect && d && onSelect(d.raw)}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value, _n, props) => [`${formatINR(value)} (${props.payload.share.toFixed(1)}%)`, props.payload.name]} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="legend">
            {data.map((d) => (
              <li key={d.name}>
                <span><span className="dot" style={{ background: d.color }} />{d.name}</span>
                <span>{formatINR(d.amount)} · {d.share.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
          <div className="card-foot">Total: {formatINR(total)}</div>
        </>
      )}
    </div>
  );
}
