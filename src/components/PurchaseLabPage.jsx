import React, { useMemo, useState } from 'react';
import { analyzePurchase, compareScenarios } from '../services/purchaseLab.js';
import { currentMonthKey, formatINR } from '../services/finance.js';
import { todayISO } from '../services/analyticsService.js';

export default function PurchaseLabPage({ transactions, accounts, recurring, budgets, goals }) {
  const monthKey = currentMonthKey();
  const now = todayISO();
  const [item, setItem] = useState('');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(now);
  const [method, setMethod] = useState('UPI');
  const avgIncome = useMemo(() => {
    const ms = {};
    for (const t of transactions || []) {
      if (t.type !== 'income' || (t.status && t.status !== 'completed')) continue;
      const mk = t.date.slice(0, 7); ms[mk] = (ms[mk] || 0) + Number(t.amount || 0);
    }
    const vs = Object.values(ms);
    return vs.length ? vs.reduce((s, x) => s + x, 0) / vs.length : 0;
  }, [transactions]);
  const analysis = useMemo(() => (Number(price) > 0 ? analyzePurchase({ item, price, date, method, transactions, accounts, recurring, budgets, goals, monthKey, avgMonthlyIncome: avgIncome }) : null), [item, price, date, method, transactions, accounts, recurring, budgets, goals, monthKey, avgIncome]);
  const cmp = useMemo(() => (Number(price) > 0 ? compareScenarios({ price, transactions, accounts, recurring, now }) : []), [price, transactions, accounts, recurring, now]);
  return (
    <div>
      <div className="card wide"><div className="card-head"><h3>🧪 Purchase decision lab</h3></div>
        <div className="row">
          <input className="input" placeholder="Item" value={item} onChange={(e) => setItem(e.target.value)} />
          <input className="input" type="number" placeholder="Price ₹" value={price} onChange={(e) => setPrice(e.target.value)} />
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <select value={method} onChange={(e) => setMethod(e.target.value)}>{['UPI', 'Cash', 'Debit card', 'Credit card', 'Bank transfer', 'Wallet'].map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </div>
        {analysis && <ul className="legend">
          <li><span>Cash after buying</span><span>{formatINR(analysis.afterCash)}</span></li>
          <li><span>Bills still covered?</span><span>{analysis.billsCovered ? '✅ yes' : '❌ no'}</span></li>
          <li><span>Days of income (avg {formatINR(Math.round(avgIncome))}/mo)</span><span>{analysis.daysOfIncome === null ? 'n/a — no income data' : `${analysis.daysOfIncome} days`}</span></li>
          <li><span>Goal delay</span><span>{analysis.goalDelayMonths === null ? 'n/a' : `≈${analysis.goalDelayMonths} month(s) of goal contributions`}</span></li>
          <li><span>Verdict</span><span>{analysis.verdict}</span></li>
        </ul>}
      </div>
      {cmp.length > 0 && <div className="card wide"><div className="card-head"><h3>⚖️ Buy today vs next month vs save 3 months (real cash-flow)</h3></div>
        <div className="table-wrap"><table><thead><tr><th>Option</th><th>End balance</th><th>Breaches</th></tr></thead>
          <tbody>{cmp.map((c) => <tr key={c.name}><td>{c.name}</td><td className="num">{formatINR(c.endBalance)}</td><td>{c.breachCount ? c.breaches.map((b) => b.date).join(', ') : 'none'}</td></tr>)}</tbody></table></div></div>}
    </div>
  );
}
