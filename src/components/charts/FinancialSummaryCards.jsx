import React from 'react';
import { formatINR, formatPct } from '../../services/analyticsService.js';

// FinancialSummaryCards — six summary cards (§1 / §10 item 2).
export default function FinancialSummaryCards({ summary }) {
  const cards = [
    { label: 'Total spending', value: formatINR(summary.totalSpending), sub: summary.complete ? 'Completed period' : 'Partial period — still in progress' },
    { label: 'Total income', value: formatINR(summary.totalIncome), sub: `${summary.transactionCount} transactions` },
    { label: 'Net cash flow', value: formatINR(summary.netCashFlow), sub: summary.netCashFlow >= 0 ? 'Saved this period' : 'Overspent this period', tone: summary.netCashFlow >= 0 ? 'good' : 'bad' },
    { label: 'Avg daily spending', value: formatINR(summary.avgDailySpending), sub: `over ${summary.days} day(s)` },
    { label: 'Highest category', value: summary.highestCategory || '—', sub: summary.highestCategory ? formatINR(summary.highestCategoryAmount) : 'No expenses' },
    {
      label: 'vs previous period', value: summary.spendingPctChange === null ? 'n/a' : formatPct(summary.spendingPctChange),
      sub: `${summary.spendingDiff >= 0 ? '+' : ''}${formatINR(summary.spendingDiff)} vs prev (${formatINR(summary.prevSpending)})`
    }
  ];
  return (
    <div className="cards" role="region" aria-label="Financial summary">
      {cards.map((c) => (
        <div key={c.label} className={`stat ${c.tone || ''}`}>
          <div className="stat-label">{c.label}</div>
          <div className="stat-value">{c.value}</div>
          <div className="stat-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
