import React, { useEffect, useMemo } from 'react';
import { useCountUp } from '../hooks/useCountUp.js';
import { formatINR } from '../services/finance.js';

// Full-screen celebration overlay.
// kind: 'debit' | 'credit' | 'save' | 'transfer' | 'goal'
// auto-dismisses after ~3.2s (goal: 4.5s). Click to dismiss early.
const CONFIG = {
  debit: { icon: '💸', title: 'Money spent', verb: 'deducted', cls: 'is-debit', amountPrefix: '−' },
  credit: { icon: '💰', title: 'Money credited', verb: 'added', cls: 'is-credit', amountPrefix: '+' },
  save: { icon: '🐷', title: 'Saved!', verb: 'put aside', cls: 'is-save', amountPrefix: '+' },
  transfer: { icon: '🔀', title: 'Transferred', verb: 'moved', cls: 'is-transfer', amountPrefix: '⇄ ' },
  goal: { icon: '🏆', title: 'Goal achieved!', verb: 'goal complete', cls: 'is-goal', amountPrefix: '🎯 ' }
};

function Particles({ kind }) {
  const pieces = useMemo(() => {
    const glyphs = {
      debit: ['💸', '₹', '💳'],
      credit: ['💰', '₹', '🪙', '💵'],
      save: ['🪙', '₹', '🐷', '💵'],
      transfer: ['⇄', '₹', '🏦'],
      goal: ['🎉', '⭐', '🏆', '🎊', '₹']
    }[kind] || ['₹'];
    return Array.from({ length: kind === 'goal' ? 42 : 24 }, (_, i) => ({
      id: i,
      g: glyphs[i % glyphs.length],
      left: Math.random() * 100,
      delay: Math.random() * 0.9,
      dur: 1.8 + Math.random() * 1.6,
      size: 16 + Math.random() * 22,
      drift: (Math.random() - 0.5) * 120
    }));
  }, [kind]);
  return (
    <div className="cel-particles" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="cel-particle"
          style={{
            left: `${p.left}%`, fontSize: p.size,
            animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
            '--drift': `${p.drift}px`
          }}
        >{p.g}</span>
      ))}
    </div>
  );
}

export default function Celebration({ data, onDone }) {
  const cfg = CONFIG[data?.kind] || CONFIG.credit;
  const animated = useCountUp(data?.amount || 0, { duration: data?.kind === 'goal' ? 1400 : 900 });

  useEffect(() => {
    if (!data) return;
    const t = setTimeout(onDone, data.kind === 'goal' ? 4500 : 3200);
    return () => clearTimeout(t);
  }, [data, onDone]);

  if (!data) return null;
  return (
    <div className={`cel-back ${cfg.cls}`} onClick={onDone} role="status" aria-live="polite">
      <Particles kind={data.kind} />
      <div className="cel-card" onClick={(e) => e.stopPropagation()}>
        <div className="cel-icon">{cfg.icon}</div>
        <div className="cel-title">{data.title || cfg.title}</div>
        <div className="cel-amount">
          {cfg.amountPrefix}{formatINR(animated)}
        </div>
        <div className="cel-sub">
          {data.subtitle || `${formatINR(data.amount)} ${cfg.verb}${data.detail ? ` · ${data.detail}` : ''}`}
        </div>
        {data.kind === 'goal' && data.progress != null && (
          <div className="cel-goalbar"><div style={{ width: `${Math.min(100, data.progress)}%` }} /></div>
        )}
        <button className="btn primary cel-btn" onClick={onDone}>Nice! →</button>
      </div>
    </div>
  );
}
