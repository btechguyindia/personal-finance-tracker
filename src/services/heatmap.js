// heatmap.js — P1 #4 Spending heatmap + money timeline. Pure ESM.
export function dailyTotals(transactions, start, end) {
  const map = new Map();
  for (const t of transactions || []) {
    if (t.date < start || t.date > end) continue;
    if (t.status && t.status !== 'completed') continue;
    const signed = t.type === 'income' ? Number(t.amount || 0) : t.type === 'expense' ? -Number(t.amount || 0) : t.type === 'refund' ? Number(t.amount || 0) : 0;
    if (!map.has(t.date)) map.set(t.date, { date: t.date, spent: 0, income: 0, net: 0, count: 0 });
    const d = map.get(t.date);
    if (t.type === 'expense') d.spent += Number(t.amount || 0);
    if (t.type === 'income') d.income += Number(t.amount || 0);
    d.net += signed;
    d.count += 1;
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function weekdayStats(transactions) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const agg = days.map((day) => ({ day, spent: 0, count: 0 }));
  for (const t of transactions || []) {
    if (t.type !== 'expense' || (t.status && t.status !== 'completed')) continue;
    const dow = new Date(t.date + 'T00:00:00Z').getUTCDay();
    agg[dow].spent += Number(t.amount || 0);
    agg[dow].count += 1;
  }
  const sorted = [...agg].sort((a, b) => b.spent - a.spent);
  return { all: agg, highest: sorted[0], lowest: sorted[sorted.length - 1] };
}

export function streaks(transactions, end) {
  const spentDays = new Set((transactions || []).filter((t) => t.type === 'expense' && (!t.status || t.status === 'completed')).map((t) => t.date));
  // no-spend days streak ending at `end` (walk back while day has no spend — needs full date walk, approx via known dates)
  let noSpend = 0;
  let d = end;
  for (let i = 0; i < 60; i++) {
    if (spentDays.has(d)) break;
    noSpend++;
    d = new Date(Date.parse(d) - 86400000).toISOString().slice(0, 10);
  }
  // merchant frequency
  const merch = new Map();
  for (const t of transactions || []) {
    if (!t.merchant) continue;
    merch.set(t.merchant, (merch.get(t.merchant) || 0) + 1);
  }
  const topMerchants = [...merch.entries()].map(([merchant, count]) => ({ merchant, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  return { noSpendStreak: noSpend, topMerchants };
}

export function dayTimeline(transactions, date) {
  return (transactions || []).filter((t) => t.date === date).sort((a, b) => (a.id < b.id ? -1 : 1));
}
