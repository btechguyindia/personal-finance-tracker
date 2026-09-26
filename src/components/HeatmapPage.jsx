import React, { useMemo, useState } from 'react';
import { dailyTotals, weekdayStats, streaks, dayTimeline } from '../services/heatmap.js';
import { formatINR } from '../services/finance.js';
import { todayISO, addDaysISO } from '../services/analyticsService.js';

export default function HeatmapPage({ transactions }) {
  const now = todayISO();
  const start = addDaysISO(now, -89);
  const [sel, setSel] = useState(now);
  const days = useMemo(() => dailyTotals(transactions, start, now), [transactions, start, now]);
  const max = Math.max(1, ...days.map((d) => d.spent));
  const wd = useMemo(() => weekdayStats(transactions), [transactions]);
  const st = useMemo(() => streaks(transactions, now), [transactions, now]);
  const timeline = useMemo(() => dayTimeline(transactions, sel), [transactions, sel]);
  return (
    <div>
      <div className="card wide"><div className="card-head"><h3>🗓️ Daily spending heatmap (90d)</h3><span className="muted small">heaviest weekday: {wd.highest?.day} · no-spend streak: {st.noSpendStreak}d</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {days.map((d) => <button key={d.date} title={`${d.date}: spent ${formatINR(d.spent)}, income ${formatINR(d.income)}, ${d.count} txns`} onClick={() => setSel(d.date)}
            style={{ width: 22, height: 22, borderRadius: 4, border: sel === d.date ? '2px solid var(--accent)' : '1px solid var(--line)', background: d.spent === 0 ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : `rgba(239,68,68,${Math.min(0.9, d.spent / max + 0.15)})`, cursor: 'pointer' }} />)}
        </div>
        <p className="muted small">Salary-day vs end-of-month: compare income days against last-week-of-month spend in the timeline below. Top merchants: {st.topMerchants.slice(0, 5).map((m) => `${m.merchant}×${m.count}`).join(', ') || '—'}.</p>
      </div>
      <div className="card wide"><div className="card-head"><h3>📍 Day timeline — {sel} ({timeline.length} txns)</h3><input className="input" type="date" value={sel} onChange={(e) => setSel(e.target.value)} /></div>
        {timeline.length === 0 ? <div className="empty">No records this day.</div> :
          <div className="table-wrap"><table><thead><tr><th>Type</th><th>Merchant</th><th>Category</th><th>Method</th><th>Account</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>{timeline.map((t) => <tr key={t.id}><td>{t.type}</td><td>{t.merchant || '—'}</td><td>{t.category || '—'}</td><td>{t.paymentMethod || '—'}</td><td>{t.account || t.accountFrom + '→' + t.accountTo}</td><td className="num">{formatINR(t.amount)}</td></tr>)}</tbody></table></div>}
      </div>
    </div>
  );
}
