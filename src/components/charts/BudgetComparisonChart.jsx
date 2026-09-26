import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';
import { formatINR } from '../../services/analyticsService.js';

// BudgetComparisonChart — budget vs actual per category (§4 Chart C).
export default function BudgetComparisonChart({ data, onSelect, title = 'Budget vs actual spending' }) {
  if (!data || data.length === 0) return <div className="card"><h3>{title}</h3><div className="empty">No budgets or spending.</div></div>;
  return (
    <div className="card wide" role="figure" aria-label={title}>
      <div className="card-head"><h3>{title}</h3></div>
      <ResponsiveContainer width="100%" height={Math.max(240, data.length * 34)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 80, left: 90, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
          <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={85} />
          <Tooltip formatter={(v, name) => [formatINR(v), name]} />
          <Legend />
          <Bar dataKey="budget" name="Budgeted" fill="#cbd5e1" />
          <Bar dataKey="actual" name="Actual" onClick={(d) => onSelect && d && onSelect(d.category)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
            {data.map((r) => (
              <Cell key={r.category} fill={r.overBudget ? '#ef4444' : '#10b981'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <ul className="legend">
        {data.map((r) => (
          <li key={r.category} className={r.overBudget ? 'over' : ''}>
            <span>{r.overBudget ? '⚠ ' : ''}{r.category} — budget {formatINR(r.budget)}, spent {formatINR(r.actual)}, remaining {formatINR(r.remaining)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
