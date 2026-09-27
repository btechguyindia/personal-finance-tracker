// FinTrack mobile component system — presentational only, no data fetching.
// All money comes from props (real ledger data); no mock content anywhere.
import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { formatINR } from '../services/finance.js';

const NAV5 = [
  { id: 'mhome', label: 'Home', ico: '⌂' },
  { id: 'mactivity', label: 'Activity', ico: '≣' },
  { id: 'mcards', label: 'Cards', ico: '▭' },
  { id: 'minsights', label: 'Insights', ico: '◔' },
  { id: 'mprofile', label: 'Profile', ico: '○' }
];

export function BottomNav({ tab, go }) {
  return (
    <nav className="mnav" aria-label="Primary">
      {NAV5.map((n) => (
        <button key={n.id} className={tab === n.id ? 'on' : ''} onClick={() => go(n.id)} aria-current={tab === n.id ? 'page' : undefined}>
          <span className="mi" aria-hidden="true">{n.ico}</span>{n.label}
        </button>
      ))}
    </nav>
  );
}

export function MHeader({ user, onBell, hasUnread, onAvatar }) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const initial = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <header className="mheader">
      <button className="m-ava" onClick={onAvatar} aria-label="Profile" style={{ border: 'none', cursor: 'pointer' }}>{initial}</button>
      <div className="m-greet">{greet}<b>{user?.name || 'there'}</b></div>
      <span className="muted small" style={{ fontSize: 12 }}>{today}</span>
      <button className="m-bell" onClick={onBell} aria-label="Notifications">
        <span aria-hidden="true">🔔</span>
        {hasUnread && <span className="dot" aria-label="Unread notifications" />}
      </button>
    </header>
  );
}

export function HeroBalance({ label, value, currency = 'INR', trend, onToggle, hidden, actionLabel, onAction }) {
  return (
    <section className="hero" aria-label={label}>
      <div className="h-label">{label}
        <button className="h-eye" onClick={onToggle} aria-label={hidden ? 'Show balance' : 'Hide balance'} aria-pressed={!!hidden}>
          {hidden ? '◌' : '◉'}
        </button>
      </div>
      <div className="h-bal">{hidden ? '••••••' : formatINR(value)}</div>
      <div className="h-sub">
        <span>{currency}</span>
        {trend && (
          <span className={`h-trend${trend.down ? ' down' : ''}`}>
            {trend.down ? '↓' : '↑'} {trend.text}
          </span>
        )}
        {actionLabel && <button className="h-eye" style={{ fontSize: 12, padding: '0 14px', width: 'auto' }} onClick={onAction}>{actionLabel}</button>}
      </div>
    </section>
  );
}

export function QuickDock({ actions }) {
  return (
    <div className="qdock" role="group" aria-label="Quick actions">
      {actions.map((a) => (
        <button key={a.id} className="qact" onClick={a.onClick}>
          <span className="qa-ico" aria-hidden="true">{a.ico}</span>
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

export function MetricDuo({ left, right }) {
  const one = (m, cls) => (
    <div className={`metric ${cls}`}>
      <div className="m-label">{m.ico} {m.label}</div>
      <div className="m-value">{formatINR(m.value)}</div>
      {m.sub && <div className="m-sub">{m.sub}</div>}
    </div>
  );
  return <div className="duo">{one(left, 'in')}{one(right, '')}</div>;
}

export function FlowChart({ data, height = 190, money = true }) {
  if (!data || data.length < 2) return <div className="statebox"><p>Not enough activity yet — charts appear after a few days of data.</p></div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="mflow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#398BEE" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#398BEE" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="mflow2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#07865F" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#07865F" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 6" stroke="var(--line)" vertical={false} />
        <XAxis dataKey="d" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} minTickGap={32} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={44}
          tickFormatter={(v) => (money ? (v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`) : v)} />
        <Tooltip formatter={(v, name) => [money ? formatINR(v) : v, name]} labelStyle={{ color: 'var(--ink)' }} />
        <Area type="monotone" dataKey="v" name="Balance" stroke="#398BEE" strokeWidth={2.5} fill="url(#mflow)" />
        <Area type="monotone" dataKey="i" name="Income" stroke="#07865F" strokeWidth={2} fill="url(#mflow2)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const CAT_ICON = {
  Food: '🍽️', Transport: '🚕', Transportation: '🚕', Travel: '✈️', Shopping: '🛍️',
  Housing: '🏠', Rent: '🏠', Utilities: '💡', Health: '🏥', Entertainment: '🎬',
  Education: '📚', Salary: '💼', Freelance: '🧑‍💻', Investment: '📈', Transfer: '⇄',
  UPI: '📱', Groceries: '🧺', Dining: '🍽️', Fuel: '⛽', Default: '🧾'
};
export function CatIcon({ category, type }) {
  const ico = type === 'transfer' ? '⇄' : type === 'income' ? '↓' : type === 'refund' ? '↩' : (CAT_ICON[category] || CAT_ICON.Default);
  return <span className="catic" aria-hidden="true">{ico}</span>;
}

export function TxnRow({ t, onOpen }) {
  const isPos = t.type === 'income' || t.type === 'refund';
  const sign = t.type === 'income' ? '+' : t.type === 'refund' ? '+' : t.type === 'transfer' ? '' : '−';
  return (
    <button className="trow" onClick={() => onOpen && onOpen(t)} aria-label={`${t.merchant || t.category}, ${formatINR(t.amount)}`}>
      <CatIcon category={t.category} type={t.type} />
      <span className="t-main">
        <span className="t-name">{t.merchant || t.category || t.type}</span>
        <span className="t-meta">{t.date?.slice(5).replace('-', '/')} · {t.category || t.type}{t.status && t.status !== 'completed' ? ` · ${t.status}` : ''}</span>
      </span>
      <span className={`t-amt${isPos ? ' pos' : ''}`}>{sign}{formatINR(Math.abs(t.amount))}</span>
    </button>
  );
}

export function DayHeader({ date, total }) {
  return <div className="t-day">{date}{total != null ? ` · ${formatINR(total)}` : ''}</div>;
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="chips" role="group">
      {options.map((o) => (
        <button key={o.id} className={`chip${value === o.id ? ' on' : ''}`} onClick={() => onChange(o.id)} aria-pressed={value === o.id}>{o.label}</button>
      ))}
    </div>
  );
}

export function SegTabs({ options, value, onChange }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Sheet({ title, sub, onClose, children }) {
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1 }}><h3>{title}</h3>{sub && <div className="s-sub">{sub}</div>}</div>
          <button className="btn" onClick={onClose} aria-label="Close" style={{ minWidth: 44 }}>✕</button>
        </div>
        {children}
      </div>
    </>
  );
}

export function StateBox({ ico = '🧾', text, actionLabel, onAction }) {
  return (
    <div className="statebox">
      <div className="s-ico" aria-hidden="true">{ico}</div>
      <p>{text}</p>
      {actionLabel && <button className="btn primary" onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

export function Skel({ h = 64 }) {
  return <div className="skel" style={{ height: h, marginBottom: 8 }} aria-hidden="true" />;
}

export function useHideBalance(key = 'fintrack_hide_bal') {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  });
  const toggle = () => {
    setHidden((h) => {
      try { localStorage.setItem(key, h ? '0' : '1'); } catch { /* ignore */ }
      return !h;
    });
  };
  return [hidden, toggle];
}
