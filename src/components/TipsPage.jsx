import React, { useMemo } from 'react';
import { tipOfTheDay, personalizedTips, smartSuggestions, CHALLENGES } from '../services/insightsService.js';
import { currentMonthKey } from '../services/finance.js';

export default function TipsPage({ transactions, budgets, recurring, onNavigate }) {
  const monthKey = currentMonthKey();
  const tip = useMemo(() => tipOfTheDay(), []);
  const mine = useMemo(() => personalizedTips(transactions, monthKey), [transactions, monthKey]);
  const suggestions = useMemo(
    () => smartSuggestions(transactions, budgets, recurring, monthKey),
    [transactions, budgets, recurring, monthKey]
  );

  const goFor = (action) => {
    if (/budget/i.test(action || '')) onNavigate('budgets');
    else if (/recurr/i.test(action || '')) onNavigate('recurring');
    else if (/goal/i.test(action || '')) onNavigate('goals');
    else if (/import|statement/i.test(action || '')) onNavigate('transactions');
    else onNavigate('reports');
  };

  return (
    <div>
      <div className="card wide" style={{ borderLeft: '4px solid var(--accent)' }}>
        <div className="card-head"><h3>💡 Tip of the day</h3><span className="muted small">{tip.date}</span></div>
        <div><b>{tip.title}</b></div>
        <p className="muted" style={{ margin: '6px 0 0' }}>{tip.body}</p>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>🎯 Tips for you</h3><span className="muted small">from your ledger</span></div>
          {mine.map((t, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-start', padding: '8px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
              <span style={{ fontSize: 22 }}>{t.icon}</span>
              <div><b>{t.title}</b><div className="muted small">{t.body}</div></div>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-head"><h3>✨ Smart suggestions</h3><span className="muted small">with numbers</span></div>
          {suggestions.map((s, i) => (
            <div key={i} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
              <div className="row"><span>{s.icon} <b>{s.title}</b></span>
                {s.action && <button className="btn" onClick={() => goFor(s.action)}>{s.action}</button>}</div>
              <div className="muted small" style={{ marginTop: 4 }}>{s.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card wide">
        <div className="card-head"><h3>🏆 Savings challenges</h3><span className="muted small">pick one this week</span></div>
        <div className="grid-3">
          {CHALLENGES.map((c) => (
            <div key={c.title} className="stat"><div><b>{c.title}</b></div><div className="muted small" style={{ marginTop: 6 }}>{c.body}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}
