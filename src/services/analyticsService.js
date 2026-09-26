// ─────────────────────────────────────────────────────────────
// analyticsService.js — single validated analytics service.
// ALL charts and reports MUST use these functions so totals agree.
// Pure ESM, no React dependency (importable from node:test too).
// ─────────────────────────────────────────────────────────────

export const CATEGORIES = [
  'Food', 'Transportation', 'Housing', 'Shopping', 'Health',
  'Education', 'Entertainment', 'Financial', 'Family', 'Business', 'Miscellaneous'
];

export const SUBCATEGORIES = {
  Food: ['Groceries', 'Restaurants', 'Food delivery', 'Snacks', 'Tea and coffee'],
  Transportation: ['Fuel', 'Cab', 'Metro', 'Parking', 'Maintenance'],
  Housing: ['Rent', 'Electricity', 'Water', 'Internet', 'Maintenance'],
  Shopping: ['Clothing', 'Electronics', 'Home goods', 'Online', 'Gifts'],
  Health: ['Pharmacy', 'Doctor', 'Lab tests', 'Insurance', 'Fitness'],
  Education: ['Fees', 'Books', 'Courses', 'Stationery', 'Exam'],
  Entertainment: ['Movies', 'Streaming', 'Games', 'Outings', 'Sports'],
  Financial: ['Fees', 'Interest', 'Investment', 'Tax', 'Charges'],
  Family: ['Kids', 'Parents', 'Festivals', 'Gifts', 'Support'],
  Business: ['Travel', 'Supplies', 'Software', 'Meals', 'Marketing'],
  Miscellaneous: ['Other', 'Unplanned', 'Donation', 'Personal', 'Repairs']
};

export const PAYMENT_METHODS = [
  'UPI', 'Cash', 'Debit card', 'Credit card', 'Bank transfer', 'Wallet'
];

export const CATEGORY_COLORS = {
  Food: '#f59e0b',
  Transportation: '#3b82f6',
  Housing: '#8b5cf6',
  Shopping: '#ec4899',
  Health: '#10b981',
  Education: '#06b6d4',
  Entertainment: '#f97316',
  Financial: '#6366f1',
  Family: '#84cc16',
  Business: '#14b8a6',
  Miscellaneous: '#9ca3af',
  Others: '#d1d5db'
};

// Categories treated as essential (vs discretionary) for behaviour insights.
export const ESSENTIAL_CATEGORIES = new Set([
  'Food', 'Transportation', 'Housing', 'Health', 'Education', 'Financial', 'Family'
]);

// ── Date helpers (timezone-consistent, Asia/Kolkata day boundaries) ──
// We store dates as 'YYYY-MM-DD' calendar days in Asia/Kolkata. All range
// comparisons are lexicographic on that string, which is exact and avoids
// JS Date timezone drift. "Today" is computed in Asia/Kolkata.

export function todayISO(timezone = 'Asia/Kolkata', now = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    });
    return fmt.format(now); // YYYY-MM-DD
  } catch {
    const d = now;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, lastDay));
  return dt.toISOString().slice(0, 10);
}

export function startOfMonthISO(iso) { return iso.slice(0, 8) + '01'; }
export function endOfMonthISO(iso) {
  const [y, m] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
export function startOfWeekISO(iso, weekStart = 1) {
  // weekStart 1 = Monday. Returns Monday of that week.
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  let dow = dt.getUTCDay(); // 0 Sun
  dow = (dow + 6) % 7; // 0 Mon
  const diff = dow - (weekStart - 1);
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(start, end) {
  const ms = Date.parse(end) - Date.parse(start);
  return Math.round(ms / 86400000) + 1;
}

export function monthKey(iso) { return iso.slice(0, 7); } // YYYY-MM

export function formatINR(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0
  }).format(n);
}

export function formatPct(x) {
  if (x === null || x === undefined) return 'n/a';
  return `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
}

// ── Date-range presets (§1) ──

export const RANGE_PRESETS = [
  'this-week', 'last-7-days', 'this-month', 'last-month',
  'last-3-months', 'last-6-months', 'this-year', 'financial-year', 'custom'
];

export function getDateRange(preset, opts = {}) {
  const now = opts.now || todayISO();
  let start, end, label;
  switch (preset) {
    case 'this-week': {
      start = startOfWeekISO(now); end = now; label = 'This week (Mon–today)'; break;
    }
    case 'last-7-days': {
      start = addDaysISO(now, -6); end = now; label = 'Last 7 days'; break;
    }
    case 'this-month': {
      start = startOfMonthISO(now); end = now; label = 'This month'; break;
    }
    case 'last-month': {
      const first = addMonthsISO(startOfMonthISO(now), -1);
      start = first; end = endOfMonthISO(first); label = 'Last month'; break;
    }
    case 'last-3-months': {
      start = addMonthsISO(startOfMonthISO(now), -2); end = now; label = 'Last 3 months'; break;
    }
    case 'last-6-months': {
      start = addMonthsISO(startOfMonthISO(now), -5); end = now; label = 'Last 6 months'; break;
    }
    case 'this-year': {
      start = now.slice(0, 4) + '-01-01'; end = now; label = 'This year'; break;
    }
    case 'financial-year': {
      // April–March
      const y = Number(now.slice(0, 4)); const m = Number(now.slice(5, 7));
      const fyStart = m >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
      start = fyStart; end = now; label = `FY ${fyStart.slice(0, 4)}–${Number(fyStart.slice(0, 4)) + 1}`; break;
    }
    case 'custom': {
      start = opts.customStart; end = opts.customEnd; label = 'Custom range'; break;
    }
    default: throw new Error(`Unknown preset: ${preset}`);
  }
  if (!start || !end) throw new Error('Custom range requires customStart/customEnd');
  if (start > end) throw new Error('Range start must be <= end');
  return { start, end, label: label || preset, preset };
}

/** Same-length period immediately before [start,end]. */
export function previousPeriodRange({ start, end }) {
  const len = daysBetweenInclusive(start, end);
  const prevEnd = addDaysISO(start, -1);
  const prevStart = addDaysISO(prevEnd, -(len - 1));
  return { start: prevStart, end: prevEnd };
}

/** True when the range is still in progress (end >= today). */
export function isRangeComplete(range, now) {
  const today = now || todayISO();
  return range.end < today;
}

// ── Ledger filtering (§9 data-accuracy rules) ──

export function isTransfer(t) {
  return t.type === 'transfer' || t.isCreditCardRepayment === true;
}

/** Expense included in totals? Transfers, pending/scheduled excluded by default. */
export function isIncludedExpense(t, opts = {}) {
  const includePending = opts.includePending === true;
  if (isTransfer(t)) return false;
  if (!includePending && t.status && t.status !== 'completed') return false;
  if (t.type === 'expense') {
    if (!opts.includeUncategorized && isUncategorized(t)) return false;
    return true;
  }
  if (t.type === 'refund') return true; // negative expense
  return false;
}

export function isIncludedIncome(t, opts = {}) {
  const includePending = opts.includePending === true;
  if (isTransfer(t)) return false;
  if (!includePending && t.status && t.status !== 'completed') return false;
  if (t.type !== 'income') return false;
  if (!opts.includeUncategorized && isUncategorized(t)) return false;
  return true;
}

export function isUncategorized(t) {
  return !t.category || t.category === 'Uncategorized';
}

/** Signed expense contribution: expense +amount, refund −amount. */
export function expenseSignedAmount(t) {
  if (t.type === 'refund') return -Math.abs(t.amount);
  return Math.abs(t.amount);
}

export function filterLedger(transactions, opts = {}) {
  const {
    start, end, accounts, paymentMethods, merchants, categories, subcategories,
    includePending = false, includeUncategorized = true
  } = opts;
  return transactions.filter((t) => {
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (accounts && accounts.length && !accounts.includes(t.account)) return false;
    if (paymentMethods && paymentMethods.length && !paymentMethods.includes(t.paymentMethod)) return false;
    if (merchants && merchants.length && !merchants.includes(t.merchant)) return false;
    if (categories && categories.length && !categories.includes(t.category)) return false;
    if (subcategories && subcategories.length && !subcategories.includes(t.subcategory)) return false;
    if (!includePending && t.status && t.status !== 'completed') return false;
    if (!includeUncategorized && isUncategorized(t)) return false;
    return true;
  });
}

// ── Summaries (§1 top cards) ──

export function summarizeLedger(transactions, range, opts = {}) {
  const now = opts.now;
  const scoped = filterLedger(transactions, { ...opts, start: range.start, end: range.end });
  let totalSpending = 0, totalIncome = 0, count = 0;
  let largest = null;
  const byCat = {};
  for (const t of scoped) {
    if (isIncludedExpense(t, opts)) {
      const s = expenseSignedAmount(t);
      totalSpending += s;
      count += 1;
      const c = t.category || 'Uncategorized';
      byCat[c] = (byCat[c] || 0) + s;
      if (!largest || Math.abs(t.amount) > Math.abs(largest.amount)) largest = t;
    } else if (isIncludedIncome(t, opts)) {
      totalIncome += Math.abs(t.amount);
      count += 1;
    }
  }
  totalSpending = totalSpending; // signed: refunds reduce totals (may be negative in narrow windows)
  const netCashFlow = totalIncome - totalSpending;
  const days = Math.max(1, daysBetweenInclusive(range.start, range.end));
  const avgDailySpending = totalSpending / days;
  let highestCategory = null, highestAmount = 0;
  for (const [c, v] of Object.entries(byCat)) {
    if (v > highestAmount) { highestAmount = v; highestCategory = c; }
  }
  // Previous-period comparison
  const prev = previousPeriodRange(range);
  const prevScoped = filterLedger(transactions, { ...opts, start: prev.start, end: prev.end });
  let prevSpending = 0;
  for (const t of prevScoped) if (isIncludedExpense(t, opts)) prevSpending += expenseSignedAmount(t);
  const diff = totalSpending - prevSpending;
  const pctChange = prevSpending === 0 ? null : (diff / prevSpending) * 100;

  return {
    totalSpending, totalIncome, netCashFlow, avgDailySpending,
    highestCategory, highestCategoryAmount: highestAmount,
    largestTransaction: largest, transactionCount: count,
    prevSpending, spendingDiff: diff, spendingPctChange: pctChange,
    complete: isRangeComplete(range, now),
    days
  };
}

// ── Category / subcategory / payment-method breakdowns (§2) ──

export function expenseByCategory(transactions, range, opts = {}) {
  const scoped = filterLedger(transactions, { ...opts, start: range.start, end: range.end });
  const map = {};
  let total = 0;
  for (const t of scoped) {
    if (!isIncludedExpense(t, opts)) continue;
    const c = t.category || 'Uncategorized';
    const s = expenseSignedAmount(t);
    map[c] = (map[c] || 0) + s;
  }
  for (const v of Object.values(map)) total += v;
  // Signed total: refunds reduce spending and may drive narrow windows negative.
  // Charts render positive slices; the ledger, legend and tables show signed values.
  const rows = Object.entries(map)
    .filter(([, v]) => v !== 0)
    .map(([category, amount]) => ({
      category,
      amount,
      share: total !== 0 ? (amount / total) * 100 : 0,
      color: CATEGORY_COLORS[category] || '#9ca3af'
    }))
    .sort((a, b) => b.amount - a.amount);
  return { rows, total };
}

/** Group slices below thresholdPct into "Others" for display only. */
export function groupSmallSlices(rows, thresholdPct = 3) {
  const small = rows.filter((r) => r.share < thresholdPct);
  const big = rows.filter((r) => r.share >= thresholdPct);
  if (small.length <= 1) return rows;
  const amount = small.reduce((s, r) => s + r.amount, 0);
  const share = small.reduce((s, r) => s + r.share, 0);
  return [...big, {
    category: 'Others', amount, share, color: CATEGORY_COLORS.Others,
    groupedFrom: small.map((r) => r.category)
  }];
}

export function subcategoryBreakdown(transactions, range, category, opts = {}) {
  const scoped = filterLedger(transactions, { ...opts, start: range.start, end: range.end });
  const map = {};
  let total = 0;
  for (const t of scoped) {
    if (!isIncludedExpense(t, opts)) continue;
    if ((t.category || 'Uncategorized') !== category) continue;
    const s = t.subcategory || 'General';
    map[s] = (map[s] || 0) + expenseSignedAmount(t);
  }
  for (const v of Object.values(map)) total += v;
  const rows = Object.entries(map).map(([subcategory, amount]) => ({
    subcategory, amount, share: total > 0 ? (amount / total) * 100 : 0
  })).sort((a, b) => b.amount - a.amount);
  return { rows, total, category };
}

export function paymentMethodBreakdown(transactions, range, opts = {}) {
  const scoped = filterLedger(transactions, { ...opts, start: range.start, end: range.end });
  const map = {};
  let total = 0, count = 0;
  for (const t of scoped) {
    if (!isIncludedExpense(t, opts)) continue;
    const m = t.paymentMethod || 'Uncategorized';
    const s = expenseSignedAmount(t);
    if (!map[m]) map[m] = { amount: 0, count: 0 };
    map[m].amount += s; map[m].count += 1;
    total += s; count += 1;
  }
  const rows = Object.entries(map).map(([method, v]) => ({
    method, ...v, share: total > 0 ? (v.amount / total) * 100 : 0
  })).sort((a, b) => b.amount - a.amount);
  return { rows, total, count };
}

// ── Time series (§3) ──

export function enumerateDays(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) { out.push(cur); cur = addDaysISO(cur, 1); }
  return out;
}

export function dailySeries(transactions, range, opts = {}) {
  // No interpolation: every day in range gets a bucket; zero means
  // "no recorded activity that day" (a confirmed no-activity date
  // within the selected aggregation), not an estimate.
  const days = enumerateDays(range.start, range.end);
  const exp = Object.fromEntries(days.map((d) => [d, 0]));
  const inc = Object.fromEntries(days.map((d) => [d, 0]));
  const scoped = filterLedger(transactions, { ...opts, start: range.start, end: range.end });
  for (const t of scoped) {
    if (!(t.date in exp)) continue;
    if (isIncludedExpense(t, opts)) exp[t.date] += expenseSignedAmount(t);
    else if (isIncludedIncome(t, opts)) inc[t.date] += Math.abs(t.amount);
  }
  let cum = 0;
  return days.map((date) => {
    cum += exp[date];
    return { date, expense: exp[date], income: inc[date], net: inc[date] - exp[date], cumulative: cum };
  });
}

export function isoWeekKey(iso) { return startOfWeekISO(iso); }
export function quarterKey(iso) {
  const y = iso.slice(0, 4); const q = Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;
  return `${y}-Q${q}`;
}

/** Aggregate daily points into weekly / monthly / quarterly / yearly buckets. */
export function aggregateSeries(dailyPoints, granularity) {
  if (granularity === 'daily') return dailyPoints;
  const buckets = new Map();
  for (const p of dailyPoints) {
    let key;
    if (granularity === 'weekly') key = isoWeekKey(p.date);
    else if (granularity === 'monthly') key = monthKey(p.date);
    else if (granularity === 'quarterly') key = quarterKey(p.date);
    else if (granularity === 'yearly') key = p.date.slice(0, 4);
    else throw new Error(`Unknown granularity: ${granularity}`);
    if (!buckets.has(key)) buckets.set(key, { date: key, expense: 0, income: 0, net: 0 });
    const b = buckets.get(key);
    b.expense += p.expense; b.income += p.income; b.net += p.net;
  }
  const rows = [...buckets.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  let cum = 0;
  return rows.map((r) => { cum += r.expense; return { ...r, cumulative: cum }; });
}

export function autoGranularity(range) {
  const days = daysBetweenInclusive(range.start, range.end);
  if (days <= 45) return 'daily';
  if (days <= 200) return 'weekly';
  if (days <= 800) return 'monthly';
  return 'quarterly';
}

export function monthlySeries(transactions, range, opts = {}) {
  const daily = dailySeries(transactions, range, opts);
  const rows = aggregateSeries(daily, 'monthly');
  // Backfill empty months inside the range so gaps render as zero bars.
  const want = [];
  let cur = monthKey(range.start);
  const last = monthKey(range.end);
  while (cur <= last) {
    want.push(cur);
    const [y, m] = cur.split('-').map(Number);
    const nxt = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    cur = nxt;
  }
  const byKey = Object.fromEntries(rows.map((r) => [r.date, r]));
  return want.map((k) => byKey[k] || { date: k, expense: 0, income: 0, net: 0, cumulative: 0 });
}

// ── Bar-chart analytics (§4) ──

export function weekdayAnalysis(transactions, range, opts = {}) {
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const totals = names.map((day) => ({ day, total: 0, count: 0 }));
  const scoped = filterLedger(transactions, { ...opts, start: range.start, end: range.end });
  // Count occurrences of each weekday inside the range for averages.
  const occ = [0, 0, 0, 0, 0, 0, 0];
  for (const d of enumerateDays(range.start, range.end)) {
    const [y, m, dd] = d.split('-').map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7;
    occ[dow] += 1;
  }
  for (const t of scoped) {
    if (!isIncludedExpense(t, opts)) continue;
    const [y, m, dd] = t.date.split('-').map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7;
    totals[dow].total += expenseSignedAmount(t);
    totals[dow].count += 1;
  }
  return totals.map((r, i) => ({
    ...r,
    average: occ[i] > 0 ? r.total / occ[i] : 0,
    occurrences: occ[i]
  }));
}

export function budgetComparison(expByCat, budgets) {
  // budgets: { [category]: number }
  const cats = new Set([...expByCat.map((r) => r.category), ...Object.keys(budgets)]);
  return [...cats].map((category) => {
    const actual = expByCat.find((r) => r.category === category)?.amount || 0;
    const budget = budgets[category] || 0;
    return {
      category, budget, actual,
      remaining: budget - actual,
      overBudget: budget > 0 && actual > budget
    };
  }).sort((a, b) => b.actual - a.actual);
}

// ── Comparisons (§5) ──

export function pctChange(current, previous) {
  if (previous === 0) return null; // unavailable — never divide by zero
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function compareRanges(transactions, currRange, prevRange, opts = {}) {
  const c = summarizeLedger(transactions, currRange, { ...opts, now: opts.now });
  const p = summarizeLedger(transactions, prevRange, { ...opts, now: opts.now });
  return {
    current: c, previous: p,
    spendingDiff: c.totalSpending - p.totalSpending,
    spendingPct: pctChange(c.totalSpending, p.totalSpending),
    incomeDiff: c.totalIncome - p.totalIncome,
    incomePct: pctChange(c.totalIncome, p.totalIncome)
  };
}

// ── Behaviour insights (§6) ──

export function behaviourInsights(transactions, range, opts = {}) {
  const insights = [];
  const s = summarizeLedger(transactions, range, { ...opts, now: opts.now });
  const prev = previousPeriodRange(range);
  const explain = (text, calc) => ({ text, calculation: calc });
  const days = s.days;

  if (s.transactionCount < 3) {
    return [{ text: 'Not enough data for insights yet — add more transactions.', calculation: `Only ${s.transactionCount} transaction(s) in range.` }];
  }

  if (s.highestCategory) {
    const share = s.totalSpending > 0 ? (s.highestCategoryAmount / s.totalSpending) * 100 : 0;
    insights.push(explain(
      `${s.highestCategory} is your highest spending category at ${formatINR(s.highestCategoryAmount)} (${share.toFixed(0)}% of recorded expenses).`,
      `Highest category total ÷ included expense total (${formatINR(s.highestCategoryAmount)} ÷ ${formatINR(s.totalSpending)}). Transfers and pending excluded.`
    ));
  }

  // Category movers vs previous period
  const cur = expenseByCategory(transactions, range, opts);
  const prv = expenseByCategory(transactions, prev, opts);
  for (const r of cur.rows.slice(0, 6)) {
    const p = prv.rows.find((x) => x.category === r.category);
    const pAmt = p ? p.amount : 0;
    if (pAmt === 0 && r.amount > 0 && prv.total > 0) {
      insights.push(explain(
        `${r.category} spending is new this period at ${formatINR(r.amount)} (no spending in previous period).`,
        `Current ${formatINR(r.amount)} vs previous ${formatINR(0)}. % change unavailable (zero denominator).`
      ));
    } else if (pAmt > 0) {
      const d = r.amount - pAmt;
      if (Math.abs(d) >= Math.max(100, pAmt * 0.1)) {
        const dir = d > 0 ? 'higher' : 'lower';
        insights.push(explain(
          `${r.category} spending is ${formatINR(Math.abs(d))} ${dir} than the previous period.`,
          `Current ${formatINR(r.amount)} − previous ${formatINR(pAmt)} = ${formatINR(d)}. Same ledger filters applied to both periods.`
        ));
      }
    }
  }

  // Most frequent merchant + most expensive transaction
  const scoped = filterLedger(transactions, { ...opts, start: range.start, end: range.end })
    .filter((t) => isIncludedExpense(t, opts));
  const merchCount = {};
  for (const t of scoped) {
    const k = t.merchant || 'Unknown';
    merchCount[k] = (merchCount[k] || 0) + 1;
  }
  const topMerch = Object.entries(merchCount).sort((a, b) => b[1] - a[1])[0];
  if (topMerch && topMerch[1] >= 2) {
    insights.push(explain(
      `Most frequent merchant: ${topMerch[0]} (${topMerch[1]} transactions).`,
      `Count of included expense transactions grouped by merchant within range.`
    ));
  }
  if (s.largestTransaction) {
    insights.push(explain(
      `Largest transaction: ${formatINR(Math.abs(s.largestTransaction.amount))} at ${s.largestTransaction.merchant || 'unknown merchant'} (${s.largestTransaction.category || 'Uncategorized'}).`,
      `Max by absolute amount among ${s.transactionCount} included income/expense transactions.`
    ));
  }
  if (s.transactionCount > 0) {
    const avgTx = s.totalSpending / Math.max(1, scoped.length);
    insights.push(explain(
      `Average expense transaction: ${formatINR(avgTx)}; average daily spending: ${formatINR(s.avgDailySpending)}.`,
      `Total spending ${formatINR(s.totalSpending)} ÷ ${scoped.length} expense txns; ÷ ${days} days in range.`
    ));
  }

  // Essential vs discretionary
  let essential = 0, discretionary = 0;
  for (const r of cur.rows) {
    if (ESSENTIAL_CATEGORIES.has(r.category)) essential += r.amount;
    else if (r.category !== 'Uncategorized') discretionary += r.amount;
  }
  if (essential + discretionary > 0) {
    const pct = ((discretionary / (essential + discretionary)) * 100).toFixed(0);
    insights.push(explain(
      `Discretionary spending is ${pct}% of classified expenses; the rest is essential.`,
      `Essential = ${[...ESSENTIAL_CATEGORIES].join(', ')}. Discretionary ÷ classified total.`
    ));
  }

  // Payment-method frequency change
  const curPay = paymentMethodBreakdown(transactions, range, opts);
  const prevPay = paymentMethodBreakdown(transactions, prev, opts);
  const upiCur = curPay.rows.find((r) => r.method === 'UPI');
  const upiPrev = prevPay.rows.find((r) => r.method === 'UPI');
  if (upiCur && upiPrev && Math.abs(upiCur.count - upiPrev.count) >= 3) {
    const d = upiCur.count - upiPrev.count;
    insights.push(explain(
      `You made ${Math.abs(d)} ${d > 0 ? 'more' : 'fewer'} UPI payments than in the previous period.`,
      `UPI txn count current (${upiCur.count}) vs previous (${upiPrev.count}).`
    ));
  }

  // Highest-spend day
  const daily = dailySeries(transactions, range, opts);
  const peak = [...daily].sort((a, b) => b.expense - a.expense)[0];
  if (peak && peak.expense > 0) {
    insights.push(explain(
      `Highest spending day: ${peak.date} at ${formatINR(peak.expense)}.`,
      `Max daily expense bucket in range; zero days mean no recorded activity, not estimates.`
    ));
  }

  return insights;
}

// ── Category detail (§7) ──

export function categoryDetail(transactions, range, category, opts = {}) {
  const exp = expenseByCategory(transactions, range, opts);
  const row = exp.rows.find((r) => r.category === category);
  const amount = row ? row.amount : 0;
  const share = row ? row.share : 0;
  const scoped = filterLedger(transactions, { ...opts, start: range.start, end: range.end })
    .filter((t) => (t.category || 'Uncategorized') === category);
  const merchants = {};
  const payMethods = {};
  for (const t of scoped) {
    if (!isIncludedExpense(t, opts)) continue;
    const mk = t.merchant || 'Unknown';
    merchants[mk] = (merchants[mk] || 0) + expenseSignedAmount(t);
    const pm = t.paymentMethod || 'Uncategorized';
    payMethods[pm] = (payMethods[pm] || 0) + expenseSignedAmount(t);
  }
  const prev = previousPeriodRange(range);
  const prevExp = expenseByCategory(transactions, prev, opts);
  const prevAmt = prevExp.rows.find((r) => r.category === category)?.amount || 0;
  const txns = scoped
    .filter((t) => isIncludedExpense(t, opts) || isIncludedIncome(t, opts))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    category, amount, share,
    transactionCount: txns.length,
    subcategories: subcategoryBreakdown(transactions, range, category, opts),
    merchants: Object.entries(merchants).map(([merchant, total]) => ({ merchant, total }))
      .sort((a, b) => b.total - a.total),
    paymentMethods: Object.entries(payMethods).map(([method, total]) => ({ method, total }))
      .sort((a, b) => b.total - a.total),
    trend: monthlySeries(
      transactions.filter((t) => (t.category || 'Uncategorized') === category), range, opts
    ),
    daily: dailySeries(
      transactions.filter((t) => (t.category || 'Uncategorized') === category), range, opts
    ),
    prevAmount: prevAmt,
    diff: amount - prevAmt,
    pct: pctChange(amount, prevAmt),
    transactions: txns
  };
}

// ── Reconciliation (§9/§11): chart totals must equal ledger totals ──

export function ledgerTotals(transactions, range, opts = {}) {
  // Independent calculation: single pass, no chart helpers.
  let expense = 0, income = 0;
  for (const t of transactions) {
    if (opts.start && t.date < opts.start) continue;
    if (opts.end && t.date > opts.end) continue;
    if (!opts.includePending && t.status && t.status !== 'completed') continue;
    if (isTransfer(t)) continue;
    if (!opts.includeUncategorized && isUncategorized(t)) continue;
    if (t.type === 'expense') expense += Math.abs(t.amount);
    else if (t.type === 'refund') expense -= Math.abs(t.amount);
    else if (t.type === 'income') income += Math.abs(t.amount);
  }
  return { expense, income };
}

export function validateReconciliation(transactions, range, opts = {}) {
  const ledger = ledgerTotals(transactions, range.start ? undefined : undefined, { ...opts, start: range.start, end: range.end });
  const byCat = expenseByCategory(transactions, range, opts);
  const pay = paymentMethodBreakdown(transactions, range, opts);
  const daily = dailySeries(transactions, range, opts);
  const dailySum = daily.reduce((s, d) => s + d.expense, 0);
  const monthly = monthlySeries(transactions, range, opts);
  const monthlySum = monthly.reduce((s, m) => s + m.expense, 0);
  const errors = [];
  const close = (a, b) => Math.abs(a - b) < 0.01;
  if (!close(byCat.total, ledger.expense)) errors.push(`category total ${byCat.total} != ledger ${ledger.expense}`);
  if (!close(pay.total, ledger.expense)) errors.push(`payment total ${pay.total} != ledger ${ledger.expense}`);
  if (!close(dailySum, ledger.expense)) errors.push(`daily total ${dailySum} != ledger ${ledger.expense}`);
  if (!close(monthlySum, ledger.expense)) errors.push(`monthly total ${monthlySum} != ledger ${ledger.expense}`);
  const pctSum = byCat.rows.reduce((s, r) => s + r.share, 0);
  if (byCat.total > 0 && byCat.rows.length > 0 && Math.abs(pctSum - 100) > 0.6) errors.push(`shares sum to ${pctSum}, expected 100`);
  return { ok: errors.length === 0, errors, ledger };
}
