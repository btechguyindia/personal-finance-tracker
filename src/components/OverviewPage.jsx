import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { overview, formatINR, currentMonthKey } from '../services/finance.js';
import { expenseByCategory, budgetComparison, getDateRange } from '../services/analyticsService.js';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];

function Meter({ pct, over }) {
  return (
    <div className="goal-bar" style={{ marginTop: 6 }}>
      <div style={{ width: `${Math.min(100, pct)}%`, background: over ? '#dc2626' : undefined }} />
    </div>
  );
}

export default function OverviewPage({ transactions, accounts, budgets, onNavigate }) {
  const monthKey = currentMonthKey();
  const stats = useMemo(() => overview(transactions, accounts, budgets, monthKey), [transactions, accounts, budgets, monthKey]);

  const range = useMemo(() => {
    try { return getDateRange('this-month'); } catch { return null; }
  }, []);
  const catData = useMemo(() => {
    if (!range || transactions.length === 0) return [];
    return expenseByCategory(transactions, range, {}).rows.slice(0, 7)
      .map((r, i) => ({ name: r.category, value: r.amount, fill: COLORS[i % COLORS.length] }));
  }, [transactions, range]);

  const recent = useMemo(() => [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6), [transactions]);

  // Month spend vs budget + top categories (one-screen daily overview).
  const spendVsBudget = useMemo(() => {
    if (!range) return { rows: [], total: 0 };
    const byCat = expenseByCategory(transactions, range, {});
    return { rows: budgetComparison(byCat.rows, budgets || {}).slice(0, 6), total: byCat.total };
  }, [transactions, range, budgets]);

  const topCats = useMemo(() => {
    if (!range || transactions.length === 0) return [];
    return expenseByCategory(transactions, range, {}).rows.slice(0, 5);
  }, [transactions, range]);

  const netWorthRows = useMemo(() => [...(stats.accounts || [])]
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 6), [stats]);

  const budgetPct = stats.budgetTotal > 0 ? (stats.expenses / stats.budgetTotal) * 100 : 0;

  const acctBars = useMemo(() => stats.accounts
    .filter((a) => a.type !== 'credit_card')
    .map((a) => ({ name: a.name.length > 14 ? a.name.slice(0, 14) + '…' : a.name, balance: a.balance })), [stats]);

  if (transactions.length === 0 && accounts.every((a) => !a.balance)) {
    return (
      <div className="card wide">
        <div className="empty">
          <span className="big-ico">👋</span>
          <h3 style={{ margin: '0 0 6px' }}>Welcome to FinTrack!</h3>
          <p className="muted">Add your accounts and first transactions to see your live financial overview here.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => onNavigate('accounts')}>Set up accounts →</button>
            <button className="btn" onClick={() => onNavigate('transactions')}>Add transaction →</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="k-label">Net worth</div><div className="k-value">{formatINR(stats.netWorth)}</div><div className="k-sub">Assets − liabilities</div></div>
        <div className="kpi good"><div className="k-label">Income · {monthKey}</div><div className="k-value">{formatINR(stats.income)}</div><div className="k-sub">This month</div></div>
        <div className="kpi bad"><div className="k-label">Expenses · {monthKey}</div><div className="k-value">{formatINR(stats.expenses)}</div><div className="k-sub">This month</div></div>
        <div className={`kpi ${stats.net >= 0 ? 'good' : 'bad'}`}><div className="k-label">Net savings · {monthKey}</div><div className="k-value">{formatINR(stats.net)}</div><div className="k-sub">Savings rate: {stats.savingsRate === null ? 'n/a (no income)' : `${stats.savingsRate.toFixed(1)}%`}</div></div>
      </div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="k-label">Available balance</div><div className="k-value">{formatINR(stats.availableBalance)}</div><div className="k-sub">Across asset accounts</div></div>
        <div className="kpi warn"><div className="k-label">Credit card debt</div><div className="k-value">{formatINR(stats.totalLiabilities)}</div><div className="k-sub">Outstanding</div></div>
        <div className="kpi"><div className="k-label">Monthly budget</div><div className="k-value">{formatINR(stats.budgetTotal)}</div><div className="k-sub">Remaining: {formatINR(stats.remainingBudget)}</div></div>
        <div className="kpi"><div className="k-label">Accounts</div><div className="k-value">{stats.accounts.length}</div><div className="k-sub">{transactions.length} transactions</div></div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Month spend vs budget · {monthKey}</h3>
            <button className="btn" onClick={() => onNavigate('budgets')}>Budgets →</button>
          </div>
          {stats.budgetTotal > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <div className="row"><b style={{ fontSize: 18 }}>{formatINR(stats.expenses)}</b>
                <span className="muted">of {formatINR(stats.budgetTotal)} · {budgetPct.toFixed(0)}% used · {formatINR(stats.remainingBudget)} left</span></div>
              <Meter pct={budgetPct} over={stats.remainingBudget < 0} />
            </div>
          ) : <div className="muted small" style={{ marginBottom: 12 }}>No budgets set — <button className="btn" onClick={() => onNavigate('budgets')}>set limits →</button></div>}
          {spendVsBudget.rows.filter((r) => r.budget > 0 || r.actual > 0).slice(0, 5).map((r) => {
            const pct = r.budget > 0 ? (r.actual / r.budget) * 100 : (r.actual > 0 ? 100 : 0);
            return (
              <div key={r.category} style={{ marginBottom: 8 }}>
                <div className="row"><span>{r.category}</span>
                  <span className="muted small">{formatINR(r.actual)}{r.budget > 0 ? ` / ${formatINR(r.budget)}` : ' (no limit)'}{r.overBudget ? ' · over!' : ''}</span></div>
                <Meter pct={pct} over={r.overBudget} />
              </div>
            );
          })}
        </div>
        <div className="card">
          <div className="card-head"><h3>Net worth across accounts</h3>
            <button className="btn" onClick={() => onNavigate('accounts')}>Manage →</button>
          </div>
          <div className="row"><b style={{ fontSize: 18 }}>{formatINR(stats.netWorth)}</b>
            <span className="muted small">Assets {formatINR(stats.totalAssets)} − debt {formatINR(stats.totalLiabilities)}</span></div>
          {netWorthRows.length === 0 ? <div className="empty">No accounts.</div> : netWorthRows.map((a) => (
            <div key={a.name} className="kv">
              <span>{a.name} <span className="muted small">· {a.type}</span></span>
              <b className={a.balance < 0 ? 'warn' : ''}>{formatINR(a.balance)}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>This month's spending by category</h3>
            <button className="btn" onClick={() => onNavigate('reports')}>Full reports →</button>
          </div>
          {catData.length === 0 ? <div className="empty">No spending this month yet.</div> : (<>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={catData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {catData.map((c, i) => <Cell key={c.name} fill={c.fill} />)}
                </Pie>
                <Tooltip formatter={(v, n, p) => [formatINR(v), p.payload.name]} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ marginTop: 8 }}>
              {topCats.map((c, i) => (
                <div key={c.category} className="kv">
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: COLORS[i % COLORS.length], marginRight: 8 }} />{c.category}
                    <span className="muted small"> · {c.share.toFixed(0)}%</span></span>
                  <b>{formatINR(c.amount)}</b>
                </div>
              ))}
            </div>
          </>)}
        </div>
        <div className="card">
          <div className="card-head"><h3>Account balances</h3>
            <button className="btn" onClick={() => onNavigate('accounts')}>Manage →</button>
          </div>
          {acctBars.length === 0 ? <div className="empty">No accounts.</div> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={acctBars} layout="vertical" margin={{ left: 20, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip formatter={(v) => [formatINR(v), 'Balance']} />
                <Bar dataKey="balance" fill="#2563eb" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card wide">
        <div className="card-head"><h3>Recent activity</h3>
          <button className="btn" onClick={() => onNavigate('transactions')}>View all →</button>
        </div>
        {recent.length === 0 ? <div className="empty">Nothing yet.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Account</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>{recent.map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td><td>{t.merchant || '—'}</td>
                <td><span className={`pill ${t.type}`}>{t.type}</span> {t.category}</td>
                <td>{t.type === 'transfer' ? `${t.accountFrom} → ${t.accountTo}` : t.account}</td>
                <td className="num">{t.type === 'income' ? '+' : t.type === 'refund' ? '−' : t.type === 'transfer' ? '⇄ ' : '−'}{formatINR(Math.abs(t.amount))}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
