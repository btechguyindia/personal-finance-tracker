# FinTrack — Personal Finance Wallet & Smart Expense Tracker

Login-protected, single-user-first finance workspace with a persistent
per-user database. No dummy or demo data — every account starts empty and
**every displayed rupee is explainable by a transaction, opening balance,
or verified adjustment**.

Default login (created automatically on first server start):

- Email: `prathmesh.nakate@ssg.com`
- Password: `Prathmesh@123`

> Stack note: the project brief allows a compatible alternative for existing
> projects, so this app stays on its working stack (Vite + React + Recharts
> frontend, Express + file DB backend, zero native dependencies) instead of a
> disruptive Next.js/Postgres migration. All accounting rules, APIs and tests
> below are implemented against that stack.

## Quick start

```bash
npm install
npm test      # 27 accuracy + reconciliation tests — must pass

# Terminal 1 — backend API + database (http://localhost:3000)
npm start

# Terminal 2 — frontend dev server (http://localhost:5173, proxies /api → :3000)
npm run dev

# Production bundle (served by server.js via `npm start`)
npm run build
```

Live API tests (import idempotency, auth isolation) run too when pointed at a
running server:

```bash
$env:FINTRACK_TEST_URL = "http://localhost:3000"; npm test
```

## Pages (sidebar)

1. **Overview** — net worth, income/expenses/savings this month, savings rate
   (`n/a` on zero income), available balance, credit-card debt, budget
   remaining, category pie, account balances, recent transactions.
2. **Transactions** — full ledger, search + type/account/status filters,
   modal add/edit with transfers (from → to), refunds, adjustments, UPI refs,
   tags, pending/scheduled states, CSV export + CSV import with preview,
   duplicate detection and idempotency keys.
3. **Accounts & Wallets** — cash, savings, current, UPI, credit card, wallet,
   investment, other. Balances derive from `opening + received − paid`
   (completed only); cards show outstanding liability; renames follow history.
4. **Budgets** — per-category monthly limits with live utilization.
5. **Categories** — built-in expense/income hierarchy + custom categories
   (name, kind, color), with real per-category spending.
6. **UPI** — saved UPI IDs (organizers only — no bank connection, no PIN/OTP
   ever asked), UPI received/paid/net, UPI transaction list.
7. **Savings Goals** — targets, manual contributions (never counted as
   income), progress bars.
8. **Reports & Analytics** — the validated analytics suite: presets incl.
   FY Apr–Mar, comparisons, behaviour insights, drilldown, CSV export.
9. **Recurring** — expected income/expense schedules (daily → yearly,
   active/paused). Never auto-posts money.
10. **Settings** — theme (light/dark), currency, timezone, FY start,
    password change, JSON backup export, wipe-all-data danger zone.

Global **+ Add** floating button, light/dark mode, responsive desktop →
tablet → mobile with collapsible sidebar.

## Architecture

- `server.js` — Express API + persistent file DB (`data/fintrack.db.json`):
  users, sessions, transactions, budgets, accounts, categories, upiIds,
  goals, contributions, recurring, preferences, imports, audit.
- Money is stored as **integer paise**; the API accepts/returns rupees at
  the boundary (rounded). Rate-limited login, scrypt hashing, 7-day bearer
  tokens, per-user ownership checks on every query, audit log on mutations.
- `src/services/finance.js` — centralized calculation engine (paise-safe):
  balances, month totals, net worth, savings rate, overview.
- `src/services/analyticsService.js` — single source of truth for charts.
- `src/services/api.js` — frontend API client.
- `tests/analytics.test.mjs` — 12 reconciliation tests.
- `tests/ledger.test.mjs` — 13 ledger-accuracy tests + live API tests.

## Data-accuracy rules

- Transfers (incl. credit-card repayments) are **excluded** from
  income/expense and never change net worth.
- Refunds reduce the matching category as negative expenses, never income.
- `pending` / `scheduled` are excluded from balances and reports by default.
- Credit-card purchases grow the outstanding liability; paying the bill is a
  transfer, not a second expense.
- Zero denominators render as `n/a`; partial periods are labelled
  in-progress; `Asia/Kolkata` day boundaries; paise-exact arithmetic.
