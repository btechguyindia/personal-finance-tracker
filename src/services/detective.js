// detective.js — P1 #3 Transaction detective. Pure ESM. Never deletes; only flags.
function fp(t) {
  return [t.date, t.type, Math.round(Number(t.amount || 0) * 100), (t.account || t.accountFrom || '').toLowerCase(), (t.merchant || '').toLowerCase(), (t.upiRef || '').toLowerCase()].join('|');
}

export function flagDuplicates(transactions) {
  const seen = new Map();
  const flags = [];
  for (const t of transactions || []) {
    if (t.status && t.status !== 'completed') continue;
    const k = fp(t);
    if (seen.has(k)) {
      flags.push({ kind: 'possible-duplicate', severity: 'high', ids: [seen.get(k).id, t.id], date: t.date, amount: t.amount, merchant: t.merchant, reason: `Identical date/type/amount/account/merchant${t.upiRef ? '/UPI-ref' : ''} as ${seen.get(k).id}. Possible double UPI payment — verify in bank app, do not auto-delete.` });
    } else seen.set(k, t);
  }
  // Near-duplicate UPI: same amount+merchant within 2 days
  const upi = (transactions || []).filter((t) => (t.paymentMethod === 'UPI' || /@/.test(t.upiRef || '')) && t.type === 'expense');
  for (let i = 0; i < upi.length; i++) {
    for (let j = i + 1; j < upi.length; j++) {
      const a = upi[i], b = upi[j];
      if (a.id === b.id) continue;
      if ((a.merchant || '').toLowerCase() !== (b.merchant || '').toLowerCase()) continue;
      if (Number(a.amount) !== Number(b.amount)) continue;
      const dd = Math.abs(Date.parse(a.date) - Date.parse(b.date)) / 86400000;
      if (dd <= 2 && dd > 0 && !flags.some((f) => f.ids?.includes(a.id) && f.ids?.includes(b.id))) {
        flags.push({ kind: 'possible-duplicate-upi', severity: 'medium', ids: [a.id, b.id], date: b.date, amount: b.amount, merchant: b.merchant, reason: `Same UPI merchant+amount within ${dd.toFixed(0)} day(s). Check for accidental re-pay.` });
      }
    }
  }
  return flags;
}

export function flagBillChanges(transactions, recurring = []) {
  const flags = [];
  // group completed expenses by merchant, compare last vs median of prior 3
  const byM = new Map();
  for (const t of transactions || []) {
    if (t.type !== 'expense' || (t.status && t.status !== 'completed')) continue;
    if (!t.merchant) continue;
    if (!byM.has(t.merchant)) byM.set(t.merchant, []);
    byM.get(t.merchant).push(t);
  }
  for (const [m, rows] of byM) {
    if (rows.length < 3) continue;
    const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = sorted[sorted.length - 1];
    const prior = sorted.slice(-4, -1).map((r) => Number(r.amount || 0)).sort((a, b) => a - b);
    const med = prior[Math.floor(prior.length / 2)];
    if (med > 0 && Math.abs(last.amount - med) / med >= 0.25) {
      flags.push({ kind: 'bill-change', severity: 'medium', ids: [last.id], date: last.date, amount: last.amount, merchant: m, reason: `Latest ${m} ₹${last.amount} vs median ₹${med} of prior ${prior.length} — ${(((last.amount - med) / med) * 100).toFixed(0)}% change. Verify price hike or plan change.` });
    }
  }
  return flags;
}

export function flagUnusualAmounts(transactions) {
  const flags = [];
  const exps = (transactions || []).filter((t) => t.type === 'expense' && (!t.status || t.status === 'completed')).map((t) => Number(t.amount || 0));
  if (exps.length < 5) return flags;
  const mean = exps.reduce((s, x) => s + x, 0) / exps.length;
  const sd = Math.sqrt(exps.reduce((s, x) => s + (x - mean) ** 2, 0) / exps.length) || 1;
  for (const t of transactions || []) {
    if (t.type !== 'expense' || (t.status && t.status !== 'completed')) continue;
    const z = (Number(t.amount || 0) - mean) / sd;
    if (z >= 3) flags.push({ kind: 'unusual-amount', severity: 'medium', ids: [t.id], date: t.date, amount: t.amount, merchant: t.merchant, category: t.category, reason: `₹${t.amount} is ${z.toFixed(1)}σ above your mean ₹${Math.round(mean)}. Confirm it's legitimate.` });
  }
  return flags;
}

export function flagMissingCategories(transactions) {
  return (transactions || []).filter((t) => !t.category || t.category === 'Uncategorized')
    .map((t) => ({ kind: 'missing-category', severity: 'low', ids: [t.id], date: t.date, amount: t.amount, merchant: t.merchant, reason: 'No category set — categorization improves budgets and reports.' }));
}

export function flagMissingRefunds(transactions) {
  // expense with tag expect-refund but no matching refund within 30d
  const flags = [];
  for (const t of transactions || []) {
    if (!((t.tags || []).includes('expect-refund'))) continue;
    const match = (transactions || []).some((r) => r.type === 'refund' && r.merchant === t.merchant && r.date >= t.date && (Date.parse(r.date) - Date.parse(t.date)) / 86400000 <= 45);
    if (!match) flags.push({ kind: 'refund-missing', severity: 'medium', ids: [t.id], date: t.date, amount: t.amount, merchant: t.merchant, reason: 'Tagged expect-refund but no matching refund found within 45 days.' });
  }
  return flags;
}

export function detectiveInbox(transactions, recurring = []) {
  const all = [
    ...flagDuplicates(transactions),
    ...flagBillChanges(transactions, recurring),
    ...flagUnusualAmounts(transactions),
    ...flagMissingCategories(transactions),
    ...flagMissingRefunds(transactions),
  ];
  const order = { high: 0, medium: 1, low: 2 };
  return all.sort((a, b) => order[a.severity] - order[b.severity]);
}
