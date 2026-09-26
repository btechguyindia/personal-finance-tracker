// analyst.js — P1 #7 AI financial analyst (rule-based, cited, no hallucinations). Pure ESM.
import { summarizeLedger, expenseByCategory, getDateRange, monthlySeries } from './analyticsService.js';
import { monthTotals } from './finance.js';

function citeIds(rows, n = 5) { return rows.slice(0, n).map((t) => t.id); }

// Very small intent router over rule-based queries. Always returns {answer, range, figures, txnIds, caveats}.
export function askAnalyst(question, { transactions = [], recurring = [], monthKey }) {
  const q = String(question || '').toLowerCase();
  const txns = transactions || [];
  if (!txns.length) return { answer: 'No transactions yet — add or import data first. I cannot invent figures.', range: null, figures: {}, txnIds: [], caveats: ['empty-ledger'] };

  const range = (() => { try { return getDateRange('this-month'); } catch { return null; } })();
  const summary = range ? summarizeLedger(txns, range, {}) : null;
  const byCat = range ? expenseByCategory(txns, range, {}) : null;

  if (/where.*money|spent.*month|breakdown/.test(q)) {
    const top = (byCat?.rows || []).slice(0, 5).map((r) => `${r.category} ₹${Math.round(r.amount).toLocaleString('en-IN')}`).join(', ');
    const rows = (byCat?.rows || []).flatMap((r) => txns.filter((t) => t.category === r.category && t.date >= range.start && t.date <= range.end)).slice(0, 8);
    return { answer: `This month (${range.start}→${range.end}) you spent ₹${Math.round(summary.totalSpending).toLocaleString('en-IN')} and earned ₹${Math.round(summary.totalIncome).toLocaleString('en-IN')}. Top: ${top || '—'}.`, range, figures: { spent: summary.totalSpending, income: summary.totalIncome }, txnIds: citeIds(rows), caveats: summary.complete ? [] : ['partial-period'] };
  }
  if (/chang.*last month|compar|trend/.test(q)) {
    const m = monthlySeries(txns, (() => { try { return getDateRange('last-6-months'); } catch { return null; } })(), {});
    const last2 = m.slice(-2);
    if (last2.length < 2) return { answer: 'Not enough monthly history to compare.', range: null, figures: {}, txnIds: [], caveats: ['insufficient-history'] };
    const [a, b] = last2;
    const d = b.expense - a.expense;
    return { answer: `${b.month} spending ₹${Math.round(b.expense).toLocaleString('en-IN')} vs ${a.month} ₹${Math.round(a.expense).toLocaleString('en-IN')} (${d >= 0 ? '+' : ''}₹${Math.round(d).toLocaleString('en-IN')}). Income ${b.month}: ₹${Math.round(b.income).toLocaleString('en-IN')}.`, range: { start: a.month + '-01', end: b.month + '-28' }, figures: { prev: a.expense, curr: b.expense, diff: d }, txnIds: [], caveats: [] };
  }
  if (/safe.*spend|weekend|afford/.test(q)) {
    const mt = monthTotals(txns, monthKey);
    return { answer: `This month: earned ₹${Math.round(mt.income).toLocaleString('en-IN')}, spent ₹${Math.round(mt.expenses).toLocaleString('en-IN')}, net ₹${Math.round(mt.net).toLocaleString('en-IN')}. A prudent weekend cap is ~10% of remaining monthly budget — see Command Center safe-to-spend for the exact figure with bills covered.`, range, figures: mt, txnIds: [], caveats: mt.income === 0 ? ['no-income-data'] : [] };
  }
  if (/subscri|recurring|active/.test(q)) {
    const act = (recurring || []).filter((r) => r.status === 'active');
    return { answer: `${act.length} active recurring rule(s): ${act.map((r) => `${r.name} ₹${r.amount}/${r.frequency}`).join(', ') || 'none'}. Only rules you created are listed — I do not auto-cancel anything.`, range: null, figures: { count: act.length }, txnIds: [], caveats: [] };
  }
  if (/transport/.test(q)) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    const cut = cutoff.toISOString().slice(0, 10);
    const rows = txns.filter((t) => t.category === 'Transportation' && t.date >= cut);
    const total = rows.reduce((s, t) => s + (t.type === 'expense' ? Number(t.amount || 0) : 0), 0);
    return { answer: `Last 90 days transport: ₹${Math.round(total).toLocaleString('en-IN')} across ${rows.length} transaction(s) since ${cut}.`, range: { start: cut, end: 'today' }, figures: { total, count: rows.length }, txnIds: citeIds(rows), caveats: [] };
  }
  // fallback: monthly summary
  return { answer: `Ledger has ${txns.length} transaction(s). Try: "Where did my money go this month?", "What changed vs last month?", "Which subscriptions are active?", "Show transport last 90 days". I only use your real records and say when data is incomplete.`, range, figures: { count: txns.length }, txnIds: [], caveats: ['unmatched-intent'] };
}
