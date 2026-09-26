import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { formatINR } from '../../services/analyticsService.js';

// IncomeExpenseBarChart — grouped monthly income vs expenses + net (§4 Chart A).
export default function IncomeExpenseBarChart({ data, onSelect, title = 'Monthly income vs expenses' }) {
  if (!data || data.length === 0) return <div className="card wide"><h3>{title}</h3><div className="empty">No monthly data.</div></div>;
  return (
    <div className="card wide" role="figure" aria-label={title}>
      <div className="card-head"><h3>{title}</h3></div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
          <Tooltip formatter={(v, name) => [formatINR(v), name]} />
          <Legend />
          <ReferenceLine y={0} stroke="#666" />
          <Bar dataKey="income" name="Income" fill="#10b981" onClick={(d) => onSelect && d && onSelect(d.date)} style={{ cursor: onSelect ? 'pointer' : 'default' }} />
          <Bar dataKey="expense" name="Expenses" fill="#ef4444" onClick={(d) => onSelect && d && onSelect(d.date)} style={{ cursor: onSelect ? 'pointer' : 'default' }} />
          <Bar dataKey="net" name="Net savings" fill="#3b82f6" />
        </BarChart>
      </ResponsiveContainer>
      <div className="card-foot muted">Click a month bar to filter the transaction table. Net = income − expenses.</div>
    </div>
  );
}
