import React, { useMemo, useState } from 'react';
import { reconcile, booksClosedReport } from '../services/accuracy.js';
import { currentMonthKey, formatINR } from '../services/finance.js';

export default function AccuracyPage({ transactions, accounts }) {
  const monthKey = currentMonthKey();
  const [closing, setClosing] = useState({});
  const [lastRec, setLastRec] = useState({});
  const rec = useMemo(() => reconcile({ transactions, accounts, closingBalances: closing, lastReconciled: lastRec }), [transactions, accounts, closing, lastRec]);
  const books = useMemo(() => booksClosedReport({ transactions, accounts, monthKey, closingBalances: closing, lastReconciled: lastRec }), [transactions, accounts, monthKey, closing, lastRec]);
  return (
    <div>
      <div className="card wide"><div className="card-head"><h3>🎯 Accuracy monitor — {books.summary}</h3></div>
        <div className="table-wrap"><table><thead><tr><th>Account</th><th style={{ textAlign: 'right' }}>Ledger</th><th style={{ textAlign: 'right' }}>Statement</th><th style={{ textAlign: 'right' }}>Diff</th><th>Last reconciled</th></tr></thead>
          <tbody>{rec.rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="num">{formatINR(r.ledger)}</td>
            <td><input className="input" type="number" value={closing[r.name] ?? ''} placeholder="stmt bal" onChange={(e) => setClosing((c) => ({ ...c, [r.name]: e.target.value === '' ? undefined : Number(e.target.value) }))} style={{ width: 120 }} /></td>
            <td className="num" style={{ color: r.matched === false ? 'var(--bad)' : undefined }}>{r.diff === null ? '—' : formatINR(r.diff)}</td>
            <td><input className="input" type="date" value={lastRec[r.name] || ''} onChange={(e) => setLastRec((c) => ({ ...c, [r.name]: e.target.value }))} /></td></tr>)}</tbody></table></div>
        <p className="muted small">Missing/unmatched entries, duplicate candidates and import errors live in Detective. Opening balances unverified unless you tick them in Accounts. {rec.matched}/{rec.total} accounts reconciled.</p>
      </div>
    </div>
  );
}
