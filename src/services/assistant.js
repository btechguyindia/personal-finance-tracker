// FinTrack Assistant brain — pure, rule-based answers over the user's own
// ledger data. No network, no AI service. Covered by tests/assistant.test.mjs.
import { formatINR } from './analyticsService.js';

const currentMonthPrefix = () => new Date().toISOString().slice(0, 7);

function isCounted(t) {
  return !t.status || t.status === 'completed';
}

function monthTxns(transactions, prefix) {
  return (transactions || []).filter((t) => isCounted(t) && String(t.date || '').startsWith(prefix));
}

function sumBy(rows, type) {
  return rows.filter((t) => t.type === type).reduce((s, t) => s + (Number(t.amount) || 0), 0);
}

function spendingAnswer(transactions, prefix) {
  const rows = monthTxns(transactions, prefix);
  const spent = sumBy(rows, 'expense') - sumBy(rows, 'refund');
  const earned = sumBy(rows, 'income');
  const n = rows.filter((t) => t.type === 'expense').length;
  if (rows.length === 0) return 'No transactions recorded this month yet. Add one with the + Add button and I can break it down for you.';
  return `This month: spent ${formatINR(spent)} across ${n} expense${n === 1 ? '' : 's'}, earned ${formatINR(earned)}. Net: ${formatINR(earned - spent)}.`;
}

function topCategoryAnswer(transactions, prefix) {
  const rows = monthTxns(transactions, prefix).filter((t) => t.type === 'expense');
  if (rows.length === 0) return 'No expenses this month, so no top category yet.';
  const byCat = new Map();
  for (const t of rows) byCat.set(t.category, (byCat.get(t.category) || 0) + Number(t.amount || 0));
  const [cat, amt] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
  const total = [...byCat.values()].reduce((s, v) => s + v, 0);
  const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
  return `Your top category this month is ${cat}: ${formatINR(amt)} (${pct}% of spending).`;
}

function budgetAnswer(transactions, budgets, prefix) {
  const rows = monthTxns(transactions, prefix).filter((t) => t.type === 'expense');
  const spent = new Map();
  for (const t of rows) spent.set(t.category, (spent.get(t.category) || 0) + Number(t.amount || 0));
  const limits = Object.entries(budgets || {}).filter(([, v]) => Number(v) > 0);
  if (limits.length === 0) return 'No budgets set — add some on the Budgets tab and I will track them here.';
  const over = limits
    .map(([cat, lim]) => ({ cat, lim: Number(lim), used: spent.get(cat) || 0 }))
    .filter((x) => x.used > x.lim);
  if (over.length === 0) {
    const hottest = limits
      .map(([cat, lim]) => ({ cat, pct: ((spent.get(cat) || 0) / Number(lim)) * 100 }))
      .sort((a, b) => b.pct - a.pct)[0];
    return `All budgets on track. Closest to the limit: ${hottest.cat} at ${Math.round(hottest.pct)}%.`;
  }
  return `Over budget: ${over.map((x) => `${x.cat} (${formatINR(x.used)} of ${formatINR(x.lim)})`).join(', ')}.`;
}

function savingsAnswer(transactions, prefix) {
  const rows = monthTxns(transactions, prefix);
  const earned = sumBy(rows, 'income');
  const spent = sumBy(rows, 'expense') - sumBy(rows, 'refund');
  if (earned <= 0) return 'No income recorded this month, so I cannot compute a savings rate yet.';
  const rate = ((earned - spent) / earned) * 100;
  return `Savings rate this month: ${rate.toFixed(1)}% (${formatINR(earned - spent)} of ${formatINR(earned)} kept).`;
}

function balanceAnswer(accounts) {
  const list = accounts || [];
  if (list.length === 0) return 'No accounts found.';
  const assets = list.filter((a) => !a.isLiability).reduce((s, a) => s + Number(a.balance || 0), 0);
  const debt = list.filter((a) => a.isLiability).reduce((s, a) => s + Number(a.balance || 0), 0);
  const top = [...list].sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))[0];
  return `Net across accounts: ${formatINR(assets - debt)} (assets ${formatINR(assets)}${debt > 0 ? `, card dues ${formatINR(debt)}` : ''}). Highest: ${top.name} at ${formatINR(top.balance)}.`;
}

function goalsAnswer(goals) {
  const list = (goals || []).filter((g) => g.status !== 'completed');
  if (list.length === 0) return 'No active savings goals. Create one on the Savings Goals tab and I will track your progress.';
  const g = [...list].sort((a, b) => (b.current / Math.max(1, b.target)) - (a.current / Math.max(1, a.target)))[0];
  const pct = g.target > 0 ? Math.round((g.current / g.target) * 100) : 0;
  return `${g.name}: ${formatINR(g.current)} of ${formatINR(g.target)} (${pct}%). ${list.length > 1 ? `${list.length - 1} other active goal${list.length > 2 ? 's' : ''}.` : 'Keep going!'}`;
}

export const ASSISTANT_SUGGESTIONS = [
  'How much did I spend this month?',
  'What is my top category?',
  'Am I over budget?',
  'What is my savings rate?',
  'How are my goals doing?'
];

export function assistantReply(text, ctx = {}) {
  const q = String(text || '').toLowerCase();
  const { transactions = [], budgets = {}, accounts = [], goals = [], userName = '' } = ctx;
  const prefix = currentMonthPrefix();
  const has = (...words) => words.some((w) => q.includes(w));

  if (has('hello', 'hi ', ' hey', 'namaste', 'good morning', 'good evening') && q.length < 30) {
    return `Hello${userName ? ` ${userName}` : ''}! I can summarise your spending, budgets, savings and goals — all from your own ledger. Try one of the suggestions below.`;
  }
  if (has('spend', 'spent', 'expense', 'kharch')) return spendingAnswer(transactions, prefix);
  if (has('income', 'earn', 'salary')) {
    const earned = sumBy(monthTxns(transactions, prefix), 'income');
    return earned > 0 ? `Recorded income this month: ${formatINR(earned)}.` : 'No income recorded this month yet.';
  }
  if (has('top categor', 'where does', 'where is', 'biggest')) return topCategoryAnswer(transactions, prefix);
  if (has('budget', 'over budget', 'limit')) return budgetAnswer(transactions, budgets, prefix);
  if (has('saving', 'save rate', 'savings rate')) return savingsAnswer(transactions, prefix);
  if (has('balance', 'net worth', 'networth', 'rich', 'total money')) return balanceAnswer(accounts);
  if (has('goal')) return goalsAnswer(goals);
  if (has('help', 'what can you', 'who are you', 'your name')) {
    return 'I am your FinTrack assistant. Ask me about monthly spending, top categories, budgets, savings rate, balances or goal progress.';
  }
  if (has('thank', 'thanks', 'shukriya')) return 'Anytime! Good money habits compound.';
  return 'I can help with spending, top categories, budgets, savings rate, balances and goals. Tap a suggestion or rephrase — e.g. "how much did I spend this month?"';
}
