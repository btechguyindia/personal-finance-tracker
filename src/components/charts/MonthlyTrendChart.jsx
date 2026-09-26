import React, { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { formatINR } from '../../services/analyticsService.js';

const SERIES = [
  { key: 'expense', color: '#ef4444', label: 'Expenses' },
  { key: 'income', color: '#10b981', label: 'Income' },
  { key: 'net', color: '#3b82f6', label: 'Net cash flow' },
  { key: 'cumulative', color: '#8b5cf6', label: 'Cumulative spending' }
];

// MonthlyTrendChart — daily/weekly/monthly line chart w/ selectable series (§3).
export default function MonthlyTrendChart({ data, title = 'Spending trends', granularity }) {
  const [active, setActive] = useState(new Set(['expense', 'income']));
  const toggle = (k) => {
    setActive((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };
  if (!data || data.length === 0) return <div className="card"><h3>{title}</h3><div className="empty">Insufficient data for this range.</div></div>;
  return (
    <div className="card wide" role="figure" aria-label={title}>
      <div className="card-head">
        <h3>{title} <span className="muted">({granularity})</span></h3>
        <div className="series-toggles">
          {SERIES.map((s) => (
            <label key={s.key}>
              <input type="checkbox" checked={active.has(s.key)} onChange={() => toggle(s.key)} />
              <span className="dot" style={{ background: s.color }} /> {s.label}
            </label>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={28} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Number(v) >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
          <Tooltip formatter={(v) => formatINR(v)} labelFormatter={(l) => `Date: ${l}`} />
          <Legend />
          {SERIES.filter((s) => active.has(s.key)).map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} dot={false} strokeWidth={2} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
