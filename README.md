# FinTrack — Personal Finance Wallet & Smart Expense Tracker

Login-protected, single-user-first finance workspace with a persistent
per-user database. No dummy or demo data — every account starts empty and
**every displayed rupee is explainable by a transaction, opening balance,
or verified adjustment**.

Default login (created automatically on first server start):

- Email: `prathmesh.nakate@ssg.com`
- Password: `Prathmesh@123`

New users can sign up from the login page. Forgot password? Use the
"Forgot password?" link — a 6-digit code is issued in-app (no email service
is configured), valid 15 minutes, single-use, locked after 5 wrong tries.
Resetting logs out all sessions.

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
11. **Calculators** — EMI (with amortisation schedule), SIP, FD/compound,
    simple interest, discount + GST — pure frontend maths, no data saved.
12. **Fin assistant** — floating 🤖 buddy answering spending, budget,
    savings-rate, balance and goal questions from your own ledger.
13. **Profile & avatar** — display name + emoji avatar with colour, shown in
    the sidebar (Settings → Profile).
14. **Autopilot** — rule engine (transaction added, salary detected, budget
    threshold, recurring approaching, unusual spend, month closed) with
    conditions, notify/suggest/draft actions, approval gate, inbox and
    idempotent run log. Rules never move money; drafts are `scheduled`.

## Autopilot (FinTrack 3.0 · Phase 1)

Rules live in `autopilotRules`; firings in `autopilotRuns`; user-facing
output in `notifications` (all backward-compatible additions — old
databases self-heal on load). Transaction triggers evaluate automatically
on create/import; budget/recurring/month checks run on demand
(`POST /api/autopilot/evaluate` or the Autopilot page buttons).
Approval-gated drafts are applied via `POST /api/autopilot/approve/:id`
and land as `scheduled` transactions with `source: 'autopilot'`.
12. **Tips & Suggestions** — rotating tip of the day, ledger-driven
    personalized tips, smart suggestions with rupee figures, savings challenges.
13. **Trends & Health** — 6-month income/expense trend, category movers vs
    last month, weekday spending pattern, explainable 0–100 health score.
14. **Learn & Tools** — curated India-first money reads (Varsity, RBI, NSE,
    AMFI, Freefincal…), 50/30/20 spend-wisely check, emergency-fund, SIP and
    new-regime tax estimators.
15. **Security & Privacy** — sessions with coarse device labels, revoke one /
    revoke-others, sign-in & security activity, password controls with
    other-device sign-out, and a two-step account deletion workflow.

Global **+ Add** floating button, light/dark mode, responsive desktop →
tablet → mobile with collapsible sidebar.

## Architecture

- `server.js` — Express API + persistent file DB (`data/fintrack.db.json`):
  users, sessions, transactions, budgets, accounts, categories, upiIds,
  goals, contributions, recurring, preferences, imports, resets,
  autopilotRules, autopilotRuns, notifications, securityEvents, audit.
- Money is stored as **integer paise**; the API accepts/returns rupees at
  the boundary (rounded). Rate-limited login, scrypt hashing, 7-day bearer
  tokens, per-user ownership checks on every query, audit log on mutations.
- `src/services/finance.js` — centralized calculation engine (paise-safe):
  balances, month totals, net worth, savings rate, overview.
- `src/services/analyticsService.js` — single source of truth for charts.
- `src/services/api.js` — frontend API client.
- `tests/analytics.test.mjs` — 12 reconciliation tests.
- `tests/ledger.test.mjs` — 13 ledger-accuracy tests + live API tests.

## Security & privacy (FinTrack 3.0 · Phase 2)

- **Sessions:** each login creates a unique session (7-day expiry). The DB
  stores only SHA-256 verifiers — never raw tokens. Listings expose a public
  id, device label, and timestamps; revocation takes effect on the next
  request. Legacy `{token}` rows migrate losslessly on load (hashed in
  place, raw copy dropped).
- **Activity:** sign-ins, failed attempts (known accounts only, never with
  passwords), sign-outs, password changes/resets, revocations and failed
  deletions are stored as UTC timestamps, shown in local time, capped at
  300 per account.
- **Password change** needs the current password, keeps the current session,
  and signs out all other devices.
- **Deletion** (`DELETE MY ACCOUNT` + password) removes the user and every
  owned row in all collections; sessions die with it. No tombstone remains
  by design; there are no external files in this phase. Repeat calls safely
  return 401.
- **Limits:** last-activity persists at most hourly (not per request);
  rate limits are best-effort in-memory per serverless instance;
  concurrent writes to the single JSON document remain last-write-wins.

## Data-accuracy rules
- Transfers (incl. credit-card repayments) are **excluded** from
  income/expense and never change net worth.
- Refunds reduce the matching category as negative expenses, never income.
- `pending` / `scheduled` are excluded from balances and reports by default.
- Credit-card purchases grow the outstanding liability; paying the bill is a
  transfer, not a second expense.
- Zero denominators render as `n/a`; partial periods are labelled
  in-progress; `Asia/Kolkata` day boundaries; paise-exact arithmetic.
