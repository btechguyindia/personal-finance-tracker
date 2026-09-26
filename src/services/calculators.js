// Pure financial calculators — no I/O, no React. All amounts in rupees,
// rounded to 2 decimals at the boundary. Covered by tests/calculators.test.mjs.
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── Loan EMI ─────────────────────────────────────────────
// EMI = P·r·(1+r)^n / ((1+r)^n − 1), r = monthly rate fraction.
export function emi(principal, annualRatePct, months) {
  const P = Math.max(0, Number(principal) || 0);
  const n = Math.max(0, Math.floor(Number(months) || 0));
  const r = (Number(annualRatePct) || 0) / 1200;
  if (P <= 0 || n <= 0) return { emi: 0, totalPayment: 0, totalInterest: 0 };
  if (r <= 0) {
    const e = round2(P / n);
    return { emi: e, totalPayment: round2(e * n), totalInterest: round2(e * n - P) };
  }
  const pow = Math.pow(1 + r, n);
  const e = round2((P * r * pow) / (pow - 1));
  const totalPayment = round2(e * n);
  return { emi: e, totalPayment, totalInterest: round2(totalPayment - P) };
}

// Month-by-month schedule: { month, emi, interest, principal, balance }.
// Sums reconcile: Σprincipal ≈ P and closing balance = 0.
export function amortization(principal, annualRatePct, months) {
  const P = Math.max(0, Number(principal) || 0);
  const n = Math.max(0, Math.floor(Number(months) || 0));
  if (P <= 0 || n <= 0) return [];
  const r = Math.max(0, Number(annualRatePct) || 0) / 1200;
  const { emi: fixed } = emi(P, annualRatePct, n);
  const rows = [];
  let balance = P;
  for (let m = 1; m <= n; m++) {
    const interest = round2(balance * r);
    let princ = round2(fixed - interest);
    if (m === n || princ > balance) princ = round2(balance); // absorb rounding dust
    balance = round2(balance - princ);
    rows.push({
      month: m,
      emi: round2(princ + interest),
      interest,
      principal: princ,
      balance: Math.max(0, balance)
    });
  }
  return rows;
}

// Yearly roll-up of an amortization schedule.
export function yearlySchedule(rows) {
  const years = [];
  for (let i = 0; i < rows.length; i += 12) {
    const chunk = rows.slice(i, i + 12);
    years.push({
      year: Math.floor(i / 12) + 1,
      principal: round2(chunk.reduce((s, x) => s + x.principal, 0)),
      interest: round2(chunk.reduce((s, x) => s + x.interest, 0)),
      paid: round2(chunk.reduce((s, x) => s + x.emi, 0)),
      balance: chunk[chunk.length - 1].balance
    });
  }
  return years;
}

// ── Simple interest: I = P·R·T / 100 ──
export function simpleInterest(principal, annualRatePct, years) {
  const P = Math.max(0, Number(principal) || 0);
  const T = Math.max(0, Number(years) || 0);
  const R = Math.max(0, Number(annualRatePct) || 0);
  const interest = round2((P * R * T) / 100);
  return { interest, total: round2(P + interest) };
}

// ── Compound interest / FD maturity: A = P(1 + r/f)^(f·t) ──
export function compoundMaturity(principal, annualRatePct, years, freqPerYear = 4) {
  const P = Math.max(0, Number(principal) || 0);
  const T = Math.max(0, Number(years) || 0);
  const f = [1, 2, 4, 12].includes(Number(freqPerYear)) ? Number(freqPerYear) : 4;
  const r = Math.max(0, Number(annualRatePct) || 0) / 100;
  const maturity = r <= 0 || T <= 0 ? P : round2(P * Math.pow(1 + r / f, f * T));
  return { maturity, interest: round2(maturity - P) };
}

// ── SIP future value (payments at start of month) ──
export function sipFutureValue(monthly, annualRatePct, months) {
  const M = Math.max(0, Number(monthly) || 0);
  const n = Math.max(0, Math.floor(Number(months) || 0));
  const i = (Number(annualRatePct) || 0) / 1200;
  const invested = round2(M * n);
  if (M <= 0 || n <= 0) return { invested: 0, maturity: 0, gains: 0 };
  const maturity = i <= 0 ? invested : round2(M * ((Math.pow(1 + i, n) - 1) / i) * (1 + i));
  return { invested, maturity, gains: round2(maturity - invested) };
}

// ── Discount / price calculator ──
// Applies discount %, then an extra coupon %, then adds tax % on the net.
export function discountPrice(mrp, discountPct = 0, extraPct = 0, taxPct = 0) {
  const list = Math.max(0, Number(mrp) || 0);
  const d = Math.min(100, Math.max(0, Number(discountPct) || 0));
  const x = Math.min(100, Math.max(0, Number(extraPct) || 0));
  const t = Math.max(0, Number(taxPct) || 0);
  const afterDiscount = round2(list * (1 - d / 100));
  const afterExtra = round2(afterDiscount * (1 - x / 100));
  const tax = round2(afterExtra * (t / 100));
  const final = round2(afterExtra + tax);
  return {
    afterDiscount,
    afterExtra,
    tax,
    final,
    savings: round2(list - afterExtra),
    effectiveOffPct: list > 0 ? round2(((list - final) / list) * 100) : 0
  };
}
