// purchaseLab.js — P1 #5 Purchase decision laboratory. Pure ESM.
import { safeToSpend } from './commandCenter.js';
import { projectCashflow } from './cashflow.js';
import { todayISO, addDaysISO, addMonthsISO } from './analyticsService.js';

export function analyzePurchase({ item, price, date, method, transactions, accounts, recurring = [], budgets = {}, goals = [], monthKey, avgMonthlyIncome = 0 }) {
  const p = Number(price || 0);
  const base = safeToSpend({ transactions, accounts, recurring, goals, horizonDays: 30, monthKey });
  const afterCash = base.cash - p;
  const billsCovered = afterCash >= base.billsTotal + base.goalReserve;
  const daysOfIncome = avgMonthlyIncome > 0 ? (p / (avgMonthlyIncome / 30)) : null;
  // goal delay: months of required contributions consumed
  const monthlyGoalNeed = (goals || []).filter((g) => g.status === 'active').reduce((s, g) => s + Number(g.requiredPerMonth || 0), 0);
  const goalDelayMonths = monthlyGoalNeed > 0 ? p / monthlyGoalNeed : null;
  return { item, price: p, date, method, safeNow: base.safe, afterCash: Math.round(afterCash * 100) / 100, billsCovered, daysOfIncome: daysOfIncome === null ? null : Math.round(daysOfIncome * 10) / 10, goalDelayMonths: goalDelayMonths === null ? null : Math.round(goalDelayMonths * 10) / 10, verdict: billsCovered && p <= base.safe ? 'comfortable' : billsCovered ? 'tight-but-covered' : 'risky' };
}

// Compare 3 scenarios using real cashflow projection.
export function compareScenarios({ price, transactions, accounts, recurring = [], planned = [], horizonDays = 120, monthlySave = 0, now = todayISO() }) {
  const p = Number(price || 0);
  const today = { name: 'Buy today', result: projectCashflow({ transactions, accounts, recurring, planned: [...planned, { date: now, amount: p, type: 'expense', name: 'planned purchase' }], horizonDays, now }) };
  const nextMonth = { name: 'Buy next month', result: projectCashflow({ transactions, accounts, recurring, planned: [...planned, { date: addMonthsISO(now, 1), amount: p, type: 'expense', name: 'planned purchase' }], horizonDays, now }) };
  // Save-for-3-months: spread price as 3 monthly savings then buy at month 3
  const save3 = { name: 'Save for 3 months', result: projectCashflow({ transactions, accounts, recurring, planned: [...planned, { date: addMonthsISO(now, 3), amount: p, type: 'expense', name: 'planned purchase' }], horizonDays: Math.max(horizonDays, 120), now }) };
  return [today, nextMonth, save3].map((s) => ({ name: s.name, endBalance: s.result.endBalance, breaches: s.result.breaches, breachCount: s.result.breaches.length }));
}
