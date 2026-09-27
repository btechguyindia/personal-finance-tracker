import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
// Code-split: only the landing page (Overview) + shell load upfront.
// Every other tab loads on demand — this keeps first paint fast despite
// 27 pages and heavy chart/export libraries (recharts, xlsx, jspdf).
import OverviewPage from './components/OverviewPage.jsx';
const AnalyticsPage = lazy(() => import('./components/AnalyticsPage.jsx'));
const TransactionsPage = lazy(() => import('./components/TransactionsPage.jsx'));
const BudgetsPage = lazy(() => import('./components/BudgetsPage.jsx'));
const AccountsPage = lazy(() => import('./components/AccountsPage.jsx'));
const CategoriesPage = lazy(() => import('./components/CategoriesPage.jsx'));
const UpiPage = lazy(() => import('./components/UpiPage.jsx'));
const GoalsPage = lazy(() => import('./components/GoalsPage.jsx'));
const RecurringPage = lazy(() => import('./components/RecurringPage.jsx'));
const CalculatorsPage = lazy(() => import('./components/CalculatorsPage.jsx'));
const AutopilotPage = lazy(() => import('./components/AutopilotPage.jsx'));
const TipsPage = lazy(() => import('./components/TipsPage.jsx'));
const TrendsPage = lazy(() => import('./components/TrendsPage.jsx'));
const LearnToolsPage = lazy(() => import('./components/LearnToolsPage.jsx'));
const SettingsPage = lazy(() => import('./components/SettingsPage.jsx'));
const SecurityPage = lazy(() => import('./components/SecurityPage.jsx'));
const PortabilityPage = lazy(() => import('./components/PortabilityPage.jsx'));
const AssetsDebtPage = lazy(() => import('./components/AssetsDebtPage.jsx'));
const CommandCenterPage = lazy(() => import('./components/CommandCenterPage.jsx'));
const CashflowPage = lazy(() => import('./components/CashflowPage.jsx'));
const BucketsPage = lazy(() => import('./components/BucketsPage.jsx'));
const DetectivePage = lazy(() => import('./components/DetectivePage.jsx'));
const HeatmapPage = lazy(() => import('./components/HeatmapPage.jsx'));
const PurchaseLabPage = lazy(() => import('./components/PurchaseLabPage.jsx'));
const AnalystPage = lazy(() => import('./components/AnalystPage.jsx'));
const SubscriptionsPage = lazy(() => import('./components/SubscriptionsPage.jsx'));
const AccuracyPage = lazy(() => import('./components/AccuracyPage.jsx'));
const MilestonesPage = lazy(() => import('./components/MilestonesPage.jsx'));
const AdvancedAnalyticsPage = lazy(() => import('./components/AdvancedAnalyticsPage.jsx'));
import Celebration from './components/Celebration.jsx';
import Assistant from './components/Assistant.jsx';
import Login from './components/Login.jsx';
import { api, clearToken, getToken, getTheme } from './services/api.js';

const NAV = [
  { section: 'Home' },
  { id: 'command', label: 'Command Center', ico: '🎛️' },
  { id: 'overview', label: 'Overview', ico: '🏠' },
  { id: 'transactions', label: 'Transactions', ico: '🧾' },
  { id: 'cashflow', label: 'Cash Flow', ico: '🔮' },
  { section: 'Plan ahead' },
  { id: 'budgets', label: 'Budgets', ico: '🎯' },
  { id: 'goals', label: 'Savings Goals', ico: '🐷' },
  { id: 'recurring', label: 'Recurring', ico: '🔁' },
  { id: 'buckets', label: 'Buckets', ico: '🪣' },
  { id: 'milestones', label: 'Milestones', ico: '🏆' },
  { id: 'purchaselab', label: 'Purchase Lab', ico: '🧪' },
  { id: 'calculators', label: 'Calculators', ico: '🧮' },
  { id: 'autopilot', label: 'Autopilot', ico: '✈️' },
  { section: 'Understand' },
  { id: 'reports', label: 'Reports & Analytics', ico: '📊' },
  { id: 'trends', label: 'Trends & Health', ico: '📈' },
  { id: 'heatmap', label: 'Heatmap', ico: '🗓️' },
  { id: 'advanced', label: 'Advanced', ico: '🧬' },
  { id: 'detective', label: 'Detective', ico: '🕵️' },
  { id: 'accuracy', label: 'Accuracy', ico: '🔎' },
  { id: 'analyst', label: 'AI Analyst', ico: '🤖' },
  { id: 'tips', label: 'Tips & Suggestions', ico: '💡' },
  { id: 'learn', label: 'Learn & Tools', ico: '📚' },
  { section: 'Manage' },
  { id: 'accounts', label: 'Accounts & Wallets', ico: '🏦' },
  { id: 'assetsdebt', label: 'Assets & Debt', ico: '⚖️' },
  { id: 'categories', label: 'Categories', ico: '🏷️' },
  { id: 'upi', label: 'UPI', ico: '📱' },
  { id: 'subs', label: 'Subscriptions', ico: '📡' },
  { id: 'security', label: 'Security & Privacy', ico: '🛡️' },
  { id: 'portability', label: 'Data Portability', ico: '💾' },
  { id: 'settings', label: 'Settings', ico: '⚙️' }
];

const TITLES = {
  command: ['Financial Command Center', 'Safe-to-spend, bills, runway, checklist + Can I afford this?'],
  cashflow: ['Future Cash Flow', '7–180d projection with breach dates + scenarios.'],
  buckets: ['Money Buckets', 'Virtual envelopes + simulated allocation (confirm to post).'],
  detective: ['Transaction Detective', 'Daily reconciliation inbox — flags only, never auto-deletes.'],
  heatmap: ['Spending Heatmap', 'Daily calendar, weekday stats, day timeline.'],
  purchaselab: ['Purchase Lab', 'Buy today vs next month vs save 3 months.'],
  analyst: ['AI Analyst', 'Cited answers from your ledger — says when data is incomplete.'],
  subs: ['Subscriptions Radar', 'Detected renewals, totals, confirm/dismiss.'],
  accuracy: ['Accuracy Monitor', 'Statement vs ledger + monthly books-closed report.'],
  milestones: ['Milestones', 'Measurable targets with plan-vs-actual timeline.'],
  advanced: ['Advanced Analytics', 'Sankey, velocity, lifestyle, stress-test, anomaly map.'],
  overview: ['Overview', 'Your complete financial picture — live from your ledger.'],
  transactions: ['Transactions', 'Every rupee earned, spent, transferred or refunded.'],
  accounts: ['Accounts & Wallets', 'Cash, banks, UPI accounts and credit cards.'],
  assetsdebt: ['Assets & Debt', 'Net worth, asset register, loans, payoff plans and payments.'],
  budgets: ['Budgets', 'Monthly limits with live utilization.'],
  categories: ['Categories', 'Editable hierarchy with real spending.'],
  upi: ['UPI', 'Saved UPI IDs and UPI transaction tracking.'],
  goals: ['Savings Goals', 'Targets, contributions and progress.'],
  reports: ['Reports & Analytics', 'Interactive charts, comparisons and insights.'],
  recurring: ['Recurring Payments', 'Rent, SIPs & subscriptions auto-created on schedule.'],
  calculators: ['Calculators', 'EMI, SIP, FD, interest and discount maths.'],
  autopilot: ['Autopilot', 'Rules that watch, notify and draft — never move money.'],
  tips: ['Tips & Suggestions', 'Daily tip, personalized advice and smart money moves.'],
  trends: ['Trends & Health', '6-month trends, movers and your financial health score.'],
  learn: ['Learn & Tools', 'Money guides plus SIP, tax, emergency and 50/30/20 tools.'],
  security: ['Security & Privacy', 'Sessions, activity, password and account deletion.'],
  portability: ['Data Portability', 'Versioned backups, validation, restore preview and safe restore.'],
  settings: ['Settings', 'Profile, preferences, backup and privacy.']
};

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState('overview');
  const [navOpen, setNavOpen] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [customCats, setCustomCats] = useState([]);
  const [upiIds, setUpiIds] = useState([]);
  const [goals, setGoals] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [prefs, setPrefs] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalSignal, setModalSignal] = useState(0);
  const [celebration, setCelebration] = useState(null);

  useEffect(() => {
    const t = getTheme();
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [txns, b, a, cats, upi, g, r, p] = await Promise.all([
        api.listTransactions(), api.getBudgets(), api.getAccounts(),
        api.getCategories(), api.getUpiIds(), api.getGoals(),
        api.getRecurring(), api.getPreferences()
      ]);
      setTransactions(txns); setBudgets(b); setAccounts(a);
      setCustomCats(cats); setUpiIds(upi); setGoals(g);
      setRecurring(r); setPrefs(p);
      if (p?.theme) {
        document.documentElement.setAttribute('data-theme', p.theme);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (!getToken()) { setAuthChecked(true); return; }
      try {
        const { user: u } = await api.me();
        setUser(u);
        await loadAll();
      } catch {
        clearToken();
      } finally {
        setAuthChecked(true);
      }
    })();
  }, [loadAll]);

  const handleLogin = async (u) => {
    setUser(u);
    setTab('overview');
    await loadAll();
  };

  const logout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    clearToken();
    setUser(null);
    setTransactions([]); setBudgets({}); setAccounts([]);
    setCustomCats([]); setUpiIds([]); setGoals([]); setRecurring([]);
  };

  const wipe = async () => {
    await api.wipeData();
    await loadAll();
  };

  const go = (id) => { setTab(id); setNavOpen(false); };

  if (!authChecked) return <div className="main"><div className="card">Loading…</div></div>;
  if (!user) return <Login onLogin={handleLogin} />;

  const [title, sub] = TITLES[tab] || ['FinTrack', ''];
  const initial = (user.name || user.email || '?').slice(0, 1).toUpperCase();

  return (
    <div className="shell">
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="brand"><span className="mark">₹</span><div>FinTrack<small>Personal finance wallet</small></div></div>
        <nav className="nav">
          {NAV.map((n, i) => (
            n.section
              ? <div key={`sec-${i}`} className="section">{n.section}</div>
              : (
                <button key={n.id} className={tab === n.id ? 'on' : ''} onClick={() => go(n.id)}>
                  <span className="ico">{n.ico}</span> {n.label}
                </button>
              )
          ))}
        </nav>
        <div className="side-foot">
          <div className="user-chip">
            {user.avatar ? (
              <span className="avatar" style={{ background: user.avatar.color }}>{user.avatar.emoji}</span>
            ) : (
              <span className="avatar">{initial}</span>
            )}
            <div className="who"><b>{user.name}</b><span>{user.email}</span></div>
          </div>
          <div className="side-actions">
            <button onClick={() => { const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('fintrack_theme', t); } catch {} api.savePreferences({ theme: t }).catch(() => {}); }}>
              {document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </button>
            <button onClick={logout}>⎋ Logout</button>
          </div>
        </div>
      </aside>

      <div className="content">
        <div className="topbar">
          <div className="row">
            <button className="btn menu-btn" onClick={() => setNavOpen(true)}>☰</button>
            <div><h1>{title}</h1><p className="sub">{sub}</p></div>
          </div>
          {tab === 'transactions' && (
            <button className="btn primary" onClick={() => setModalSignal((s) => s + 1)}>+ Add Transaction</button>
          )}
        </div>
        <main className="main">
          {error && <div className="card"><div className="error">{error}</div></div>}
          {loading && <div className="muted small">Loading your data…</div>}
          <Suspense fallback={<div className="card"><div className="muted">Loading page…</div></div>}>
          {tab === 'command' && <CommandCenterPage transactions={transactions} accounts={accounts} budgets={budgets} recurring={recurring} goals={goals} />}
          {tab === 'cashflow' && <CashflowPage transactions={transactions} accounts={accounts} recurring={recurring} />}
          {tab === 'buckets' && <BucketsPage />}
          {tab === 'detective' && <DetectivePage transactions={transactions} recurring={recurring} onGoToTransactions={() => go('transactions')} />}
          {tab === 'heatmap' && <HeatmapPage transactions={transactions} />}
          {tab === 'purchaselab' && <PurchaseLabPage transactions={transactions} accounts={accounts} recurring={recurring} budgets={budgets} goals={goals} />}
          {tab === 'analyst' && <AnalystPage transactions={transactions} recurring={recurring} />}
          {tab === 'subs' && <SubscriptionsPage transactions={transactions} />}
          {tab === 'accuracy' && <AccuracyPage transactions={transactions} accounts={accounts} />}
          {tab === 'milestones' && <MilestonesPage transactions={transactions} accounts={accounts} budgets={budgets} goals={goals} />}
          {tab === 'advanced' && <AdvancedAnalyticsPage transactions={transactions} budgets={budgets} />}
          {tab === 'overview' && (
            <OverviewPage transactions={transactions} accounts={accounts} budgets={budgets} onNavigate={go} />
          )}
          {tab === 'transactions' && (
            <TransactionsPage transactions={transactions} accounts={accounts} onChanged={loadAll} modalSignal={modalSignal} onCelebrate={setCelebration} />
          )}
          {tab === 'accounts' && <AccountsPage accounts={accounts} onChanged={loadAll} />}
          {tab === 'budgets' && <BudgetsPage budgets={budgets} onChanged={(saved) => setBudgets(saved || budgets)} />}
          {tab === 'categories' && (
            <CategoriesPage customCats={customCats} transactions={transactions} onChanged={loadAll} />
          )}
          {tab === 'upi' && (
            <UpiPage upiIds={upiIds} transactions={transactions} accounts={accounts} onChanged={loadAll} />
          )}
          {tab === 'goals' && <GoalsPage goals={goals} accounts={accounts} onChanged={loadAll} onCelebrate={setCelebration} />}
          {tab === 'reports' && (
            <AnalyticsPage transactions={transactions} budgets={budgets} accounts={accounts.map((a) => a.name)} onGoToTransactions={() => go('transactions')} />
          )}
          {tab === 'recurring' && <RecurringPage rules={recurring} accounts={accounts} onChanged={loadAll} />}
          {tab === 'calculators' && <CalculatorsPage />}
          {tab === 'autopilot' && <AutopilotPage />}
          {tab === 'tips' && (
            <TipsPage transactions={transactions} budgets={budgets} recurring={recurring} onNavigate={go} />
          )}
          {tab === 'trends' && (
            <TrendsPage transactions={transactions} accounts={accounts} budgets={budgets} />
          )}
          {tab === 'learn' && (
            <LearnToolsPage transactions={transactions} accounts={accounts} />
          )}
          {tab === 'security' && (
            <SecurityPage onLogout={logout} />
          )}
          {tab === 'portability' && (
            <PortabilityPage />
          )}
          {tab === 'assetsdebt' && (
            <AssetsDebtPage accounts={accounts} transactions={transactions} />
          )}
          {tab === 'settings' && (
            <SettingsPage user={user} preferences={prefs} onPrefsChanged={setPrefs} onTheme={() => {}} onWipe={wipe} onUserChanged={setUser} onNavigate={go} />
          )}
          </Suspense>
        </main>
      </div>

      {tab !== 'transactions' && (
        <button className="fab" onClick={() => { go('transactions'); setModalSignal((s) => s + 1); }} title="Add transaction">+ Add</button>
      )}
      <Celebration data={celebration} onDone={() => setCelebration(null)} />
      <Assistant transactions={transactions} budgets={budgets} accounts={accounts} goals={goals} user={user} fabVisible={tab !== 'transactions'} />
    </div>
  );
}
