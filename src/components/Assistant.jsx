import React, { useEffect, useRef, useState } from 'react';
import { assistantReply, ASSISTANT_SUGGESTIONS } from '../services/assistant.js';

export default function Assistant({ transactions, budgets, accounts, goals, user, fabVisible }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    {
      from: 'bot',
      text: `Hi${user?.name ? ` ${user.name.split(' ')[0]}` : ''}! I am Fin, your finance buddy 🤖. Ask me about your spending, budgets or goals.`
    }
  ]);
  const bottomRef = useRef(null);
  const ctx = { transactions, budgets, accounts, goals, userName: user?.name?.split(' ')[0] || '' };
  // Dock above the + Add pill (bottom-right) so we never cover the sidebar
  // footer (Light/Dark + Logout) or the + Add button itself.
  const dockBottom = fabVisible ? 96 : 26;

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const ask = (text) => {
    const q = String(text || '').trim();
    if (!q) return;
    const reply = assistantReply(q, ctx);
    setMessages((m) => [...m, { from: 'user', text: q }, { from: 'bot', text: reply }]);
    setInput('');
  };

  return (
    <div>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Ask Fin — your finance assistant"
          style={{
            position: 'fixed', right: 26, bottom: dockBottom, zIndex: 60,
            width: 56, height: 56, borderRadius: '50%', fontSize: 26, cursor: 'pointer',
            background: 'var(--accent)', border: 'none', boxShadow: 'var(--shadow)'
          }}
        >🤖</button>
      )}
      {open && (
        <div className="card" style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 60,
          width: 'min(360px, calc(100vw - 32px))', height: 480, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', margin: 0
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
            background: 'var(--accent)', color: 'var(--accent-ink)'
          }}>
            <span style={{ fontSize: 26 }}>🤖</span>
            <div style={{ flex: 1 }}>
              <b>Fin — Finance Buddy</b>
              <div className="small" style={{ opacity: 0.85, fontSize: 11 }}>Answers from your own ledger</div>
            </div>
            <button onClick={() => setOpen(false)} className="btn"
              style={{ background: 'transparent', border: '1px solid currentColor', color: 'inherit', padding: '4px 10px' }}>✕</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.from === 'user' ? 'flex-end' : 'flex-start',
                background: m.from === 'user' ? 'var(--accent)' : 'var(--line)',
                color: m.from === 'user' ? 'var(--accent-ink)' : 'var(--ink)',
                borderRadius: 12, padding: '8px 12px', maxWidth: '85%', minWidth: 0,
                fontSize: 13.5, overflowWrap: 'break-word', wordBreak: 'break-word'
              }}>{m.text}</div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div style={{ padding: '8px 10px', borderTop: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 6, marginBottom: 8 }}>
              {ASSISTANT_SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="btn" style={{ fontSize: 11, padding: '4px 8px', whiteSpace: 'normal', textAlign: 'left' }}
                  onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
            <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); ask(input); }}>
              <input className="input" value={input} onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about spending, budgets…" style={{ flex: 1, minWidth: 0 }} maxLength={200} />
              <button className="btn primary" type="submit">➤</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
