// FinTrack mobile screens — Home, Activity, Cards, Insights, Profile.
// Every figure is computed from live props (ledger, accounts, budgets,
// goals, recurring). No mock data; empty states say so explicitly.
import React, { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts';
import { api } from '../services/api.js';
import { overview, monthTotals, computeBalances, currentMonthKey, formatINR } from '../services/finance.js';
import { expenseByCategory } from '../services/analyticsService.js';
import {
  MHeader, HeroBalance, QuickDock, MetricDuo, FlowChart,
  TxnRow, DayHeader, Chips, SegTabs, Sheet, StateBox, useHideBalance
} from './ui.jsx';

const prevMonthKey = (mk) => {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const dayKey = (t) => (t.date || '').slice(0, 10);

/* ── HOME ── */
export function MobileHome({ user, transactions, accounts, budgets, go, onAdd }) {
  const [hidden, toggleHidden] = useHideBalance();
  const [unread, setUnread] = useState(0);
  const [flowTab, setFlowTab] = useState('month');
  useEffect(() => {
    api.getNotifications()
      .then((r) => setUnread((r.notifications || r || []).filter((n) => n.status === 'unread').length))
      .catch(() => {});
  }, []);

  const mk = currentMonthKey();
  const ov = useMemo(() => overview(transactions, accounts, budgets, mk), [transactions, accounts, budgets, mk]);
  const prev = useMemo(() => monthTotals(transactions, prevMonthKey(mk)), [transactions, mk]);
  const trend = useMemo(() => {
    if (!prev || (prev.income === 0 && prev.expenses === 0)) return null;
    const d = ov.net - prev.net;
    return { down: d < 0, text: `${d >= 0 ? '+' : '−'}${formatINR(Math.abs(d))} vs last mo` };
  }, [ov, prev]);

  const flow = useMemo(() => {
    const days = flowTab === 'week' ? 7 : 30;
    const buckets = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      buckets.push({ key: k, d: k.slice(5).replace('-', '/'), net: 0, inc: 0 });
    }
    const map = new Map(buckets.map((b) => [b.key, b]));
    for (const t of transactions || []) {
      const b = map.get(dayKey(t));
      if (!b || (t.status && t.status !== 'completed')) continue;
      const a = Number(t.amount) || 0;
      if (t.type === 'income') { b.net += a; b.inc += a; }
      else if (t.type === 'expense') b.net -= a;
      else if (t.type === 'refund') b.net += a;
    }
    let run = 0;
    return buckets.map((b) => { run += b.net; return { d: b.d, v: Math.round(run), i: Math.round(b.inc) }; });
  }, [transactions, flowTab]);

  const recent = useMemo(
    () => [...(transactions || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5),
    [transactions]
  );

  const topBudget = useMemo(() => {
    const spend = {};
    for (const t of transactions || []) {
      if (t.type !== 'expense' || (t.status && t.status !== 'completed')) continue;
      if ((t.date || '').slice(0, 7) !== mk) continue;
      spend[t.category || 'Other'] = (spend[t.category || 'Other'] || 0) + Number(t.amount || 0);
    }
    let best = null;
    for (const [cat, amt] of Object.entries(spend)) {
      const lim = Number((budgets || {})[cat] || 0);
      if (lim > 0 && (!best || amt / lim > best.pct)) best = { cat, amt, lim, pct: amt / lim };
    }
    return best;
  }, [transactions, budgets, mk]);

  const sub = (cur, prv, label) => {
    if (prv == null || (prv === 0 && cur === 0)) return `${label} · no prior-month data`;
    const d = cur - prv;
    if (d === 0) return 'Same as last mo';
    return `${d > 0 ? '+' : '−'}${formatINR(Math.abs(d))} vs last mo`;
  };

  return (
    <div>
      <MHeader user={user} hasUnread={unread > 0} onBell={() => go('autopilot')} onAvatar={() => go('mprofile')} />
      <HeroBalance label="Total balance" value={ov.netWorth} hidden={hidden} onToggle={toggleHidden} trend={trend} />
      <QuickDock actions={[
        { id: 'send', ico: '↑', label: 'Send', onClick: () => onAdd({ type: 'expense' }) },
        { id: 'recv', ico: '↓', label: 'Receive', onClick: () => onAdd({ type: 'income' }) },
        { id: 'xfer', ico: '⇄', label: 'Transfer', onClick: () => onAdd({ type: 'transfer' }) },
        { id: 'add', ico: '+', label: 'Add', onClick: () => onAdd({}) }
      ]} />
      <MetricDuo
        left={{ ico: '↓', label: 'Income · mo', value: ov.income, sub: sub(ov.income, prev?.income, 'this month') }}
        right={{ ico: '↑', label: 'Expenses · mo', value: ov.expenses, sub: sub(ov.expenses, prev?.expenses, 'this month') }}
      />
      <div className="msec"><h3>Cash flow</h3>
        <SegTabs options={[{ id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }]} value={flowTab} onChange={setFlowTab} />
      </div>
      <div className="card" style={{ padding: '12px 8px 4px' }}><FlowChart data={flow} /></div>
      <div className="msec"><h3>Recent activity</h3><button className="link" onClick={() => go('mactivity')}>See all</button></div>
      {recent.length === 0
        ? <StateBox text="No transactions yet — add your first one to see it here." actionLabel="Add transaction" onAction={() => onAdd({})} />
        : <div className="txrows">{recent.map((t) => <TxnRow key={t.id} t={t} onOpen={() => go('mactivity')} />)}</div>}
      {topBudget && (
        <div className="msec"><h3>Budget watch</h3></div>
      )}
      {topBudget && (
        <div className="insight">
          <span className="i-ico" aria-hidden="true">🎯</span>
          <div>You've used <b>{Math.round(topBudget.pct * 100)}%</b> of your {topBudget.cat} budget ({formatINR(topBudget.amt)} of {formatINR(topBudget.lim)}).<small>Basis: this month's ledger · tap to manage</small></div>
        </div>
      )}
    </div>
  );
}

/* ── ACTIVITY ── */
const TYPE_CHIPS = [
  { id: '', label: 'All' }, { id: 'income', label: 'Income' },
  { id: 'expense', label: 'Expenses' }, { id: 'transfer', label: 'Transfers' }
];
export function MobileActivity({ transactions, go, onAdd }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [detail, setDetail] = useState(null);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...(transactions || [])]
      .filter((t) => !type || t.type === type)
      .filter((t) => !needle || [t.merchant, t.category, t.account, t.accountFrom, t.accountTo, t.description].some((v) => (v || '').toLowerCase().includes(needle)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [transactions, q, type]);
  const groups = useMemo(() => {
    const out = [];
    let cur = null;
    for (const t of rows) {
      const d = dayKey(t);
      if (d !== cur) { cur = d; out.push({ day: d, items: [], net: 0 }); }
      out[out.length - 1].items.push(t);
      const a = Number(t.amount) || 0;
      if (t.type === 'income' || t.type === 'refund') out[out.length - 1].net += a;
      else if (t.type === 'expense') out[out.length - 1].net -= a;
    }
    return out;
  }, [rows]);
  return (
    <div>
      <div className="msec" style={{ marginTop: 2 }}><h3>Activity</h3><button className="link" onClick={() => onAdd({})}>+ Add</button></div>
      <input className="input" placeholder="Search merchant, category, account…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions"
        style={{ width: '100%', marginBottom: 8 }} />
      <Chips options={TYPE_CHIPS} value={type} onChange={setType} />
      {rows.length === 0 ? (
        <StateBox text={q || type ? 'Nothing matches these filters.' : 'No transactions yet.'} actionLabel="Add transaction" onAction={() => onAdd({})} />
      ) : (
        groups.map((g) => (
          <div key={g.day}>
            <DayHeader date={g.day} total={g.net} />
            <div className="txrows">{g.items.map((t) => <TxnRow key={t.id} t={t} onOpen={setDetail} />)}</div>
          </div>
        ))
      )}
      {detail && (
        <Sheet title={detail.merchant || detail.category || detail.type} sub={`${detail.date} · ${detail.status || 'completed'}`} onClose={() => setDetail(null)}>
          <ul className="legend">
            <li><span>Amount</span><span>{formatINR(detail.amount)}</span></li>
            <li><span>Type</span><span>{detail.type}</span></li>
            <li><span>Category</span><span>{detail.category || '—'}</span></li>
            <li><span>Account</span><span>{detail.type === 'transfer' ? `${detail.accountFrom} → ${detail.accountTo}` : detail.account}</span></li>
            {detail.paymentMethod && <li><span>Method</span><span>{detail.paymentMethod}</span></li>}
            {detail.description && <li><span>Note</span><span>{detail.description}</span></li>}
          </ul>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => { setDetail(null); go('transactions'); }}>Edit in ledger</button>
            <button className="btn" onClick={() => setDetail(null)}>Close</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/* ── CARDS (wallet of real accounts — no invented numbers or controls) ── */
export function MobileCards({ accounts, transactions, go }) {
  const withBal = useMemo(() => computeBalances(accounts, transactions), [accounts, transactions]);
  const [sel, setSel] = useState(null);
  const current = withBal.find((a) => a.id === sel) || withBal[0];
  const activity = useMemo(() => {
    if (!current) return [];
    return [...(transactions || [])]
      .filter((t) => t.account === current.name || t.accountFrom === current.name || t.accountTo === current.name)
      .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  }, [transactions, current]);
  if (withBal.length === 0) {
    return <StateBox ico="💳" text="No accounts yet — add your cash, bank or card accounts first." actionLabel="Manage accounts" onAction={() => go('accounts')} />;
  }
  return (
    <div>
      <div className="msec" style={{ marginTop: 2 }}><h3>My cards &amp; accounts</h3><button className="link" onClick={() => go('accounts')}>Manage</button></div>
      {withBal.map((a, i) => (
        <button key={a.id} className={`wcard${current && current.id === a.id ? ' sel' : ''}${i % 2 ? ' alt' : ''}`} onClick={() => setSel(a.id)} aria-pressed={current && current.id === a.id}>
          <div className="w-name">{a.name} · {a.type?.replace('_', ' ')}</div>
          <div className="w-bal">{formatINR(a.balance)}</div>
          <div className="w-foot"><span>{a.institution || 'FinTrack wallet'}</span><span>{a.status || 'active'}</span></div>
        </button>
      ))}
      {current && (
        <>
          <div className="msec"><h3>Recent · {current.name}</h3></div>
          {activity.length === 0 ? <StateBox text="No activity on this account yet." /> : (
            <div className="txrows">{activity.map((t) => <TxnRow key={t.id} t={t} onOpen={() => go('mactivity')} />)}</div>
          )}
        </>
      )}
    </div>
  );
}

/* ── INSIGHTS (computed, with stated basis) ── */
export function MobileInsights({ transactions, budgets, goals, recurring, go }) {
  const mk = currentMonthKey();
  const pmk = prevMonthKey(mk);
  const cur = useMemo(() => monthTotals(transactions, mk), [transactions, mk]);
  const prev = useMemo(() => monthTotals(transactions, pmk), [transactions, pmk]);
  const range = useMemo(() => ({ start: `${mk}-01`, end: `${mk}-31` }), [mk]);
  const cats = useMemo(() => {
    try { return expenseByCategory(transactions, range, {}); }
    catch { return { rows: [], total: 0 }; }
  }, [transactions, range]);
  const top = cats.rows?.slice(0, 6) || [];
  const upcoming = useMemo(() => (recurring || []).filter((r) => r.status === 'active').length, [recurring]);
  const goal = (goals || [])[0];
  const goalPct = goal && Number(goal.target) > 0 ? Math.min(100, (Number(goal.current || 0) / Number(goal.target)) * 100) : null;
  const mover = useMemo(() => {
    const sum = (m) => {
      const s = {};
      for (const t of transactions || []) {
        if (t.type !== 'expense' || (t.status && t.status !== 'completed')) continue;
        if ((t.date || '').slice(0, 7) !== m) continue;
        s[t.category || 'Other'] = (s[t.category || 'Other'] || 0) + Number(t.amount || 0);
      }
      return s;
    };
    const a = sum(mk), b = sum(pmk);
    let best = null;
    for (const [c, v] of Object.entries(a)) {
      if ((b[c] || 0) > 0) {
        const pct = ((v - b[c]) / b[c]) * 100;
        if (!best || Math.abs(pct) > Math.abs(best.pct)) best = { c, pct };
      }
    }
    return best;
  }, [transactions, mk, pmk]);
  const COLORS = ['#398BEE', '#07865F', '#F0A63C', '#8B7CF6', '#E0786E', '#4CC3D9'];
  return (
    <div>
      <div className="msec" style={{ marginTop: 2 }}><h3>Insights</h3><button className="link" onClick={() => go('reports')}>Full reports</button></div>
      <div className="card">
        <div className="card-head"><h3>Spending by category · {mk}</h3></div>
        {top.length === 0 ? <StateBox text="No spending this month yet." /> : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={top} dataKey="amount" nameKey="category" innerRadius={52} outerRadius={80} paddingAngle={2}>
                {top.map((r, i) => <Cell key={r.category} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v, n, p) => [`${formatINR(v)} (${p.payload.share?.toFixed(1)}%)`, p.payload.category]} />
            </PieChart>
          </ResponsiveContainer>
        )}
        <ul className="legend">{top.map((r, i) => (
          <li key={r.category}><span><span className="dot" style={{ background: COLORS[i % COLORS.length] }} />{r.category}</span><span>{formatINR(r.amount)}</span></li>
        ))}</ul>
      </div>
      <div className="card">
        <div className="card-head"><h3>Income vs expenses</h3></div>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={[{ m: 'Last', i: Math.round(prev.income), e: Math.round(prev.expenses) }, { m: 'This', i: Math.round(cur.income), e: Math.round(cur.expenses) }]} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="m" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={46} tickFormatter={(v) => (v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)} />
            <Tooltip formatter={(v, n) => [formatINR(v), n === 'i' ? 'Income' : 'Expenses']} />
            <Bar dataKey="i" name="i" fill="#07865F" radius={[6, 6, 0, 0]} />
            <Bar dataKey="e" name="e" fill="#398BEE" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="muted small">Basis: completed ledger entries · last vs this month</p>
      </div>
      {mover && Math.abs(mover.pct) >= 1 && (
        <div className="insight info"><span className="i-ico" aria-hidden="true">📊</span>
          <div>Your {mover.c} spending {mover.pct > 0 ? 'increased' : 'decreased'} {Math.abs(mover.pct).toFixed(0)}% compared with last month.<small>Basis: completed expenses, {pmk} → {mk}</small></div>
        </div>
      )}
      {typeof goalPct === 'number' && (
        <div className="insight"><span className="i-ico" aria-hidden="true">🐷</span>
          <div>{goal.name}: {goalPct.toFixed(0)}% funded ({formatINR(goal.current)} of {formatINR(goal.target)}).<small>Basis: your oldest active goal</small></div>
        </div>
      )}
      {upcoming > 0 && (
        <div className="insight warn"><span className="i-ico" aria-hidden="true">🔁</span>
          <div>{upcoming} recurring payment{upcoming === 1 ? ' is' : 's are'} active — review dates and amounts.<small>Basis: active recurring schedules</small></div>
        </div>
      )}
      {cur.savingsRate != null && (
        <div className="insight"><span className="i-ico" aria-hidden="true">💹</span>
          <div>Savings rate this month: {cur.savingsRate.toFixed(0)}%.<small>Basis: (income − expenses) ÷ income</small></div>
        </div>
      )}
    </div>
  );
}

/* ── PROFILE ── */
const MORE_LINKS = [
  ['command', '🎛️', 'Command Center'], ['cashflow', '🔮', 'Cash Flow'], ['budgets', '🎯', 'Budgets'],
  ['goals', '🐷', 'Savings Goals'], ['recurring', '🔁', 'Recurring'], ['accounts', '🏦', 'Accounts'],
  ['categories', '🏷️', 'Categories'], ['upi', '📱', 'UPI'], ['autopilot', '✈️', 'Autopilot'],
  ['trends', '📈', 'Trends'], ['calculators', '🧮', 'Calculators'], ['tips', '💡', 'Tips'],
  ['learn', '📚', 'Learn'], ['assetsdebt', '⚖️', 'Assets & Debt']
];
export function MobileProfile({ user, go, onLogout }) {
  const [showAll, setShowAll] = useState(false);
  const initial = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();
  const row = (ico, title, sub, target) => (
    <button key={title} className="prow" onClick={() => go(target)}>
      <span className="p-ico" aria-hidden="true">{ico}</span>
      <span style={{ textAlign: 'left' }}><b>{title}</b><span>{sub}</span></span>
      <span className="chev" aria-hidden="true">›</span>
    </button>
  );
  return (
    <div>
      <div className="msec" style={{ marginTop: 2 }}><h3>Profile</h3></div>
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span className="avatar" style={{ width: 52, height: 52, fontSize: 20 }}>{initial}</span>
        <div><b style={{ fontSize: 16 }}>{user?.name}</b><div className="muted small">{user?.email}</div></div>
      </div>
      {row('👤', 'Personal & preferences', 'Name, avatar, theme, currency', 'settings')}
      {row('🛡️', 'Security & privacy', 'Sessions, password, activity', 'security')}
      {row('💾', 'Data portability', 'Backups, export, restore', 'portability')}
      <div className="msec"><h3>More features</h3><button className="link" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Less' : 'All'}</button></div>
      {(showAll ? MORE_LINKS : MORE_LINKS.slice(0, 6)).map(([id, ico, label]) => (
        <button key={id} className="prow" onClick={() => go(id)}>
          <span className="p-ico" aria-hidden="true">{ico}</span>
          <span style={{ textAlign: 'left' }}><b>{label}</b></span>
          <span className="chev" aria-hidden="true">›</span>
        </button>
      ))}
      <div className="msec"><h3>Account</h3></div>
      <button className="prow" onClick={() => { if (window.confirm('Sign out of FinTrack on this device?')) onLogout(); }}>
        <span className="p-ico" aria-hidden="true">⎋</span>
        <span style={{ textAlign: 'left' }}><b>Sign out</b><span>Ends this session</span></span>
      </button>
      <p className="muted small" style={{ textAlign: 'center' }}>FinTrack · your data stays in your database</p>
    </div>
  );
}
