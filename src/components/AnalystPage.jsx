import React, { useMemo, useState } from 'react';
import { askAnalyst } from '../services/analyst.js';
import { currentMonthKey } from '../services/finance.js';

const EXAMPLES = ['Where did my money go this month?', 'What changed compared with last month?', 'How much can I safely spend this weekend?', 'Which subscriptions are still active?', 'Show all my transport expenses in the last 90 days.'];

export default function AnalystPage({ transactions, recurring }) {
  const monthKey = currentMonthKey();
  const [q, setQ] = useState('');
  const [log, setLog] = useState([]);
  const ask = (text) => {
    const query = text || q;
    if (!query.trim()) return;
    const res = askAnalyst(query, { transactions, recurring, monthKey });
    setLog((l) => [...l, { q: query, ...res }].slice(-20));
    setQ('');
  };
  return (
    <div>
      <div className="card wide"><div className="card-head"><h3>🤖 AI financial analyst (cited, from your ledger)</h3></div>
        <div className="row"><input className="input" style={{ flex: 1 }} placeholder="Ask about your money…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} />
          <button className="btn primary" onClick={() => ask()}>Ask</button></div>
        <div className="row">{EXAMPLES.map((e) => <button key={e} className="btn" onClick={() => ask(e)}>{e}</button>)}</div>
        {log.length === 0 ? <p className="muted">Answers include date range, calculations and supporting transaction IDs. I say when data is incomplete and never invent figures.</p> :
          log.slice().reverse().map((e, i) => <div key={i} className="insight" style={{ marginTop: 10 }}><div><b>Q:</b> {e.q}</div><div><b>A:</b> {e.answer}</div>
            <div className="muted small">Range: {e.range ? `${e.range.start}→${e.range.end}` : 'n/a'} · Figures: {JSON.stringify(e.figures)} · Txns: {(e.txnIds || []).join(', ') || '—'}{e.caveats?.length ? ` · Caveats: ${e.caveats.join(', ')}` : ''}</div></div>)}
      </div>
    </div>
  );
}
