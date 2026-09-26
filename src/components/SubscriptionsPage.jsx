import React, { useMemo, useState } from 'react';
import { detectSubscriptions, subscriptionTotals, loadSubState, saveSubState } from '../services/subscriptions.js';
import { formatINR } from '../services/finance.js';

export default function SubscriptionsPage({ transactions }) {
  const detected = useMemo(() => detectSubscriptions(transactions), [transactions]);
  const totals = useMemo(() => subscriptionTotals(detected), [detected]);
  const [state, setState] = useState(loadSubState);
  const set = (m, v) => { const n = { ...state, [m]: v }; setState(n); saveSubState(n); };
  return (
    <div>
      <div className="grid-3">
        <div className="stat"><div className="stat-label">Detected subscriptions</div><div className="stat-value">{totals.count}</div></div>
        <div className="stat"><div className="stat-label">Monthly total</div><div className="stat-value">{formatINR(totals.monthly)}</div></div>
        <div className="stat"><div className="stat-label">Annual cost</div><div className="stat-value">{formatINR(totals.annual)}</div></div>
      </div>
      <div className="card wide"><div className="card-head"><h3>📡 Recurring-payment radar</h3><span className="muted small">confirm / dismiss / correct — never claims cancellation</span></div>
        {detected.length === 0 ? <div className="empty">No repeated-merchant patterns (≥3 regular payments) found yet.</div> :
          <div className="table-wrap"><table><thead><tr><th>Merchant</th><th>Freq</th><th>Avg</th><th>Mo cost</th><th>Annual</th><th>Next renewal</th><th>Confidence</th><th>Status</th></tr></thead>
            <tbody>{detected.map((d) => <tr key={d.merchant}><td>{d.merchant}</td><td>{d.frequency} (×{d.count})</td><td className="num">{formatINR(d.avgAmount)}</td><td className="num">{formatINR(d.monthlyCost)}</td><td className="num">{formatINR(d.annualCost)}</td><td>{d.nextRenewal || '—'}</td><td>{d.confidence}</td>
              <td><select value={state[d.merchant] || 'unreviewed'} onChange={(e) => set(d.merchant, e.target.value)}><option value="unreviewed">unreviewed</option><option value="confirmed">confirmed</option><option value="inactive">inactive (you marked)</option><option value="dismissed">dismissed</option></select></td></tr>)}</tbody></table></div>}
        <p className="muted small">Price changes surface in Detective → bill-change flags. Cancel only via the actual provider.</p>
      </div>
    </div>
  );
}
