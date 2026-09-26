import React, { useMemo, useState } from 'react';
import { loadBuckets, saveBuckets, loadAllocLog, saveAllocLog, simulateAllocation, applyAllocation } from '../services/buckets.js';
import { formatINR } from '../services/finance.js';

export default function BucketsPage() {
  const [buckets, setBuckets] = useState(loadBuckets);
  const [log, setLog] = useState(loadAllocLog);
  const [income, setIncome] = useState('');
  const [rules, setRules] = useState({ emergency: 20, monthly: 40, education: 10, personal: 10, business: 10, major: 10 });
  const [confirm, setConfirm] = useState(false);

  const plan = useMemo(() => {
    const rs = Object.entries(rules).map(([bucketId, pct]) => ({ bucketId, pct: Number(pct) || 0 }));
    return simulateAllocation(Number(income) || 0, rs, buckets);
  }, [income, rules, buckets]);

  const updateBucket = (id, patch) => setBuckets((b) => { const n = b.map((x) => (x.id === id ? { ...x, ...patch } : x)); saveBuckets(n); return n; });
  const doApply = () => {
    if (!confirm) return;
    const { buckets: next, entry } = applyAllocation(buckets, plan.plan, `income ₹${income}`);
    setBuckets(next); saveBuckets(next);
    const nl = [...log, entry]; setLog(nl); saveAllocLog(nl);
    setConfirm(false); setIncome('');
  };

  const totalPct = Object.values(rules).reduce((s, x) => s + (Number(x) || 0), 0);
  return (
    <div>
      <div className="card wide"><div className="card-head"><h3>🪣 Money buckets (virtual envelopes)</h3><span className="muted small">not separate bank accounts</span></div>
        <div className="grid-3">{buckets.map((b) => (
          <div key={b.id} className="stat"><div className="stat-label">{b.name}</div>
            <div className="stat-value">{formatINR(b.balance || 0)}</div>
            <div className="stat-sub">target {formatINR(b.target)} · {b.target ? Math.min(100, Math.round(((b.balance || 0) / b.target) * 100)) : 0}%</div>
            <div className="goal-bar"><div style={{ width: `${b.target ? Math.min(100, ((b.balance || 0) / b.target) * 100) : 0}%` }} /></div>
            <div className="row" style={{ marginTop: 6 }}><input className="input" type="number" value={b.target} onChange={(e) => updateBucket(b.id, { target: Number(e.target.value) || 0 })} style={{ width: 110 }} /><span className="muted small">target ₹</span></div>
          </div>))}</div>
      </div>
      <div className="card wide"><div className="card-head"><h3>💸 Allocate new income (simulated — confirm to post)</h3></div>
        <div className="row"><input className="input" type="number" placeholder="Income ₹" value={income} onChange={(e) => setIncome(e.target.value)} />
          <span className="muted small">total {totalPct}% {totalPct !== 100 ? '(need not equal 100 — remainder stays unassigned)' : ''}</span></div>
        <div className="grid-3">{buckets.map((b) => <label key={b.id}>{b.name} %<input className="input" type="number" value={rules[b.id] ?? 0} onChange={(e) => setRules((r) => ({ ...r, [b.id]: e.target.value }))} /></label>)}</div>
        {Number(income) > 0 && <ul className="legend">{plan.plan.map((p) => <li key={p.bucketId}><span>{p.name}</span><span>{formatINR(p.amount)}</span></li>)}<li><span>Unassigned</span><span>{formatINR(plan.unassigned)}</span></li></ul>}
        <div className="row"><label className="small-check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I confirm — post this allocation</label>
          <button className="btn primary" disabled={!confirm || !(Number(income) > 0)} onClick={doApply}>Post allocation</button></div>
        {log.length > 0 && <div><h4>Recent allocations</h4><ul className="legend">{log.slice(-5).reverse().map((e, i) => <li key={i}><span>{e.at?.slice(0, 10)} · {e.source}</span><span>{(e.plan || []).map((p) => `${p.name} ₹${p.amount}`).join(', ')}</span></li>)}</ul></div>}
      </div>
    </div>
  );
}
