import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';
import { formatINR } from '../../services/analyticsService.js';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

// PaymentMethodChart — UPI vs cash vs cards (§2C / §4E). Toggle amount/count.
export default function PaymentMethodChart({ rows, title = 'Spending by payment method' }) {
  const [mode, setMode] = useState('amount');
  const data = (rows || []).map((r, i) => ({ ...r, color: COLORS[i % COLORS.length] }));
  return (
    <div className="card" role="figure" aria-label={title}>
      <div className="card-head">
        <h3>{title}</h3>
        <div className="seg">
          <button className={mode === 'amount' ? 'on' : ''} onClick={() => setMode('amount')}>Amount</button>
          <button className={mode === 'count' ? 'on' : ''} onClick={() => setMode('count')}>Count</button>
        </div>
      </div>
      {data.length === 0 ? (
        <div className="empty">No payment-method data. Internal transfers are excluded.</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="method" tick={{ fontSize: 10 }} interval={0} angle={-18} dy={8} height={52} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => mode === 'amount' ? `₹${Math.round(v / 1000)}k` : v} />
              <Tooltip formatter={(v, name) => [mode === 'amount' ? formatINR(v) : v, name === 'amount' ? 'Amount' : 'Transactions']} />
              <Legend />
              <Bar dataKey={mode} name={mode === 'amount' ? 'Amount' : 'Transactions'}>
                {data.map((r) => (
                  <Cell key={r.method} fill={r.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="card-foot muted">Internal transfers excluded. “Uncategorized” = payment method not recorded.</div>
        </>
      )}
    </div>
  );
}
