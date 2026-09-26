// accuracy.js — P1 #9 Financial accuracy monitor. Pure ESM.
import { computeBalances } from './finance.js';

// closingBalances: {accountName: statementBalance} + date per account optional.
// Returns per-account reconciliation + books-closed report.
export function reconcile({ transactions, accounts, closingBalances = {}, lastReconciled = {}, openingVerified = {} }) {
  const withBal = computeBalances(accounts || [], transactions || []);
  const rows = withBal.map((a) => {
    const stmt = closingBalances[a.name];
    const ledger = Number(a.balance || 0);
    const diff = stmt === undefined || stmt === null || stmt === '' ? null : Math.round((Number(stmt) - ledger) * 100) / 100;
    return { name: a.name, type: a.type, ledger, statement: stmt ?? null, diff, matched: diff === null ? null : Math.abs(diff) < 0.005, lastReconciled: lastReconciled[a.name] || null, openingVerified: openingVerified[a.name] !== false };
  });
  const matched = rows.filter((r) => r.matched === true).length;
  const mismatched = rows.filter((r) => r.matched === false);
  return { rows, matched, total: rows.length, mismatched, allMatched: rows.length > 0 && mismatched.length === 0 && rows.every((r) => r.matched) };
}

export function booksClosedReport({ transactions, accounts, monthKey, closingBalances = {}, lastReconciled = {} }) {
  const rec = reconcile({ transactions, accounts, closingBalances, lastReconciled });
  const inMonth = (transactions || []).filter((t) => !monthKey || t.date.startsWith(monthKey));
  const pending = inMonth.filter((t) => t.status === 'pending').length;
  const uncat = inMonth.filter((t) => !t.category || t.category === 'Uncategorized').length;
  return {
    month: monthKey, ...rec, pending, uncat,
    closed: rec.allMatched && pending === 0,
    summary: rec.allMatched && pending === 0
      ? `✅ Books closed for ${monthKey}: ${rec.matched}/${rec.total} accounts reconciled, no pending items.`
      : `⚠ Books open for ${monthKey}: ${rec.matched}/${rec.total} reconciled, ${rec.mismatched.length} mismatch(es), ${pending} pending, ${uncat} uncategorized.`,
  };
}
