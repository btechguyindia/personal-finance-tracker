import React, { useMemo, useState } from 'react';
import { detectiveInbox } from '../services/detective.js';
import { formatINR } from '../services/finance.js';

export default function DetectivePage({ transactions, recurring, onGoToTransactions }) {
  const [sev, setSev] = useState('');
  const inbox = useMemo(() => detectiveInbox(transactions, recurring), [transactions, recurring]);
  const filtered = inbox.filter((f) => !sev || f.severity === sev);
  const byId = useMemo(() => new Map((transactions || []).map((t) => [t.id, t])), [transactions]);
  return (
    <div>
      <div className="card wide"><div className="card-head"><h3>🕵️ Reconciliation inbox — {inbox.length} need attention</h3>
        <select value={sev} onChange={(e) => setSev(e.target.value)}><option value="">All severities</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></div>
        <p className="muted small">Flags only — nothing is auto-deleted or modified. Each alert links to its record via ID.</p>
        {filtered.length === 0 ? <div className="empty">✅ Nothing flagged. Ledger looks clean.</div> :
          <div className="table-wrap"><table><thead><tr><th>Severity</th><th>Type</th><th>Date</th><th>Merchant</th><th style={{ textAlign: 'right' }}>Amount</th><th>Why</th><th>IDs</th></tr></thead>
            <tbody>{filtered.map((f, i) => <tr key={i}><td>{f.severity}</td><td>{f.kind}</td><td>{f.date || '—'}</td><td>{f.merchant || '—'}</td><td className="num">{f.amount !== undefined ? formatINR(f.amount) : '—'}</td><td>{f.reason}</td><td className="muted small">{(f.ids || []).join(', ')}</td></tr>)}</tbody></table></div>}
        {onGoToTransactions && inbox.length > 0 && <button className="btn" onClick={onGoToTransactions}>Open ledger →</button>}
      </div>
    </div>
  );
}
