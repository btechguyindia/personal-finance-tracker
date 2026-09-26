import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';
import {
  getDateRange, previousPeriodRange, summarizeLedger, expenseByCategory,
  subcategoryBreakdown, paymentMethodBreakdown, dailySeries, monthlySeries,
  aggregateSeries, autoGranularity, weekdayAnalysis, budgetComparison,
  compareRanges, behaviourInsights, categoryDetail, filterLedger,
  isIncludedExpense, isIncludedIncome, expenseSignedAmount,
  formatINR, formatPct, validateReconciliation, RANGE_PRESETS
} from '../services/analyticsService.js';
import ExpensePieChart from './charts/ExpensePieChart.jsx';
import CategoryDonutChart from './charts/CategoryDonutChart.jsx';
import MonthlyTrendChart from './charts/MonthlyTrendChart.jsx';
import IncomeExpenseBarChart from './charts/IncomeExpenseBarChart.jsx';
import BudgetComparisonChart from './charts/BudgetComparisonChart.jsx';
import PaymentMethodChart from './charts/PaymentMethodChart.jsx';
import DailySpendingChart from './charts/DailySpendingChart.jsx';
import FinancialSummaryCards from './charts/FinancialSummaryCards.jsx';

// NOTE: transactions / budgets / accounts are passed as props from App.jsx
// (loaded from the persistent DB API). No dummy or seed data is used here.

const PRESET_LABELS = {
  'this-week': 'This week', 'last-7-days': 'Last 7 days', 'this-month': 'This month',
  'last-month': 'Last month', 'last-3-months': 'Last 3 months', 'last-6-months': 'Last 6 months',
  'this-year': 'This year', 'financial-year': 'Financial year (Apr–Mar)', 'custom': 'Custom range'
};

function toCSV(rows) {
  const head = ['id', 'date', 'type', 'amount', 'category', 'subcategory', 'paymentMethod', 'account', 'merchant', 'status'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [head.join(','), ...rows.map((t) => head.map((k) => esc(t[k])).join(','))].join('\n');
}

// Category-wise monthly spending bars (§4 Chart B), sorted, clickable.
function CategoryBarChart({ rows, onSelect }) {
  const data = [...rows].sort((a, b) => b.amount - a.amount);
  if (data.length === 0) return <div className="card"><h3>Category-wise spending</h3><div className="empty">No spending.</div></div>;
  return (
    <div className="card wide" role="figure" aria-label="Category-wise spending">
      <div className="card-head"><h3>Category-wise spending (click a bar for details)</h3></div>
      <ResponsiveContainer width="100%" height={Math.max(240, data.length * 36)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 70, left: 90, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
          <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={85} />
          <Tooltip formatter={(v, _n, p) => [`${formatINR(v)} (${p.payload.share.toFixed(1)}%)`, 'Spent']} />
          <Bar dataKey="amount" name="Spent" onClick={(d) => onSelect && d && onSelect(d.category)} style={{ cursor: 'pointer' }}>
            {data.map((r) => <Cell key={r.category} fill={r.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryDetailView({ transactions, budgetsMap, category, range, filters, onBack, onPickTxn }) {
  const [merchant, setMerchant] = useState('');
  const detail = useMemo(
    () => categoryDetail(transactions, range, category, { ...filters, merchants: merchant ? [merchant] : undefined }),
    [transactions, category, range, filters, merchant]
  );
  const merchants = detail.merchants;
  return (
    <div>
      <button className="btn" onClick={onBack}>← Back to analytics</button>
      <h2>{category} — analytics</h2>
      <div className="cards">
        <div className="stat"><div className="stat-label">Total spent</div><div className="stat-value">{formatINR(detail.amount)}</div><div className="stat-sub">{detail.share.toFixed(1)}% of spending · {detail.transactionCount} txns</div></div>
        <div className="stat"><div className="stat-label">Budget &amp; remaining</div><div className="stat-value">{formatINR(budgetsMap[category] || 0)}</div><div className="stat-sub">Remaining: {formatINR((budgetsMap[category] || 0) - detail.amount)}</div></div>
        <div className="stat"><div className="stat-label">vs previous period</div><div className="stat-value">{detail.pct === null ? 'n/a' : formatPct(detail.pct)}</div><div className="stat-sub">Prev: {formatINR(detail.prevAmount)} · Diff: {formatINR(detail.diff)}</div></div>
      </div>
      <div className="grid-2">
        <CategoryDonutChart rows={detail.subcategories.rows} title={`${category} — subcategory breakdown`} onSelect={(r) => onPickTxn && onPickTxn({ subcategory: r.subcategory })} />
        <CategoryDonutChart rows={detail.paymentMethods.map((m) => ({ name: m.method, method: m.method, amount: m.total, share: detail.amount ? (m.total / detail.amount) * 100 : 0 }))} title="Payment method breakdown" />
      </div>
      <MonthlyTrendChart data={detail.daily.length > 45 ? aggregateSeries(detail.daily, 'weekly') : detail.daily} granularity={detail.daily.length > 45 ? 'weekly' : 'daily'} title={`${category} — daily spending trend`} />
      <DailySpendingChart data={detail.daily} title={`${category} — daily spending bars`} />
      <div className="card">
        <div className="card-head"><h3>Merchant breakdown</h3>
          <select value={merchant} onChange={(e) => setMerchant(e.target.value)}>
            <option value="">All merchants</option>
            {merchants.map((m) => <option key={m.merchant} value={m.merchant}>{m.merchant}</option>)}
          </select>
        </div>
        <ul className="legend">{merchants.map((m) => <li key={m.merchant}><span>{m.merchant}</span><span>{formatINR(m.total)}</span></li>)}</ul>
      </div>
      <TxnTable rows={detail.transactions} title="Transactions" />
    </div>
  );
}

function TxnTable({ rows, title = 'Detailed transactions' }) {
  const [q, setQ] = useState('');
  const filtered = rows.filter((t) =>
    !q || [t.merchant, t.category, t.subcategory, t.account, t.paymentMethod, t.id].some((v) => (v || '').toLowerCase().includes(q.toLowerCase()))
  );
  const exportCSV = () => {
    const blob = new Blob([toCSV(filtered)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'analytics-transactions.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="card wide">
      <div className="card-head">
        <h3>{title} ({filtered.length})</h3>
        <div className="row">
          <input className="input" placeholder="Search merchant / category…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
          <button className="btn" onClick={exportCSV}>Export CSV</button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Subcategory</th><th>Method</th><th>Account</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {filtered.slice(0, 300).map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td><td>{t.merchant}</td><td>{t.category || '—'}</td><td>{t.subcategory || '—'}</td>
                <td>{t.paymentMethod || 'Uncategorized'}</td><td>{t.account}</td><td>{t.status}</td>
                <td style={{ textAlign: 'right' }}>{t.type === 'income' ? '+' : t.type === 'refund' ? '−' : ''}{formatINR(Math.abs(t.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 300 && <div className="muted">Showing first 300 of {filtered.length} — refine search or export CSV.</div>}
        {filtered.length === 0 && <div className="empty">No transactions match.</div>}
      </div>
    </div>
  );
}

export default function AnalyticsPage({ transactions = [], budgets: budgetsMap = {}, accounts = [], onGoToTransactions }) {
  const [preset, setPreset] = useState('this-month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [account, setAccount] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [includePending, setIncludePending] = useState(false);
  const [includeUncategorized, setIncludeUncategorized] = useState(true);
  const [drillCategory, setDrillCategory] = useState(null);
  const [granularity, setGranularity] = useState('auto');
  const [compareMode, setCompareMode] = useState('previous'); // previous | custom
  const [cmpStart, setCmpStart] = useState('');
  const [cmpEnd, setCmpEnd] = useState('');
  const [monthFocus, setMonthFocus] = useState(null);
  const [exporting, setExporting] = useState('');

  const reportData = () => ({ range, summary, byCat, monthly, pay, budgets: budgetRows, insights, transactions: tableRows });

  const handleExportExcel = async () => {
    setExporting('Preparing Excel…');
    try {
      const { exportExcelReport } = await import('../services/exportService.js');
      exportExcelReport(reportData());
    } finally {
      setExporting('');
    }
  };
  const handleExportPDF = async () => {
    setExporting('Preparing PDF…');
    try {
      const { exportPDFReport } = await import('../services/exportService.js');
      exportPDFReport(reportData());
    } finally {
      setExporting('');
    }
  };

  const range = useMemo(() => {
    try {
      return getDateRange(preset, { customStart: customStart || undefined, customEnd: customEnd || undefined });
    } catch {
      return getDateRange('this-month');
    }
  }, [preset, customStart, customEnd]);

  const filters = useMemo(() => ({
    accounts: account ? [account] : undefined,
    paymentMethods: payMethod ? [payMethod] : undefined,
    includePending, includeUncategorized
  }), [account, payMethod, includePending, includeUncategorized]);

  const summary = useMemo(() => summarizeLedger(transactions, range, filters), [transactions, range, filters]);
  const byCat = useMemo(() => expenseByCategory(transactions, range, filters), [transactions, range, filters]);
  const pay = useMemo(() => paymentMethodBreakdown(transactions, range, filters), [transactions, range, filters]);
  const daily = useMemo(() => dailySeries(transactions, range, filters), [transactions, range, filters]);
  const gran = granularity === 'auto' ? autoGranularity(range) : granularity;
  const trend = useMemo(() => aggregateSeries(daily, gran), [daily, gran]);
  const monthly = useMemo(() => monthlySeries(transactions, range, filters), [transactions, range, filters]);
  const prev = useMemo(() => previousPeriodRange(range), [range]);
  const comparison = useMemo(() => {
    const prevRange = compareMode === 'custom' && cmpStart && cmpEnd ? { start: cmpStart, end: cmpEnd } : prev;
    return { result: compareRanges(transactions, range, prevRange, filters), prevRange };
  }, [transactions, range, prev, filters, compareMode, cmpStart, cmpEnd]);
  const weekdays = useMemo(() => weekdayAnalysis(transactions, range, filters), [transactions, range, filters]);
  const budgetRows = useMemo(() => budgetComparison(byCat.rows, budgetsMap), [byCat, budgetsMap]);
  const insights = useMemo(() => behaviourInsights(transactions, range, filters), [transactions, range, filters]);
  const sub = useMemo(
    () => (drillCategory ? subcategoryBreakdown(transactions, range, drillCategory, filters) : null),
    [transactions, drillCategory, range, filters]
  );
  const recon = useMemo(() => validateReconciliation(transactions, range, filters), [transactions, range, filters]);
  const tableRows = useMemo(() => {
    let rows = filterLedger(transactions, { ...filters, start: range.start, end: range.end });
    if (monthFocus) rows = rows.filter((t) => t.date.slice(0, 7) === monthFocus);
    if (drillCategory) rows = rows.filter((t) => (t.category || 'Uncategorized') === drillCategory);
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [transactions, range, filters, monthFocus, drillCategory]);

  return (
    <div className="analytics">
      <header className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted">
            {range.label}: {range.start} → {range.end}
            {!summary.complete && ' · partial period (in progress — not a full-period total)'}
            {summary.complete && ' · completed period'}
            {!recon.ok && <span className="warn"> · ⚠ reconcile: {recon.errors.join('; ')}</span>}
          </p>
        </div>
        <div className="controls">
          <label>Period
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {RANGE_PRESETS.map((p) => <option key={p} value={p}>{PRESET_LABELS[p] || p}</option>)}
            </select>
          </label>
          {preset === 'custom' && (
            <>
              <label>From <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} /></label>
              <label>To <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} /></label>
            </>
          )}
          <label>Account
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>Method
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              <option value="">All methods</option>
              {['UPI', 'Cash', 'Debit card', 'Credit card', 'Bank transfer', 'Wallet'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="small-check"><input type="checkbox" checked={includePending} onChange={(e) => setIncludePending(e.target.checked)} /> Include pending/scheduled</label>
          <label className="small-check"><input type="checkbox" checked={includeUncategorized} onChange={(e) => setIncludeUncategorized(e.target.checked)} /> Include uncategorized</label>
          <div className="row">
            <button className="btn primary" onClick={handleExportExcel} disabled={!!exporting}>{exporting || 'Export Excel'}</button>
            <button className="btn" onClick={handleExportPDF} disabled={!!exporting}>{exporting || 'Export PDF'}</button>
          </div>
        </div>
      </header>

      {transactions.length === 0 ? (
        <div className="card wide">
          <h3>No data yet</h3>
          <p className="muted">Your account has no transactions. Analytics will appear here once you add real transactions — no demo data is used.</p>
          {onGoToTransactions && <button className="btn primary" onClick={onGoToTransactions}>Add your first transaction →</button>}
        </div>
      ) : drillCategory ? (
        <CategoryDetailView
          transactions={transactions}
          budgetsMap={budgetsMap}
          category={drillCategory}
          range={range}
          filters={filters}
          onBack={() => setDrillCategory(null)}
          onPickTxn={() => {}}
        />
      ) : (
        <>
          {/* 2. Six summary cards */}
          <FinancialSummaryCards summary={summary} />
          <div className="stat-line muted">
            Largest transaction: {summary.largestTransaction ? `${formatINR(Math.abs(summary.largestTransaction.amount))} — ${summary.largestTransaction.merchant} (${summary.largestTransaction.date})` : '—'}
            {' · '}Highest category: {summary.highestCategory || '—'} · Transactions: {summary.transactionCount}
          </div>

          {/* 3. Monthly income vs expenses */}
          <IncomeExpenseBarChart data={monthly} onSelect={(m) => setMonthFocus(m === monthFocus ? null : m)} title={`Monthly income vs expenses${monthFocus ? ` — filtering: ${monthFocus} (click again to clear)` : ''}`} />

          {/* 4. Donuts side by side */}
          <div className="grid-2">
            <ExpensePieChart rows={byCat.rows} total={byCat.total} onSelect={(c) => c && setDrillCategory(c)} />
            <PaymentMethodChart rows={pay.rows} />
          </div>

          {/* Subcategory drilldown strip */}
          <div className="card">
            <div className="card-head"><h3>Subcategory drilldown</h3>
              <select value={drillCategory || ''} onChange={(e) => setDrillCategory(e.target.value || null)}>
                <option value="">Select a category…</option>
                {byCat.rows.map((r) => <option key={r.category} value={r.category}>{r.category}</option>)}
              </select>
            </div>
            {!drillCategory ? <div className="muted">Pick a category (or click the pie/donut) to see subcategory distribution, then open its detail page.</div> : (
              <div className="grid-2">
                <CategoryDonutChart rows={sub.rows} title={`${drillCategory} — subcategories`} />
                <div>
                  <ul className="legend">{sub.rows.map((r) => <li key={r.subcategory}><span>{r.subcategory}</span><span>{formatINR(r.amount)} · {r.share.toFixed(1)}%</span></li>)}</ul>
                  <button className="btn" onClick={() => setDrillCategory(drillCategory)}>Open {drillCategory} detail page →</button>
                </div>
              </div>
            )}
          </div>

          {/* 5. Category bars */}
          <CategoryBarChart rows={byCat.rows} onSelect={(c) => setDrillCategory(c)} />

          {/* 6. Trend lines with granularity */}
          <div className="card-head row">
            <h3 style={{ margin: 0 }}>Trend granularity</h3>
            <div className="seg">
              {['auto', 'daily', 'weekly', 'monthly', 'quarterly'].map((g) => (
                <button key={g} className={(granularity === g || (g === 'auto' && granularity === 'auto')) ? 'on' : ''} onClick={() => setGranularity(g)}>{g}</button>
              ))}
            </div>
          </div>
          <MonthlyTrendChart data={trend} granularity={gran} title="Income / expenses / net / cumulative" />
          <DailySpendingChart data={daily} />

          {/* 7. Budget vs actual */}
          <BudgetComparisonChart data={budgetRows} onSelect={(c) => setDrillCategory(c)} />

          {/* Weekday spending (§4 Chart D) */}
          <div className="card wide">
            <div className="card-head"><h3>Weekday spending (Mon–Sun)</h3></div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekdays} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v, n) => [n === 'count' ? v : formatINR(v), n === 'average' ? 'Average per weekday' : n === 'total' ? 'Total' : n]} />
                <Legend />
                <Bar dataKey="total" name="Total" fill="#3b82f6" />
                <Bar dataKey="average" name="Average" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
            <div className="card-foot muted">Average = total ÷ occurrences of that weekday in range. Counts shown in tooltip via table below.</div>
          </div>

          {/* Comparison analytics (§5) */}
          <div className="card wide">
            <div className="card-head"><h3>Period comparison</h3>
              <div className="seg">
                <button className={compareMode === 'previous' ? 'on' : ''} onClick={() => setCompareMode('previous')}>vs previous period</button>
                <button className={compareMode === 'custom' ? 'on' : ''} onClick={() => setCompareMode('custom')}>custom compare</button>
              </div>
            </div>
            {compareMode === 'custom' && (
              <div className="row">
                <label>Compare from <input type="date" value={cmpStart} onChange={(e) => setCmpStart(e.target.value)} /></label>
                <label>to <input type="date" value={cmpEnd} onChange={(e) => setCmpEnd(e.target.value)} /></label>
              </div>
            )}
            <div className="table-wrap"><table>
              <thead><tr><th>Metric</th><th>Current ({range.start}→{range.end})</th><th>Previous ({comparison.prevRange.start}→{comparison.prevRange.end})</th><th>Δ (₹)</th><th>Δ (%)</th></tr></thead>
              <tbody>
                <tr><td>Spending</td><td>{formatINR(comparison.result.current.totalSpending)}</td><td>{formatINR(comparison.result.previous.totalSpending)}</td><td>{formatINR(comparison.result.spendingDiff)}</td><td>{comparison.result.spendingPct === null ? 'n/a (prev = 0)' : formatPct(comparison.result.spendingPct)}</td></tr>
                <tr><td>Income</td><td>{formatINR(comparison.result.current.totalIncome)}</td><td>{formatINR(comparison.result.previous.totalIncome)}</td><td>{formatINR(comparison.result.incomeDiff)}</td><td>{comparison.result.incomePct === null ? 'n/a (prev = 0)' : formatPct(comparison.result.incomePct)}</td></tr>
              </tbody>
            </table></div>
          </div>

          {/* 8. Behaviour insights (§6) */}
          <div className="card wide">
            <div className="card-head"><h3>Spending behaviour insights</h3></div>
            <div className="insights">
              {insights.map((ins, i) => (
                <div key={i} className="insight">
                  <div>{ins.text}</div>
                  <div className="muted small">How calculated: {ins.calculation}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 9. Detail table + export */}
          <TxnTable rows={tableRows} />
        </>
      )}
    </div>
  );
}
