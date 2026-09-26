import React, { useMemo, useState } from 'react';
import { formatINR } from '../services/analyticsService.js';
import {
  emi, amortization, yearlySchedule, simpleInterest,
  compoundMaturity, sipFutureValue, discountPrice
} from '../services/calculators.js';

const TABS = [
  { id: 'emi', label: 'EMI' },
  { id: 'sip', label: 'SIP' },
  { id: 'fd', label: 'FD / Compound' },
  { id: 'si', label: 'Simple Interest' },
  { id: 'discount', label: 'Discount' }
];

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function Field({ label, value, onChange, min = '0', step = 'any', suffix }) {
  return (
    <label>{label}
      <span className="row" style={{ gap: 6 }}>
        <input className="input" type="number" min={min} step={step} value={value}
          onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }} />
        {suffix && <span className="muted small">{suffix}</span>}
      </span>
    </label>
  );
}

function Kpi({ label, value, tone = '', sub }) {
  return (
    <div className={`kpi ${tone}`}>
      <div className="k-label">{label}</div>
      <div className="k-value">{value}</div>
      {sub && <div className="k-sub">{sub}</div>}
    </div>
  );
}

function EmiPanel() {
  const [p, setP] = useState('1000000');
  const [rate, setRate] = useState('9');
  const [yrs, setYrs] = useState('20');
  const [mos, setMos] = useState('0');
  const months = Math.max(1, Math.floor(num(yrs) * 12 + num(mos)) || 1);
  const result = useMemo(() => emi(num(p), num(rate), months), [p, rate, months]);
  const years = useMemo(() => yearlySchedule(amortization(num(p), num(rate), months)), [p, rate, months]);
  const [showMonthly, setShowMonthly] = useState(false);
  const monthly = useMemo(
    () => (showMonthly ? amortization(num(p), num(rate), months) : []),
    [showMonthly, p, rate, months]
  );
  const princPct = result.totalPayment > 0 ? (num(p) / result.totalPayment) * 100 : 0;

  return (
    <div>
      <div className="form-grid">
        <Field label="Loan amount (₹)" value={p} onChange={setP} step="1000" />
        <Field label="Interest rate (% p.a.)" value={rate} onChange={setRate} step="0.05" suffix="reducing balance" />
        <Field label="Tenure — years" value={yrs} onChange={setYrs} step="1" />
        <Field label="Tenure — extra months" value={mos} onChange={setMos} step="1" />
      </div>
      <div className="grid-3">
        <Kpi label="Monthly EMI" value={formatINR(result.emi)} />
        <Kpi label="Total interest" value={formatINR(result.totalInterest)} tone="bad" sub={`${months} payments`} />
        <Kpi label="Total payable" value={formatINR(result.totalPayment)} sub={`Principal ${formatINR(num(p))}`} />
      </div>
      <div className="card">
        <div className="card-head"><h3>Principal vs interest</h3>
          <span className="muted small">{princPct.toFixed(1)}% principal · {(100 - princPct).toFixed(1)}% interest</span>
        </div>
        <div style={{ height: 16, borderRadius: 8, overflow: 'hidden', display: 'flex', background: 'var(--line)' }}>
          <div style={{ width: `${princPct}%`, background: 'var(--accent)' }} />
          <div style={{ width: `${100 - princPct}%`, background: 'var(--bad)' }} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted small">■ Principal</span>
          <span className="muted small">■ Interest</span>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Year-wise schedule</h3>
          <button className="btn" onClick={() => setShowMonthly((s) => !s)}>
            {showMonthly ? 'Hide monthly detail' : 'Show monthly detail'}
          </button>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Year</th><th>Principal</th><th>Interest</th><th>Paid</th><th>Balance</th></tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.year}>
                <td>{y.year}</td><td>{formatINR(y.principal)}</td><td>{formatINR(y.interest)}</td>
                <td>{formatINR(y.paid)}</td><td>{formatINR(y.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {showMonthly && (
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', marginTop: 12 }}><table>
            <thead><tr><th>#</th><th>EMI</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td><td>{formatINR(m.emi)}</td><td>{formatINR(m.principal)}</td>
                  <td>{formatINR(m.interest)}</td><td>{formatINR(m.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

function SipPanel() {
  const [m, setM] = useState('10000');
  const [rate, setRate] = useState('12');
  const [yrs, setYrs] = useState('10');
  const months = Math.max(1, Math.floor(num(yrs) * 12) || 1);
  const r = useMemo(() => sipFutureValue(num(m), num(rate), months), [m, rate, months]);
  const pct = r.maturity > 0 ? (r.invested / r.maturity) * 100 : 0;
  return (
    <div>
      <div className="form-grid">
        <Field label="Monthly investment (₹)" value={m} onChange={setM} step="500" />
        <Field label="Expected return (% p.a.)" value={rate} onChange={setRate} step="0.5" />
        <Field label="Period (years)" value={yrs} onChange={setYrs} step="1" />
      </div>
      <div className="grid-3">
        <Kpi label="Invested" value={formatINR(r.invested)} />
        <Kpi label="Est. gains" value={formatINR(r.gains)} tone="good" />
        <Kpi label="Maturity value" value={formatINR(r.maturity)} sub={`${months} instalments`} />
      </div>
      <div className="card">
        <div className="card-head"><h3>Invested vs gains</h3>
          <span className="muted small">{pct.toFixed(1)}% invested</span>
        </div>
        <div style={{ height: 16, borderRadius: 8, overflow: 'hidden', display: 'flex', background: 'var(--line)' }}>
          <div style={{ width: `${pct}%`, background: 'var(--accent)' }} />
          <div style={{ width: `${100 - pct}%`, background: 'var(--good)' }} />
        </div>
        <p className="muted small">Monthly compounding at the equivalent monthly rate. Markets vary — treat as projection, not promise.</p>
      </div>
    </div>
  );
}

function FdPanel() {
  const [p, setP] = useState('500000');
  const [rate, setRate] = useState('7.5');
  const [yrs, setYrs] = useState('5');
  const [freq, setFreq] = useState('4');
  const r = useMemo(() => compoundMaturity(num(p), num(rate), num(yrs), num(freq)), [p, rate, yrs, freq]);
  return (
    <div>
      <div className="form-grid">
        <Field label="Deposit (₹)" value={p} onChange={setP} step="1000" />
        <Field label="Interest rate (% p.a.)" value={rate} onChange={setRate} step="0.05" />
        <Field label="Period (years)" value={yrs} onChange={setYrs} step="1" />
        <label>Compounding
          <select className="input" value={freq} onChange={(e) => setFreq(e.target.value)}>
            <option value="1">Yearly</option>
            <option value="2">Half-yearly</option>
            <option value="4">Quarterly</option>
            <option value="12">Monthly</option>
          </select>
        </label>
      </div>
      <div className="grid-3">
        <Kpi label="Principal" value={formatINR(num(p))} />
        <Kpi label="Interest earned" value={formatINR(r.interest)} tone="good" />
        <Kpi label="Maturity value" value={formatINR(r.maturity)} />
      </div>
    </div>
  );
}

function SiPanel() {
  const [p, setP] = useState('100000');
  const [rate, setRate] = useState('8');
  const [yrs, setYrs] = useState('3');
  const r = useMemo(() => simpleInterest(num(p), num(rate), num(yrs)), [p, rate, yrs]);
  return (
    <div>
      <div className="form-grid">
        <Field label="Principal (₹)" value={p} onChange={setP} step="1000" />
        <Field label="Rate (% p.a.)" value={rate} onChange={setRate} step="0.1" />
        <Field label="Time (years)" value={yrs} onChange={setYrs} step="0.5" />
      </div>
      <div className="grid-3">
        <Kpi label="Principal" value={formatINR(num(p))} />
        <Kpi label="Interest (P·R·T/100)" value={formatINR(r.interest)} tone="good" />
        <Kpi label="Total" value={formatINR(r.total)} />
      </div>
    </div>
  );
}

function DiscountPanel() {
  const [mrp, setMrp] = useState('999');
  const [d, setD] = useState('20');
  const [x, setX] = useState('0');
  const [t, setT] = useState('18');
  const r = useMemo(() => discountPrice(num(mrp), num(d), num(x), num(t)), [mrp, d, x, t]);
  return (
    <div>
      <div className="form-grid">
        <Field label="MRP (₹)" value={mrp} onChange={setMrp} step="1" />
        <Field label="Discount (%)" value={d} onChange={setD} step="1" />
        <Field label="Extra coupon (%)" value={x} onChange={setX} step="1" />
        <Field label="GST / tax (%)" value={t} onChange={setT} step="1" />
      </div>
      <div className="grid-3">
        <Kpi label="You pay" value={formatINR(r.final)} sub={`incl. ${formatINR(r.tax)} tax`} />
        <Kpi label="You save" value={formatINR(r.savings)} tone="good" sub={`${r.effectiveOffPct}% effective off`} />
        <Kpi label="After discounts" value={formatINR(r.afterExtra)} sub={`was ${formatINR(num(mrp))}`} />
      </div>
      <p className="muted small">Discount applied on MRP, then coupon on the discounted price, then tax on the net.</p>
    </div>
  );
}

export default function CalculatorsPage() {
  const [tab, setTab] = useState('emi');
  return (
    <div>
      <div className="card">
        <div className="row">
          {TABS.map((t) => (
            <button key={t.id} className={`btn${tab === t.id ? ' primary' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card wide">
        {tab === 'emi' && <EmiPanel />}
        {tab === 'sip' && <SipPanel />}
        {tab === 'fd' && <FdPanel />}
        {tab === 'si' && <SiPanel />}
        {tab === 'discount' && <DiscountPanel />}
      </div>
    </div>
  );
}
