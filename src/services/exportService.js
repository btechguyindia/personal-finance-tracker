// ─────────────────────────────────────────────────────────────
// exportService.js — Excel (.xlsx) and PDF report exports.
// Pure builders + browser download triggers. Suggestions are
// derived ONLY from computed analytics (no invented behaviour).
// ─────────────────────────────────────────────────────────────
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ESSENTIAL_CATEGORIES, formatINR } from './analyticsService.js';

/** ASCII-safe INR for PDF (jsPDF built-in fonts lack the ₹ glyph). */
export function inrPlain(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return 'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

export function reportFileName(ext, range) {
  return `FinTrack-Analytics_${range.start}_to_${range.end}_${stamp()}.${ext}`;
}

// ── Suggestions engine (§6 data, actionable wording) ──

export function buildSuggestions({ summary, budgets, byCat }) {
  const out = [];
  const push = (area, suggestion, detail) => out.push({ area, suggestion, detail });

  // 1. Savings rate
  if (summary.totalIncome > 0) {
    const rate = (summary.netCashFlow / summary.totalIncome) * 100;
    if (rate < 0) {
      push('Savings', 'You spent more than you earned this period — trim the top category first.',
        `Net ${formatINR(summary.netCashFlow)} on income of ${formatINR(summary.totalIncome)} (savings rate ${rate.toFixed(1)}%).`);
    } else if (rate < 10) {
      push('Savings', 'Savings margin is thin — aim to move 5–10% of income aside before spending.',
        `Savings rate ${rate.toFixed(1)}% (${formatINR(summary.netCashFlow)} of ${formatINR(summary.totalIncome)}).`);
    } else if (rate >= 20) {
      push('Savings', 'Healthy savings rate — consider sweeping the surplus into investments.',
        `Savings rate ${rate.toFixed(1)}% (${formatINR(summary.netCashFlow)} of ${formatINR(summary.totalIncome)}).`);
    }
  } else if (summary.totalSpending > 0) {
    push('Income', 'No income recorded in this period — add income transactions for a full picture.',
      `${formatINR(summary.totalSpending)} of spending with ${formatINR(0)} income.`);
  }

  // 2. Over-budget categories
  const over = (budgets || []).filter((b) => b.overBudget);
  for (const b of over) {
    push('Budget', `“${b.category}” is over budget by ${formatINR(-b.remaining)} — review its transactions below.`,
      `Budget ${formatINR(b.budget)} vs actual ${formatINR(b.actual)}.`);
  }
  if (over.length === 0 && (budgets || []).some((b) => b.budget > 0)) {
    push('Budget', 'All set budgets are on track — keep it up.',
      `${(budgets || []).filter((b) => b.budget > 0).length} categories with budgets, none exceeded.`);
  }

  // 3. Concentration risk
  if (summary.highestCategory && summary.totalSpending > 0) {
    const share = (summary.highestCategoryAmount / summary.totalSpending) * 100;
    if (share >= 35) {
      push('Spending mix', `“${summary.highestCategory}” dominates at ${share.toFixed(0)}% of spending — check for one-off spikes.`,
        `${formatINR(summary.highestCategoryAmount)} of ${formatINR(summary.totalSpending)}.`);
    }
  }

  // 4. Essential vs discretionary
  let essential = 0, discretionary = 0;
  for (const r of byCat.rows || []) {
    if (ESSENTIAL_CATEGORIES.has(r.category)) essential += r.amount;
    else if (r.category !== 'Uncategorized' && r.amount > 0) discretionary += r.amount;
  }
  if (essential + discretionary > 0) {
    const pct = (discretionary / (essential + discretionary)) * 100;
    if (pct >= 40) {
      push('Spending mix', 'Discretionary spending is high — cap outings, shopping and entertainment next period.',
        `Discretionary ${pct.toFixed(0)}% (${formatINR(discretionary)}) vs essential ${formatINR(essential)}.`);
    }
  }

  // 5. Trend vs previous period
  if (summary.spendingPctChange !== null && summary.spendingPctChange !== undefined) {
    if (summary.spendingPctChange > 10) {
      push('Trend', 'Spending is climbing vs the previous period — revisit recurring expenses.',
        `Up ${summary.spendingPctChange.toFixed(1)}% (${formatINR(summary.spendingDiff)}) vs previous ${formatINR(summary.prevSpending)}.`);
    } else if (summary.spendingPctChange < -10) {
      push('Trend', 'Spending is down vs the previous period — lock in the win.',
        `Down ${Math.abs(summary.spendingPctChange).toFixed(1)}% vs previous ${formatINR(summary.prevSpending)}.`);
    }
  }

  // 6. Largest transaction review
  if (summary.largestTransaction) {
    const lt = summary.largestTransaction;
    push('Review', `Review your largest transaction: ${formatINR(Math.abs(lt.amount))} at ${lt.merchant || 'unknown merchant'}.`,
      `${lt.date} · ${lt.category || 'Uncategorized'} · ${lt.paymentMethod || 'no method recorded'}.`);
  }

  return out;
}

// ── Excel ──

function sheet(wb, name, aoa, colWidths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (colWidths) ws['!cols'] = colWidths.map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}

export function exportExcelReport({ range, summary, byCat, monthly, pay, budgets, insights, transactions }) {
  const suggestions = buildSuggestions({ summary, budgets, byCat });
  const wb = XLSX.utils.book_new();
  const period = `${range.start} to ${range.end}`;

  sheet(wb, 'Summary', [
    ['FinTrack Analytics Report'],
    ['Period', period],
    ['Generated', stamp()],
    ['Status', summary.complete ? 'Completed period' : 'Partial period (in progress)'],
    [],
    ['Metric', 'Value'],
    ['Total spending', summary.totalSpending],
    ['Total income', summary.totalIncome],
    ['Net cash flow', summary.netCashFlow],
    ['Average daily spending', Math.round(summary.avgDailySpending)],
    ['Highest spending category', summary.highestCategory || '—'],
    ['Highest category amount', summary.highestCategoryAmount || 0],
    ['Largest transaction', summary.largestTransaction ? `${summary.largestTransaction.merchant} — ${summary.largestTransaction.amount} (${summary.largestTransaction.date})` : '—'],
    ['Number of transactions', summary.transactionCount],
    ['Previous period spending', summary.prevSpending],
    ['Change vs previous (Rs)', summary.spendingDiff],
    ['Change vs previous (%)', summary.spendingPctChange === null ? 'n/a' : Number(summary.spendingPctChange.toFixed(1))]
  ], [28, 52]);

  sheet(wb, 'Suggestions', [
    ['Area', 'Suggestion', 'Basis (numbers)'],
    ...suggestions.map((s) => [s.area, s.suggestion, s.detail])
  ], [14, 70, 60]);

  sheet(wb, 'Categories', [
    ['Category', 'Amount (Rs)', 'Share (%)'],
    ...byCat.rows.map((r) => [r.category, Math.round(r.amount), Number(r.share.toFixed(1))])
  ], [20, 14, 12]);

  sheet(wb, 'Monthly', [
    ['Month', 'Income (Rs)', 'Expenses (Rs)', 'Net (Rs)'],
    ...monthly.map((m) => [m.date, Math.round(m.income), Math.round(m.expense), Math.round(m.net)])
  ], [12, 14, 14, 14]);

  sheet(wb, 'Payment methods', [
    ['Method', 'Amount (Rs)', 'Transactions', 'Share (%)'],
    ...(pay.rows || []).map((r) => [r.method, Math.round(r.amount), r.count, Number(r.share.toFixed(1))])
  ], [18, 14, 14, 12]);

  sheet(wb, 'Budget vs actual', [
    ['Category', 'Budget (Rs)', 'Actual (Rs)', 'Remaining (Rs)', 'Status'],
    ...(budgets || []).map((b) => [b.category, b.budget, Math.round(b.actual), Math.round(b.remaining), b.overBudget ? 'OVER BUDGET' : b.budget > 0 ? 'On track' : 'No budget'])
  ], [18, 13, 13, 15, 13]);

  sheet(wb, 'Insights', [
    ['Insight', 'How calculated'],
    ...(insights || []).map((i) => [i.text, i.calculation])
  ], [80, 70]);

  sheet(wb, 'Transactions', [
    ['ID', 'Date', 'Type', 'Amount (Rs)', 'Category', 'Subcategory', 'Method', 'Account', 'Merchant', 'Status'],
    ...(transactions || []).map((t) => [t.id, t.date, t.type, t.amount, t.category || '', t.subcategory || '', t.paymentMethod || '', t.account || '', t.merchant || '', t.status || ''])
  ], [10, 12, 10, 13, 16, 16, 14, 15, 20, 10]);

  XLSX.writeFile(wb, reportFileName('xlsx', range));
  return suggestions;
}

// ── PDF ──

export function exportPDFReport({ range, summary, byCat, monthly, budgets, transactions }) {
  const suggestions = buildSuggestions({ summary, budgets, byCat });
  const doc = new jsPDF({ unit: 'pt' });
  const W = doc.internal.pageSize.getWidth();
  let y = 56;

  // Header band
  doc.setFillColor(47, 93, 80);
  doc.rect(0, 0, W, 86, 'F');
  doc.setTextColor(250, 250, 249);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text('FinTrack  —  Analytics Report', 40, 38);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(220, 228, 224);
  doc.text(`Period: ${range.start} to ${range.end}   •   Generated: ${stamp()}   •   ${summary.complete ? 'Completed period' : 'Partial period (in progress)'}`, 40, 60);

  y = 112;
  const section = (title) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(28, 25, 23);
    doc.text(title, 40, y);
    y += 6;
  };

  // Summary
  section('Summary');
  autoTable(doc, {
    startY: y,
    margin: { left: 40, right: 40 },
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 5, textColor: [28, 25, 23] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 220 }, 1: { halign: 'right' } },
    body: [
      ['Total spending', inrPlain(summary.totalSpending)],
      ['Total income', inrPlain(summary.totalIncome)],
      ['Net cash flow', inrPlain(summary.netCashFlow)],
      ['Average daily spending', inrPlain(summary.avgDailySpending)],
      ['Highest category', `${summary.highestCategory || '—'} (${inrPlain(summary.highestCategoryAmount)})`],
      ['Largest transaction', summary.largestTransaction ? `${inrPlain(Math.abs(summary.largestTransaction.amount))} — ${summary.largestTransaction.merchant} (${summary.largestTransaction.date})` : '—'],
      ['Transactions', String(summary.transactionCount)],
      ['Change vs previous', summary.spendingPctChange === null ? `n/a (${inrPlain(summary.spendingDiff)})` : `${summary.spendingPctChange >= 0 ? '+' : ''}${summary.spendingPctChange.toFixed(1)}% (${inrPlain(summary.spendingDiff)})`]
    ],
    didParseCell: (d) => {
      if (d.row.index % 2 === 0) d.cell.styles.fillColor = [251, 250, 248];
    }
  });
  y = doc.lastAutoTable.finalY + 26;

  // Suggestions
  section('Suggestions');
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  suggestions.forEach((s, i) => {
    const lines = doc.splitTextToSize(`${s.suggestion}  —  ${s.detail}`, W - 110);
    if (y + lines.length * 13 > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 56; }
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(47, 93, 80);
    doc.text(`${i + 1}. ${s.area}`, 56, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(68, 64, 60);
    doc.text(lines, 56, y);
    y += lines.length * 13 + 10;
  });
  y += 8;

  // Categories
  if (y > doc.internal.pageSize.getHeight() - 160) { doc.addPage(); y = 56; }
  section('Spending by category');
  autoTable(doc, {
    startY: y,
    margin: { left: 40, right: 40 },
    head: [['Category', 'Amount', 'Share']],
    body: byCat.rows.map((r) => [r.category, inrPlain(r.amount), `${r.share.toFixed(1)}%`]),
    foot: [['Total', inrPlain(byCat.total), '100%']],
    theme: 'striped',
    headStyles: { fillColor: [28, 25, 23], fontSize: 10 },
    footStyles: { fillColor: [238, 244, 241], textColor: [28, 25, 23], fontStyle: 'bold' },
    styles: { fontSize: 10 }
  });
  y = doc.lastAutoTable.finalY + 26;

  // Monthly
  if (y > doc.internal.pageSize.getHeight() - 160) { doc.addPage(); y = 56; }
  section('Monthly income vs expenses');
  autoTable(doc, {
    startY: y,
    margin: { left: 40, right: 40 },
    head: [['Month', 'Income', 'Expenses', 'Net']],
    body: monthly.map((m) => [m.date, inrPlain(m.income), inrPlain(m.expense), inrPlain(m.net)]),
    theme: 'striped',
    headStyles: { fillColor: [28, 25, 23], fontSize: 10 },
    styles: { fontSize: 10 }
  });
  y = doc.lastAutoTable.finalY + 22;

  doc.setFontSize(9);
  doc.setTextColor(168, 162, 158);
  doc.text('Internal transfers excluded · refunds reduce spending · pending/scheduled excluded by default · zero denominators shown as n/a.', 40, y);

  // Footers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setTextColor(168, 162, 158);
    doc.text(`FinTrack Analytics  •  ${range.start} to ${range.end}  •  p. ${i}/${pages}`, 40, doc.internal.pageSize.getHeight() - 28);
  }

  doc.save(reportFileName('pdf', range));
  return suggestions;
}
