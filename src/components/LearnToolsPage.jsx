import React, { useMemo, useState } from 'react';
import {
  LEARN_LINKS, avgMonthlyBurn, emergencyFundCalc,
  sipFutureValue, estimateNewRegimeTax, fiftyThirtyTwenty
} from '../services/insightsService.js';
import { currentMonthKey, formatINR } from '../services/finance.js';

function useNum(initial) {
  const [v, setV] = useState(initial);
  return [v, (e) => setV(e.target.value)];
}

export default function LearnToolsPage({ transactions, accounts }) {
  const monthKey = currentMonthKey();

  const burn = useMemo(() => avgMonthlyBurn(transactions, 3), [transactions]);
  const liquid = useMemo(() => (accounts || []).filter((a) => a.type !== 'credit_card')
    .reduce((s, a) => s + Number(a.balance || 0), 0), [accounts]);
  const emergency = useMemo(() => emergencyFundCalc(burn, liquid), [burn, liquid]);
  const split = useMemo(() => fiftyThirtyTwenty(transactions, monthKey), [transactions, monthKey]);

  const [sipAmt, setSipAmt] = useNum('10000');
  const [sipRate, setSipRate] = useNum('12');
  const [sipYears, setSipYears] = useNum('10');
  const sip = useMemo(() => sipFutureValue(sipAmt, sipRate, sipYears), [sipAmt, sipRate, sipYears]);

  const [ctc, setCtc] = useNum('1200000');
  const tax = useMemo(() => estimateNewRegimeTax(ctc), [ctc]);

  const bar = (pct) => (
    <div className="goal-bar" style={{ marginTop: 6 }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct || 0))}%` }} />
    </div>
  );

  return (
    <div>
      <div className="card wide">
        <div className="card-head"><h3>📚 Learn — trusted money reads</h3><span className="muted small">India-first, free</span></div>
        <div className="grid-3">
          {LEARN_LINKS.map((l) => (
            <div key={l.url} className="stat">
              <div><a href={l.url} target="_blank" rel="noreferrer"><b>{l.title} ↗</b></a></div>
              <div className="muted small" style={{ marginTop: 4 }}><span className="pill completed">{l.tag}</span></div>
              <div className="muted small" style={{ marginTop: 4 }}>{l.why}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>⚖️ Spend wisely — 50/30/20</h3><span className="muted small">{monthKey}</span></div>
          {split.income <= 0 ? <div className="empty">No income this month — the check needs income to compare against.</div> : (
            <div>
              {[
                { label: 'Needs ≤ 50%', val: split.needs, pct: split.needsPct, ok: split.verdicts.needs },
                { label: 'Wants ≤ 30%', val: split.wants, pct: split.wantsPct, ok: split.verdicts.wants },
                { label: 'Saved ≥ 20%', val: split.saved, pct: split.savedPct, ok: split.verdicts.saved },
              ].map((r) => (
                <div key={r.label} style={{ marginBottom: 10 }}>
                  <div className="row"><span>{r.ok === true ? '✅' : r.ok === false ? '⚠️' : '•'} {r.label}</span>
                    <b>{formatINR(Math.round(r.val))}{r.pct !== null ? ` · ${r.pct.toFixed(0)}%` : ''}</b></div>
                  {bar(r.pct)}
                </div>
              ))}
              <p className="muted small">Needs = Food, Housing, Health, Transport, Education, Financial, Family. Everything else is wants.</p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h3>🛟 Emergency fund</h3><span className="muted small">auto from your burn</span></div>
          <div className="kv"><span>Avg monthly spend (3 mo)</span><b>{formatINR(Math.round(burn))}</b></div>
          <div className="kv"><span>Liquid balance now</span><b>{formatINR(Math.round(liquid))}</b></div>
          <div className="kv"><span>Target (6 months)</span><b>{formatINR(emergency.target)}</b></div>
          <div className="kv"><span>Gap</span><b style={{ color: emergency.gap > 0 ? 'var(--warn)' : 'var(--good)' }}>{formatINR(emergency.gap)}</b></div>
          {bar(burn > 0 ? (liquid / (burn * 6)) * 100 : 0)}
          <p className="muted small">{emergency.monthsCovered.toFixed(1)} months covered. {emergency.gap > 0 ? 'Close the gap before large investments.' : 'Fully covered — great!'}</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>📊 SIP calculator</h3><span className="muted small">monthly compounding</span></div>
          <div className="form-grid two">
            <label>Monthly (₹)<input className="input" type="number" min="0" value={sipAmt} onChange={setSipAmt} /></label>
            <label>Return % p.a.<input className="input" type="number" min="0" step="0.5" value={sipRate} onChange={setSipRate} /></label>
            <label>Years<input className="input" type="number" min="1" max="40" value={sipYears} onChange={setSipYears} /></label>
          </div>
          <div className="kv" style={{ marginTop: 10 }}><span>Invested</span><b>{formatINR(sip.invested)}</b></div>
          <div className="kv"><span>Gains</span><b style={{ color: 'var(--good)' }}>{formatINR(sip.gains)}</b></div>
          <div className="kv"><span>Total value</span><b style={{ fontSize: 18 }}>{formatINR(sip.total)}</b></div>
          {bar(sip.total > 0 ? (sip.gains / sip.total) * 100 : 0)}
          <p className="muted small">Illustration only — markets vary. FV = P × [((1+r)^n − 1)/r] × (1+r).</p>
        </div>

        <div className="card">
          <div className="card-head"><h3>🧾 Tax estimator</h3><span className="muted small">new regime FY 25-26 · approx</span></div>
          <label>Gross annual income (₹)<input className="input" type="number" min="0" step="10000" value={ctc} onChange={setCtc} /></label>
          <div className="kv" style={{ marginTop: 10 }}><span>Taxable (after ₹75k std. deduction)</span><b>{formatINR(tax.taxable)}</b></div>
          <div className="kv"><span>Slab tax + 4% cess</span><b>{formatINR(tax.total)}</b></div>
          <div className="kv"><span>Effective rate</span><b>{tax.gross > 0 ? ((tax.total / tax.gross) * 100).toFixed(1) : 0}%</b></div>
          <p className="muted small">Includes 87A rebate (nil tax ≤ ₹12L taxable). Verify on incometax.gov.in before filing.</p>
        </div>
      </div>
    </div>
  );
}
