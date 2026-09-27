import React, { useMemo, useRef, useState } from 'react';
import { CATEGORIES, SUBCATEGORIES, PAYMENT_METHODS } from '../services/analyticsService.js';
import { formatINR } from '../services/finance.js';
import { BANK_PRESETS, parseStatement, parseCSVTable } from '../services/statementParsers.js';
import { normalizeImportRow } from '../services/importNormalize.js';
import { api } from '../services/api.js';

const TYPES = ['expense', 'income', 'transfer', 'refund', 'adjustment'];
const STATUSES = ['completed', 'pending', 'scheduled'];
const ALL_CATEGORIES = [...CATEGORIES, 'Salary', 'Freelance', 'Business income', 'Interest', 'Transfer', 'Card payment', 'Uncategorized'];

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const emptyForm = () => ({
  date: todayLocal(), type: 'expense', amount: '', category: 'Food',
  subcategory: '', paymentMethod: 'UPI', account: '', accountFrom: '', accountTo: '',
  merchant: '', description: '', upiRef: '', tags: '', status: 'completed',
  isCreditCardRepayment: false
});

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (line) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { q = !q; continue; }
      if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const idx = (names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const iDate = idx(['date']), iType = idx(['type']), iAmt = idx(['amount']),
    iCat = idx(['category']), iSub = idx(['subcategory', 'sub-category']),
    iPay = idx(['paymentmethod', 'payment method', 'method']), iAcct = idx(['account']),
    iFrom = idx(['accountfrom', 'from']), iTo = idx(['accountto', 'to']),
    iMer = idx(['merchant']), iDesc = idx(['description', 'note']),
    iUpi = idx(['upiref', 'upi ref', 'upi']), iStatus = idx(['status']);
  return lines.slice(1).map((line) => {
    const c = split(line);
    return {
      date: c[iDate] || '', type: (c[iType] || 'expense').toLowerCase(),
      amount: Number(c[iAmt]), category: c[iCat] || 'Miscellaneous',
      subcategory: iSub >= 0 ? c[iSub] : '', paymentMethod: iPay >= 0 ? (c[iPay] || null) : null,
      account: c[iAcct] || '', accountFrom: iFrom >= 0 ? c[iFrom] : '',
      accountTo: iTo >= 0 ? c[iTo] : '', merchant: iMer >= 0 ? c[iMer] : '',
      description: iDesc >= 0 ? c[iDesc] : '', upiRef: iUpi >= 0 ? c[iUpi] : '',
      status: iStatus >= 0 ? (c[iStatus] || 'completed') : 'completed'
    };
  });
}

export default function TransactionsPage({ transactions, accounts, onChanged, modalSignal, onCelebrate }) {
  const [q, setQ] = useState('');
  const [fType, setFType] = useState('');
  const [fAccount, setFAccount] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [importRows, setImportRows] = useState(null);
  const [importInfo, setImportInfo] = useState(null);
  const [importBank, setImportBank] = useState('auto');
  const [importAccount, setImportAccount] = useState('');
  const fileRef = useRef(null);

  // Open the add-modal when App's FAB signal fires.
  React.useEffect(() => {
    if (modalSignal) { setEditingId(null); setForm(emptyForm()); setError(''); setShowModal(true); }
  }, [modalSignal]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...transactions]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .filter((t) => !fType || t.type === fType)
      .filter((t) => !fAccount || t.account === fAccount || t.accountFrom === fAccount || t.accountTo === fAccount)
      .filter((t) => !fStatus || t.status === fStatus)
      .filter((t) => !needle || [t.merchant, t.category, t.subcategory, t.account, t.accountFrom, t.accountTo, t.paymentMethod, t.description, t.upiRef, t.id, t.type]
        .some((v) => (v || '').toString().toLowerCase().includes(needle)));
  }, [transactions, q, fType, fAccount, fStatus]);

  const subOptions = SUBCATEGORIES[form.category] || [];

  const startEdit = (t) => {
    setEditingId(t.id);
    setForm({
      date: t.date, type: t.type, amount: String(t.amount), category: t.category || 'Food',
      subcategory: t.subcategory || '', paymentMethod: t.paymentMethod || 'UPI',
      account: t.account || '', accountFrom: t.accountFrom || '', accountTo: t.accountTo || '',
      merchant: t.merchant || '', description: t.description || '', upiRef: t.upiRef || '',
      tags: (t.tags || []).join(', '), status: t.status || 'completed',
      isCreditCardRepayment: !!t.isCreditCardRepayment
    });
    setError('');
    setShowModal(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const payload = {
        ...form,
        amount: Number(form.amount),
        account: form.type === 'transfer' ? undefined : (form.account || (accounts[0] || {}).name || 'Cash Wallet'),
        tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean)
      };
      if (editingId) await api.updateTransaction(editingId, payload);
      else {
        const created = await api.createTransaction(payload);
        // Money-movement celebration (new entries only — edits are corrections).
        if (onCelebrate) {
          const kind = created.type === 'expense' ? 'debit'
            : created.type === 'transfer' ? 'transfer'
            : created.type === 'adjustment' ? 'transfer'
            : 'credit';
          const detail = created.type === 'transfer'
            ? `${created.accountFrom} → ${created.accountTo}`
            : created.account;
          onCelebrate({ kind, amount: Number(created.amount), detail });
        }
      }
      setShowModal(false); setEditingId(null); setForm(emptyForm());
      onChanged();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this transaction? Balances and reports update immediately.')) return;
    try { await api.deleteTransaction(id); onChanged(); }
    catch (err) { setError(err.message); }
  };

  const exportCSV = () => {
    const head = ['id', 'date', 'type', 'amount', 'category', 'subcategory', 'paymentMethod', 'account', 'accountFrom', 'accountTo', 'merchant', 'upiRef', 'description', 'status'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [head.join(','), ...filtered.map((t) => head.map((k) => esc(t[k])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fintrack-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadSampleCSV = () => {
    const head = ['date', 'type', 'amount', 'category', 'subcategory', 'paymentMethod', 'account', 'accountFrom', 'accountTo', 'merchant', 'description', 'upiRef', 'status'];
    const rows = [
      ['2026-09-05', 'expense', '250', 'Food', 'Groceries', 'UPI', 'HDFC Savings', '', '', 'BigBasket', 'Weekly groceries', '', 'completed'],
      ['2026-09-06', 'income', '85000', 'Salary', 'Monthly pay', 'Bank transfer', 'SBI Salary', '', '', 'Employer', 'September salary', '', 'completed'],
      ['2026-09-07', 'transfer', '20000', 'Transfer', '', 'Bank transfer', '', 'SBI Salary', 'HDFC Savings', 'Self transfer', 'Monthly savings move', '', 'completed'],
      ['2026-09-08', 'refund', '500', 'Food', 'Restaurants', 'UPI', 'HDFC Savings', '', '', 'Zomato', 'Order refund', '417788990011', 'completed'],
      ['2026-09-09', 'expense', '1200', 'Housing', 'Electricity', 'UPI', 'HDFC Savings', '', '', 'BESCOM', 'Power bill', '', 'completed']
    ];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [head.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fintrack-sample-import.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    // Bank/UPI preset parsers first (HDFC/SBI/ICICI layouts differ);
    // fall back to generic FinTrack CSV when the preset yields nothing.
    let rows = parseCSV(text);
    let detected = '';
    if (importBank !== 'generic') {
      try {
        const preset = importBank === 'auto' ? 'auto' : importBank;
        const parsed = parseStatement(text, {
          bank: preset,
          account: importAccount || (accounts[0] || {}).name || 'Cash Wallet'
        });
        if (parsed.rows.length > 0) {
          // Bank presets emit bank vocabulary — run every row through the
          // same normalizer as generic CSVs (debit→expense, SUCCESS→
          // completed, bare account numbers→description) so the preview
          // always shows ledger-ready rows, even against an older server.
          rows = parsed.rows.map((r) => {
            const norm = normalizeImportRow(r);
            const row = norm.row;
            return {
              ...row,
              account: row.account || importAccount || (accounts[0] || {}).name || 'Cash Wallet'
            };
          });
          // parseUPI drops failed/cancelled rows (no money moved) — say so.
          const rawCount = parseCSVTable(text).rows.length;
          const dropped = rawCount - parsed.rows.length;
          detected = `Detected ${parsed.bank.toUpperCase()} layout — ` +
            (dropped > 0 ? `${dropped} failed/cancelled row(s) skipped (no money moved). ` : '');
        }
      } catch { /* fall through to generic */ }
    } else {
      // Generic FinTrack CSV — still normalize bank synonyms (debit/credit,
      // SUCCESS/FAILED…) so the preview shows ledger-ready rows.
      // Dead bank rows (failed/cancelled) are flagged by the server preview.
      rows = rows.map((raw) => {
        const norm = normalizeImportRow(raw);
        const r = norm.row;
        return { ...r, account: r.account || importAccount || (accounts[0] || {}).name || 'Cash Wallet' };
      });
    }
    if (!rows.length) { setError('No data rows found in CSV.'); return; }
    try {
      const preview = await api.previewImport(rows);
      setImportRows(rows);
      setImportInfo({ ...preview, detected });
    } catch (err) { setError(err.message); }
    e.target.value = '';
  };

  const confirmImport = async () => {
    try {
      const key = 'imp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const res = await api.confirmImport(
        importInfo.rows.filter((r) => !r.errors.length && !r.duplicate).map((r) => r.row), key
      );
      setImportRows(null); setImportInfo(null);
      setError('');
      onChanged();
      alert(`Imported ${res.imported}, skipped ${res.skipped}.`);
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <div className="card">
        <div className="card-head">
          <h3>Ledger ({filtered.length} of {transactions.length})</h3>
          <div className="row">
            <input className="input" placeholder="🔍 Search merchant, category, UPI ref…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" style={{ minWidth: 'min(220px, 100%)' }} />
            <select value={fType} onChange={(e) => setFType(e.target.value)}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <select value={fAccount} onChange={(e) => setFAccount(e.target.value)}><option value="">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}</select>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </div>
        </div>
        <div className="row" style={{ marginBottom: 4 }}>
          <button className="btn primary" onClick={() => { setEditingId(null); setForm(emptyForm()); setError(''); setShowModal(true); }}>+ Add transaction</button>
          <button className="btn" onClick={exportCSV}>⬇ Export CSV</button>
          <select value={importBank} onChange={(e) => setImportBank(e.target.value)} title="Statement format">
            <option value="auto">Auto-detect bank</option>
            {BANK_PRESETS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          <select value={importAccount} onChange={(e) => setImportAccount(e.target.value)} title="Import into account">
            <option value="">Default account</option>
            {accounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
          <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Import statement</button>
          <button className="btn" onClick={downloadSampleCSV} title="Download a correctly-formatted example CSV">📄 Sample CSV</button>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onFile} />
        </div>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {importInfo && (
        <div className="card wide">
          <div className="card-head"><h3>Import preview — {importInfo.total} rows</h3>
            <div className="row">
              <button className="btn" onClick={() => { setImportInfo(null); setImportRows(null); }}>Cancel</button>
              <button className="btn primary" onClick={confirmImport}>Confirm import ({importInfo.valid} new)</button>
            </div>
          </div>
          <p className="muted small">{importInfo.detected || ''}{importInfo.valid} new · {importInfo.duplicates} duplicates (skipped) · {importInfo.invalid} invalid (skipped). Duplicates match on date + type + amount + account + merchant + UPI ref.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>Date</th><th>Type</th><th>Amount</th><th>Category</th><th>Account</th><th>Verdict</th></tr></thead>
            <tbody>{importInfo.rows.slice(0, 100).map((r) => (
              <tr key={r.index}>
                <td>{r.index + 1}</td><td>{r.row.date}</td><td>{r.row.type}</td>
                <td className="num">{r.row.amount}</td><td>{r.row.category}</td><td>{r.row.account || r.row.accountFrom}</td>
                <td>{r.errors.length ? <span className="pill expense">invalid: {r.errors.join('; ')}</span> : r.duplicate ? <span className="pill scheduled">duplicate — {r.duplicateReason}</span> : <span className="pill completed">new</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <div className="card wide">
        {filtered.length === 0 ? (
          <div className="empty"><span className="big-ico">🧾</span>No transactions match. Add one with the button above — analytics build from your real data.</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Type</th><th>Merchant</th><th>Category</th><th>Account</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr></thead>
            <tbody>{filtered.slice(0, 300).map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td>
                <td><span className={`pill ${t.type}`}>{t.type}</span></td>
                <td>{t.merchant || '—'}{t.upiRef ? <div className="muted small">UPI: {t.upiRef}</div> : null}</td>
                <td>{t.category || '—'}{t.subcategory ? ` / ${t.subcategory}` : ''}</td>
                <td>{t.type === 'transfer' ? `${t.accountFrom} → ${t.accountTo}` : t.account}</td>
                <td><span className={`pill ${t.status}`}>{t.status}</span></td>
                <td className="num">{t.type === 'income' ? '+' : t.type === 'refund' ? '−' : t.type === 'transfer' ? '⇄ ' : '−'}{formatINR(Math.abs(t.amount))}</td>
                <td><div className="row"><button className="btn" onClick={() => startEdit(t)}>Edit</button><button className="btn danger" onClick={() => remove(t.id)}>Delete</button></div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {filtered.length > 300 && <div className="muted small">Showing first 300 — refine filters or export CSV.</div>}
      </div>

      {showModal && (
        <div className="modal-back" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>{editingId ? 'Edit transaction' : 'Add transaction'}</h3>
              <button className="btn" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={submit} className="form-grid">
              <label>Type<select value={form.type} onChange={(e) => set('type', e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
              <label>Amount (₹)<input className="input" type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} required /></label>
              <label>Date<input className="input" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required /></label>
              {form.type === 'transfer' ? (<>
                <label>From account<select value={form.accountFrom} onChange={(e) => set('accountFrom', e.target.value)} required>
                  <option value="">Select…</option>{accounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                </select></label>
                <label>To account<select value={form.accountTo} onChange={(e) => set('accountTo', e.target.value)} required>
                  <option value="">Select…</option>{accounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                </select></label>
                <label className="small-check"><input type="checkbox" checked={form.isCreditCardRepayment} onChange={(e) => set('isCreditCardRepayment', e.target.checked)} /> Credit-card repayment (not an expense)</label>
              </>) : (<>
                <label>Account<select value={form.account} onChange={(e) => set('account', e.target.value)} required>
                  <option value="">Select…</option>{accounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                </select></label>
                <label>Payment method<select value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
                  <option value="">Uncategorized</option>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select></label>
                <label>Status<select value={form.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              </>)}
              <label>Category<select value={form.category} onChange={(e) => { set('category', e.target.value); set('subcategory', ''); }}>{ALL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <label>Subcategory{subOptions.length ? (
                <select value={form.subcategory} onChange={(e) => set('subcategory', e.target.value)}><option value="">—</option>{subOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              ) : <input className="input" value={form.subcategory} onChange={(e) => set('subcategory', e.target.value)} placeholder="Optional" />}</label>
              <label>Merchant<input className="input" value={form.merchant} onChange={(e) => set('merchant', e.target.value)} placeholder="e.g. BigBasket" /></label>
              <label>UPI ref (optional)<input className="input" value={form.upiRef} onChange={(e) => set('upiRef', e.target.value)} placeholder="e.g. 4177XXXXXX" /></label>
              <label>Tags (comma separated)<input className="input" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="e.g. trip, office" /></label>
              <label className="span-3">Note<input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional" /></label>
              {error && <div className="error span-3">{error}</div>}
              <div className="row span-3">
                <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Add transaction'}</button>
                <button className="btn" type="button" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
            <p className="muted small">Transfers move money between your accounts and never count as income/expenses. Refunds offset expenses. Pending/scheduled don't affect balances until completed.</p>
          </div>
        </div>
      )}
    </div>
  );
}
