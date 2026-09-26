import React, { useCallback, useEffect, useState } from 'react';
import AnalyticsPage from './components/AnalyticsPage.jsx';
import TransactionsPage from './components/TransactionsPage.jsx';
import BudgetsPage from './components/BudgetsPage.jsx';
import OverviewPage from './components/OverviewPage.jsx';
import AccountsPage from './components/AccountsPage.jsx';
import CategoriesPage from './components/CategoriesPage.jsx';
import UpiPage from './components/UpiPage.jsx';
import GoalsPage from './components/GoalsPage.jsx';
import RecurringPage from './components/RecurringPage.jsx';
import CalculatorsPage from './components/CalculatorsPage.jsx';
import AutopilotPage from './components/AutopilotPage.jsx';
import TipsPage from './components/TipsPage.jsx';
import TrendsPage from './components/TrendsPage.jsx';
import LearnToolsPage from './components/LearnToolsPage.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import SecurityPage from './components/SecurityPage.jsx';
import CommandCenterPage from './components/CommandCenterPage.jsx';
import CashflowPage from './components/CashflowPage.jsx';
import BucketsPage from './components/BucketsPage.jsx';
import DetectivePage from './components/DetectivePage.jsx';
import HeatmapPage from './components/HeatmapPage.jsx';
import PurchaseLabPage from './components/PurchaseLabPage.jsx';
import AnalystPage from './components/AnalystPage.jsx';
import SubscriptionsPage from './components/SubscriptionsPage.jsx';
import AccuracyPage from './components/AccuracyPage.jsx';
import MilestonesPage from './components/MilestonesPage.jsx';
import AdvancedAnalyticsPage from './components/AdvancedAnalyticsPage.jsx';
import Celebration from './components/Celebration.jsx';
import Assistant from './components/Assistant.jsx';
import Login from './components/Login.jsx';
import { api, clearToken, getToken, getTheme } from './services/api.js';

const NAV = [
  { id: 'command', label: 'Command Center', ico: '🎛️' },
  { id: 'overview', label: 'Overview', ico: '🏠' },
  { id: 'cashflow', label: 'Cash Flow', ico: '🔮' },
  { id: 'buckets', label: 'Buckets', ico: '🪣' },
  { id: 'transactions', label: 'Transactions', ico: '🧾' },
  { id: 'detective', label: 'Detective', ico: '🕵️' },
  { id: 'heatmap', label: 'Heatmap', ico: '🗓️' },
  { id: 'purchaselab', label: 'Purchase Lab', ico: '🧪' },
  { id: 'analyst', label: 'AI Analyst', ico: '🤖' },
  { id: 'subs', label: 'Subscriptions', ico: '📡' },
  { id: 'accuracy', label: 'Accuracy', ico: '🎯' },
  { id: 'milestones', label: 'Milestones', ico: '🏆' },
  { id: 'advanced', label: 'Advanced', ico: '🧬' },
  { id: 'accounts', label: 'Accounts & Wallets', ico: '🏦' },
  { id: 'budgets', label: 'Budgets', ico: '🎯' },
  { id: 'categories', label: 'Categories', ico: '🏷️' },
  { id: 'upi', label: 'UPI', ico: '📱' },
  { id: 'goals', label: 'Savings Goals', ico: '🐷' },
  { id: 'reports', label: 'Reports & Analytics', ico: '📊' },
  { id: 'recurring', label: 'Recurring', ico: '🔁' },
  { id: 'calculators', label: 'Calculators', ico: '🧮' },
  { id: 'autopilot', label: 'Autopilot', ico: '✈️' },
  { id: 'tips', label: 'Tips & Suggestions', ico: '💡' },
  { id: 'trends', label: 'Trends & Health', ico: '📈' },
  { id: 'learn', label: 'Learn & Tools', ico: '📚' },
  { id: 'security', label: 'Security & Privacy', ico: '🛡️' },
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
          {NAV.map((n) => (
            <button key={n.id} className={tab === n.id ? 'on' : ''} onClick={() => go(n.id)}>
              <span className="ico">{n.ico}</span> {n.label}
            </button>
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
          {tab === 'settings' && (
            <SettingsPage user={user} preferences={prefs} onPrefsChanged={setPrefs} onTheme={() => {}} onWipe={wipe} onUserChanged={setUser} onNavigate={go} />
          )}
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
