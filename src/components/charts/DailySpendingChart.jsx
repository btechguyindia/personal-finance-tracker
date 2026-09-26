import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { formatINR } from '../../services/analyticsService.js';

// DailySpendingChart — daily expense bars + weekday averages (§3/§4D).
export default function DailySpendingChart({ data, title = 'Daily spending', onSelect }) {
  if (!data || data.length === 0) return <div className="card wide"><h3>{title}</h3><div className="empty">No daily data.</div></div>;
  const sliced = data.length > 62 ? data.slice(-62) : data;
  return (
    <div className="card wide" role="figure" aria-label={title}>
      <div className="card-head"><h3>{title}{data.length > 62 ? <span className="muted"> (last 62 days shown)</span> : null}</h3></div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={sliced} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
          <Tooltip formatter={(v) => [formatINR(v), 'Spent']} labelFormatter={(l) => `Date: ${l}`} />
          <Bar dataKey="expense" name="Spent" fill="#f59e0b" onClick={(d) => onSelect && d && onSelect(d.date)} style={{ cursor: onSelect ? 'pointer' : 'default' }} />
        </BarChart>
      </ResponsiveContainer>
      <div className="card-foot muted">Zero bars = no recorded activity that day (never estimated).</div>
    </div>
  );
}
