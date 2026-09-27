// Loans, assets & net-worth engine — pure, paise-exact, no I/O.
// Shared by AssetsDebtPage and tests/assets.test.mjs.
// Conventions: money is INTEGER paise; dates are YYYY-MM-DD calendar days.
// Reducing-balance, monthly rests; each month's interest is rounded to the
// nearest paise (documented assumption — a lender's schedule may differ by
// paise-level rounding or rest conventions).
// Note: ASSET_TYPES (account direction set) already exists in server.js —
// these register-specific names avoid that collision.
export const ASSET_REGISTER_TYPES = [
  'cash', 'bank', 'fixed_deposit', 'investment', 'gold', 'property', 'vehicle', 'other'
];
export const LIABILITY_REGISTER_TYPES = [
  'personal_loan', 'education_loan', 'home_loan', 'vehicle_loan', 'credit_card', 'other_debt'
];
export const STALE_AFTER_DAYS = 90;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MONTHS = 1200;

export function isValidDate(d) {
  if (!DATE_RE.test(String(d || ''))) return false;
  const [y, m, dd] = String(d).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === dd;
}

export function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const dim = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, dim);
  const out = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day));
  return out.toISOString().slice(0, 10);
}

// Standard EMI for P paise, annual %, n months (rounded to paise).
export function emiFor(principalPaise, annualRatePct, months) {
  const P = Math.max(0, Math.round(Number(principalPaise) || 0));
  const n = Math.max(0, Math.floor(Number(months) || 0));
  const r = Math.max(0, Number(annualRatePct) || 0) / 1200;
  if (P <= 0 || n <= 0) return 0;
  if (r <= 0) return Math.ceil(P / n);
  const pow = Math.pow(1 + r, n);
  return Math.round((P * r * pow) / (pow - 1));
}

// Full amortization from CURRENT outstanding. Extra monthly + one-time
// prepayments {date, paise} are applied together with that month's EMI.
// Returns schedule + totals + payoff date + explicit assumptions. If the EMI
// cannot cover monthly interest, the loan is flagged unpayable (no infinite
// loop) instead of inventing a payoff date.
export function amortize({ principalPaise, annualRatePct, emiPaise, startDate, extraMonthlyPaise = 0, prepayments = [] }) {
  const assumptions = [
    'Reducing-balance, monthly rests; interest rounded to paise each month.',
    'Extra payments apply with that month\u2019s EMI.',
    'Estimate only — lender schedules may differ by rounding/rest conventions.'
  ];
  const P = Math.max(0, Math.round(Number(principalPaise) || 0));
  const rate = Math.max(0, Number(annualRatePct) || 0);
  const emi = Math.max(0, Math.round(Number(emiPaise) || 0));
  const extra = Math.max(0, Math.round(Number(extraMonthlyPaise) || 0));
  if (P <= 0) return { schedule: [], months: 0, payoffDate: startDate, totalInterestPaise: 0, totalPaidPaise: 0, assumptions };
  if (emi <= 0 && extra <= 0) {
    return { schedule: [], months: 0, payoffDate: null, totalInterestPaise: 0, totalPaidPaise: 0, unpayable: true, assumptions: [...assumptions, 'No payment configured — balance never falls.'] };
  }
  const r = rate / 1200;
  const preByMonth = {};
  for (const p of prepayments || []) {
    if (!p || !isValidDate(p.date)) continue;
    const k = String(p.date).slice(0, 7);
    preByMonth[k] = (preByMonth[k] || 0) + Math.max(0, Math.round(Number(p.paise) || 0));
  }
  const schedule = [];
  let balance = P, totalInterest = 0, totalPaid = 0, m = 0;
  let date = startDate;
  while (balance > 0 && m < MAX_MONTHS) {
    m += 1;
    const interest = Math.round(balance * r);
    if (emi + extra <= interest && r > 0) {
      return {
        schedule, months: m, payoffDate: null, totalInterestPaise: totalInterest,
        totalPaidPaise: totalPaid, unpayable: true,
        assumptions: [...assumptions, `Payment \u20B9${((emi + extra) / 100).toFixed(0)} does not cover monthly interest \u20B9${(interest / 100).toFixed(0)} — balance would grow forever.`]
      };
    }
    let pay = emi + extra + (preByMonth[date.slice(0, 7)] || 0);
    let princ = pay - interest;
    if (princ > balance) { princ = balance; pay = princ + interest; } // final dust
    balance -= princ;
    totalInterest += interest;
    totalPaid += pay;
    schedule.push({ n: m, date, emiPaise: pay, interestPaise: interest, principalPaise: princ, balancePaise: Math.max(0, balance) });
    if (balance <= 0) break;
    date = addMonths(date, 1);
  }
  return {
    schedule, months: m, payoffDate: schedule.length ? schedule[schedule.length - 1].date : null,
    totalInterestPaise: totalInterest, totalPaidPaise: totalPaid, assumptions
  };
}

// Compare repayment strategies for one liability. Scenarios are data only —
// running them never touches the ledger.
export function compareScenarios(loan, { extraMonthlyPaise = 0, prepayments = [] } = {}) {
  const base = {
    principalPaise: loan.outstandingPaise, annualRatePct: loan.annualRatePct,
    emiPaise: loan.emiPaise, startDate: loan.nextDueDate || loan.startDate
  };
  const only = amortize(base);
  const withExtra = amortize({ ...base, extraMonthlyPaise });
  const withPre = amortize({ ...base, prepayments });
  const withBoth = amortize({ ...base, extraMonthlyPaise, prepayments });
  const rows = [
    { key: 'emi', label: 'EMI only', ...only },
    { key: 'extra', label: 'EMI + extra monthly', ...withExtra },
    { key: 'prepay', label: 'EMI + one-time prepayment', ...withPre },
    { key: 'both', label: 'EMI + extra + prepayment', ...withBoth }
  ];
  return rows.map((s) => ({
    key: s.key, label: s.label, months: s.months, payoffDate: s.payoffDate,
    totalInterestPaise: s.totalInterestPaise, totalPaidPaise: s.totalPaidPaise,
    unpayable: !!s.unpayable,
    interestSavedVsEmiPaise: (only.totalInterestPaise ?? 0) - (s.totalInterestPaise ?? 0),
    assumptions: s.assumptions
  }));
}

// Net worth = assets − liabilities (integer paise throughout).
// - Linked assets use the LIVE account balance (one authoritative source —
//   never valuePaise + balance together).
// - Unlinked assets use the manual estimate and are flagged estimates.
// - credit_card liabilities are EXCLUDED (tracked via card accounts) with an
//   explicit note, so card debt can never double-count.
// - status: 'complete' | 'partial' (+ estimate share for transparency).
export function netWorth({ assets = [], liabilities = [], balances = [], asOf = null }) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const balByName = new Map((balances || []).map((b) => [b.name, b]));
  const assetRows = [];
  let totalAssets = 0, estimatePaise = 0;
  const flags = [];
  for (const a of assets) {
    if (!a) continue;
    if (a.linkedAccount) {
      const live = balByName.get(a.linkedAccount);
      if (live && Number.isFinite(Number(live.balancePaise))) {
        const v = Math.round(Number(live.balancePaise));
        totalAssets += v;
        assetRows.push({ id: a.id, name: a.name, type: a.type, valuePaise: v, source: 'linked', stale: false });
        continue;
      }
      flags.push(`“${a.name}”: linked account “${a.linkedAccount}” not found — using manual estimate`);
    }
    const v = Math.max(0, Math.round(Number(a.valuePaise) || 0));
    totalAssets += v;
    estimatePaise += v;
    const stale = !a.valuationDate || daysBetween(a.valuationDate, today) > STALE_AFTER_DAYS;
    if (stale) flags.push(`“${a.name}”: valuation stale${a.valuationDate ? ` (${a.valuationDate})` : ' (no date)'}`);
    assetRows.push({ id: a.id, name: a.name, type: a.type, valuePaise: v, source: 'estimate', stale });
  }
  const liabilityRows = [];
  const excluded = [];
  let totalLiabilities = 0;
  for (const l of liabilities || []) {
    if (!l) continue;
    if (l.type === 'credit_card') {
      excluded.push({ id: l.id, name: l.name, reason: 'tracked via card accounts — add the card under Accounts & Wallets' });
      continue;
    }
    const v = Math.max(0, Math.round(Number(l.outstandingPaise) || 0));
    totalLiabilities += v;
    const stale = !l.updatedAt || daysBetween(l.updatedAt.slice(0, 10), today) > STALE_AFTER_DAYS;
    if (stale) flags.push(`“${l.name}”: outstanding last updated ${l.updatedAt ? l.updatedAt.slice(0, 10) : 'never'} — confirm with lender`);
    liabilityRows.push({ id: l.id, name: l.name, type: l.type, outstandingPaise: v, stale });
  }
  const net = totalAssets - totalLiabilities;
  const byType = {};
  for (const r of assetRows) byType[r.type] = (byType[r.type] || 0) + r.valuePaise;
  const debtByType = {};
  for (const r of liabilityRows) debtByType[r.type] = (debtByType[r.type] || 0) + r.outstandingPaise;
  return {
    totalAssetsPaise: totalAssets,
    totalLiabilitiesPaise: totalLiabilities,
    netWorthPaise: net,
    debtToAssetPct: totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : null,
    estimatePaise,
    estimateSharePct: totalAssets > 0 ? (estimatePaise / totalAssets) * 100 : 0,
    status: flags.length === 0 ? 'complete' : 'partial',
    flags,
    assets: assetRows,
    liabilities: liabilityRows,
    excluded,
    allocation: Object.entries(byType).map(([type, paise]) => ({ type, paise })),
    debtMix: Object.entries(debtByType).map(([type, paise]) => ({ type, paise }))
  };
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
