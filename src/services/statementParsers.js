// ─────────────────────────────────────────────────────────────
// statementParsers.js — bank/UPI statement preset parsers.
// Pure ESM (importable from React + node:test). Converts HDFC / SBI /
// ICICI / generic-UPI CSV layouts into FinTrack ledger rows:
// { date, type, amount, category, merchant, account, description, upiRef, status }
// ─────────────────────────────────────────────────────────────

export const BANK_PRESETS = [
  { id: 'generic', label: 'Generic FinTrack CSV' },
  { id: 'hdfc', label: 'HDFC Bank statement' },
  { id: 'sbi', label: 'SBI statement' },
  { id: 'icici', label: 'ICICI Bank statement' },
  { id: 'upi', label: 'UPI app export (GPay / PhonePe / Paytm)' },
];

export function splitCSVLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; continue; }
      q = !q; continue;
    }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCSVTable(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { header: [], rows: [] };
  // Skip HDFC/SBI preamble lines until the header row (contains "date").
  let hIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (/date/i.test(lines[i])) { hIdx = i; break; }
  }
  const header = splitCSVLine(lines[hIdx]).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  const rows = lines.slice(hIdx + 1).map(splitCSVLine);
  return { header, rows };
}

function findCol(header, candidates) {
  for (const c of candidates) {
    const i = header.findIndex((h) => h === c || h.includes(c));
    if (i >= 0) return i;
  }
  return -1;
}

export function parseAmount(raw) {
  if (raw === null || raw === undefined) return 0;
  let s = String(raw).trim().replace(/["'₹\s,]/g, '');
  if (!s || s === '-' || s.toLowerCase() === 'nil') return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/cr$/i.test(s)) s = s.slice(0, -2);
  if (/dr$/i.test(s)) { neg = true; s = s.slice(0, -2); }
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
}

const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

export function parseDate(raw) {
  if (!raw) return '';
  let s = String(raw).trim().replace(/["']/g, '');
  // Already ISO.
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD-Mon-YYYY / DD Mon YYYY / DD-Mon-YY (SBI, ICICI).
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{2,4})/);
  if (m) {
    const dd = String(m[1]).padStart(2, '0');
    const mm = MON[m[2].slice(0, 3).toLowerCase()] || '01';
    let yy = m[3];
    if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
    return `${yy}-${mm}-${dd}`;
  }
  // DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY (HDFC).
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    const dd = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    let yy = m[3];
    if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
    return `${yy}-${mm}-${dd}`;
  }
  return '';
}

export function extractUpiRef(text) {
  if (!text) return '';
  const s = String(text);
  const m = s.match(/\b(\d{12}|\d{6,})\b/) || s.match(/UPI[^\d]*(\d{6,})/i) || s.match(/Ref[^A-Za-z0-9]*([A-Za-z0-9]{6,})/i);
  return m ? m[1].slice(0, 24) : '';
}

export function guessCategory(narration = '', type = 'expense') {
  const s = String(narration).toLowerCase();
  if (type === 'income') {
    if (/salary|payroll|neft.*sal|credit.*sal/.test(s)) return 'Salary';
    if (/interest|dividend/.test(s)) return 'Interest';
    if (/freelance|client|invoice/.test(s)) return 'Freelance';
    return 'Business income';
  }
  if (/swiggy|zomato|restaurant|food|grocery|bigbasket|blinkit|dmart|eatery|cafe|pizza/.test(s)) return 'Food';
  if (/uber|ola|cab|metro|rail|irctc|fuel|petrol|diesel|parking|fastag|indigo|airline|makemytrip/.test(s)) return 'Transportation';
  if (/rent|electric|bescom|water|gas|broadband|jio|airtel|internet|maintenance.*soc/.test(s)) return 'Housing';
  if (/amazon|flipkart|myntra|shopping|mall|clothing|electronics/.test(s)) return 'Shopping';
  if (/pharma|apollo|doctor|hospital|lab|insurance|medical|fitness/.test(s)) return 'Health';
  if (/school|college|udemy|coursera|fees|book/.test(s)) return 'Education';
  if (/netflix|prime|hotstar|movie|pvr|spotify|game|subscription/.test(s)) return 'Entertainment';
  if (/sip|mutual|zerodha|groww|nifty|investment|demat|ppf|fd |rd /.test(s)) return 'Financial';
  if (/emi|loan|credit card|cc payment|charge|fee|tax|chq/.test(s)) return 'Financial';
  return 'Miscellaneous';
}

function cleanMerchant(narration = '') {
  let s = String(narration).replace(/\s+/g, ' ').trim();
  // UPI narration like "UPI-SWIGGY-4177XXX" → "SWIGGY".
  const upi = s.match(/UPI[\/\- ]([A-Za-z0-9& ]{2,})/i);
  if (upi) {
    const parts = upi[1].split(/[-/]/).map((x) => x.trim()).filter(Boolean);
    s = parts[0] || s;
  }
  s = s.replace(/^(NEFT|RTGS|IMPS|UPI|ACH|NACH|POS|ATM|CHQ)[\/\- ]*/i, '');
  return s.slice(0, 80) || 'Bank transaction';
}

export function autoDetectBank(text) {
  const { header } = parseCSVTable(text);
  const h = header.join(' ');
  if (h.includes('narration') && h.includes('value dat')) return 'hdfc';
  if (h.includes('transaction remarks') || (h.includes('withdrawal') && h.includes('deposit'))) return 'icici';
  if ((h.includes('description') || h.includes('narration')) && h.includes('ref') && h.includes('debit') && h.includes('credit')) return 'sbi';
  if (h.includes('transaction id') || (h.includes('note') && h.includes('amount'))) return 'upi';
  if (h.includes('date') && h.includes('amount') && h.includes('type')) return 'generic';
  return 'generic';
}

function toRow({ date, narration, debit, credit, ref, account, fallbackType }) {
  const d = parseDate(date);
  const dr = parseAmount(debit);
  const cr = parseAmount(credit);
  let type = fallbackType || 'expense';
  let amount = 0;
  if (dr > 0 && cr > 0) { type = dr >= cr ? 'expense' : 'income'; amount = Math.max(dr, cr); }
  else if (dr > 0) { type = 'expense'; amount = dr; }
  else if (cr > 0) { type = 'income'; amount = cr; }
  else return null;
  return {
    date: d, type, amount,
    category: guessCategory(narration, type),
    merchant: cleanMerchant(narration),
    account: account || '',
    description: String(narration || '').slice(0, 200),
    upiRef: extractUpiRef(`${narration} ${ref || ''}`),
    status: 'completed'
  };
}

export function parseHDFC(text, account = 'HDFC Savings') {
  const { header, rows } = parseCSVTable(text);
  const iDate = findCol(header, ['date']);
  const iNarr = findCol(header, ['narration', 'description', 'particulars']);
  const iDebit = findCol(header, ['debit amount', 'debit', 'withdrawal']);
  const iCredit = findCol(header, ['credit amount', 'credit', 'deposit']);
  const iRef = findCol(header, ['chq', 'ref', 'cheque', 'number']);
  return rows
    .map((c) => toRow({ date: c[iDate], narration: c[iNarr], debit: c[iDebit], credit: c[iCredit], ref: c[iRef], account }))
    .filter((r) => r && r.date && r.amount > 0);
}

export function parseSBI(text, account = 'SBI Salary') {
  const { header, rows } = parseCSVTable(text);
  const iDate = findCol(header, ['txn date', 'transaction date', 'value date', 'date']);
  const iNarr = findCol(header, ['description', 'narration', 'particulars', 'remarks']);
  const iDebit = findCol(header, ['debit']);
  const iCredit = findCol(header, ['credit']);
  const iRef = findCol(header, ['ref', 'cheque', 'chq', 'number']);
  return rows
    .map((c) => toRow({ date: c[iDate], narration: c[iNarr], debit: c[iDebit], credit: c[iCredit], ref: c[iRef], account }))
    .filter((r) => r && r.date && r.amount > 0);
}

export function parseICICI(text, account = 'ICICI Savings') {
  const { header, rows } = parseCSVTable(text);
  const iDate = findCol(header, ['transaction date', 'value date', 'txn date', 'date']);
  const iNarr = findCol(header, ['transaction remarks', 'description', 'narration', 'remarks', 'particulars']);
  const iDebit = findCol(header, ['withdrawal', 'debit']);
  const iCredit = findCol(header, ['deposit', 'credit']);
  return rows
    .map((c) => toRow({ date: c[iDate], narration: c[iNarr], debit: c[iDebit], credit: c[iCredit], ref: '', account }))
    .filter((r) => r && r.date && r.amount > 0);
}

export function parseUPI(text, account = '') {
  const { header, rows } = parseCSVTable(text);
  const iDate = findCol(header, ['date', 'time']);
  const iNote = findCol(header, ['note', 'narration', 'description', 'remarks', 'payee', 'merchant']);
  const iAmt = findCol(header, ['amount', 'value']);
  const iType = findCol(header, ['type', 'dr cr', 'direction', 'status']);
  return rows.map((c) => {
    const date = parseDate(c[iDate]);
    const amount = Math.abs(parseAmount(c[iAmt]));
    if (!date || !(amount > 0)) return null;
    const typeHint = String(c[iType] || '').toLowerCase();
    const type = /credit|received|cr|in/.test(typeHint) && !/debit|paid|dr|out/.test(typeHint) ? 'income' : 'expense';
    const narration = c[iNote] || '';
    return {
      date, type, amount,
      category: guessCategory(narration, type),
      merchant: cleanMerchant(narration),
      account,
      description: String(narration).slice(0, 200),
      upiRef: extractUpiRef(narration),
      status: 'completed'
    };
  }).filter(Boolean);
}

export function parseStatement(text, { bank = 'auto', account = '' } = {}) {
  const b = bank === 'auto' ? autoDetectBank(text) : bank;
  if (b === 'hdfc') return { bank: b, rows: parseHDFC(text, account) };
  if (b === 'sbi') return { bank: b, rows: parseSBI(text, account) };
  if (b === 'icici') return { bank: b, rows: parseICICI(text, account) };
  if (b === 'upi') return { bank: b, rows: parseUPI(text, account) };
  return { bank: 'generic', rows: [] };
}
