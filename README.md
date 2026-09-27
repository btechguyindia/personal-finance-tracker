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
16. **Data Portability** — versioned JSON backups with integrity manifest,
    per-account CSV, backup-history registry, server-side validation,
    restore preview (added/replaced/removed/conflicts/balance effect) and
    merge/replace restore with password + phrase safeguards.
17. **Assets & Debt** — net-worth dashboard, asset register with valuation
    history, liabilities with amortization + payoff-scenario planner and
    explicit loan-payment recording (one transfer, no double count).

Global **+ Add** floating button (desktop), light/dark/bank themes, responsive
desktop → tablet → mobile-first shell (bottom nav ≤900px).

## Mobile fintech UI (`src/mobile/`)

Mobile-first redesign on the same data and APIs — no functionality removed:

- **Bottom nav (5):** Home, Activity, Cards, Insights, Profile. Sidebar and
  desktop topbar take over above 900px; same React tree, CSS-switched.
- **Home:** greeting header (notification dot = real unread count), navy hero
  balance (privacy toggle, month-over-month trend from real ledger),
  Send/Receive/Transfer/Add dock (opens the real transaction form with
  type presets), income/expense duo with prior-month deltas, Week/Month cash
  flow, recent activity, top budget-utilization insight with stated basis.
- **Activity:** inbox-style list with search + type chips, date grouping with
  daily nets, detail bottom sheet (edits happen in the ledger page).
- **Cards:** real accounts as wallet cards (live balances only — no invented
  numbers, no fake freeze controls), per-account recent activity.
- **Insights:** category donut, income-vs-expense bars, movers, goal,
  recurring and savings-rate cards — every claim cites its basis/period.
- **Profile:** grouped settings rows linking to existing pages + every
  feature page, confirmed sign-out.
- Identity: midnight navy `#102A43`, electric blue `#398BEE`, emerald
  `#07865F` on cool paper `#F6F9FB`; tabular numerals; 44px+ targets;
  safe-area insets; `prefers-reduced-motion` respected; desktop capped at
  1440px with sidebar navigation intact.

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

## Data portability (FinTrack 3.0 · Phase 3)

- **Data Portability Center** (sidebar → 💾, also linked from Settings):
  backup/export card, format & compatibility notes, backup-history registry,
  upload → validate → preview → restore flow with progress/success/failure
  states and rollback guidance. Nothing destructive is one click.
- **Versioned backup** (`GET /api/portability/backup` → `fintrack-backup`
  v1, `?download=1` for an attachment with a safe filename): transactions,
  budgets, raw accounts (opening balances preserved), categories, UPI IDs,
  goals + contributions, recurring, imports, autopilot rules, autopilot runs,
  notifications, preferences — an explicit allowlist. Format carries a
  manifest (record counts, SHA-256 integrity hash, INR/paise conventions,
  app version, feature list). Money crosses the boundary in rupees (≤2
  decimals); anything finer warns and rounds to paise on restore.
- **Never exported:** users, sessions/token verifiers, password-reset
  records, security events, audit log, passwords. Backups carry only a
  minimal `{ id }` owner reference used for ownership validation; every
  collection is filtered to the caller — cross-user leakage is tested.
- **Integrity note:** backups downloaded before the manifest-input fix
  report `integrity check failed` on validate (their hash covered
  non-serialized fields) but still validate and restore normally — only
  newly downloaded backups carry a verifiable hash.
- **Validate** (`POST /api/portability/validate`, read-only): format/version,
  required fields, duplicate ids, ownership consistency, date/money/paise
  checks, referential warnings (dangling goal/account links), unknown-field
  warnings, manifest integrity check, compatibility notes. Never writes.
- **Preview** (`POST /api/portability/preview`, read-only): live vs incoming
  counts, per-collection added/replaced/removed, id conflicts, budget
  changes, and the balance effect in integer paise — per mode.
- **Restore** (`POST /api/portability/restore`): always validates first;
  `dryRun: true` previews counts + errors with zero writes. `merge` adds
  new records, skips id collisions (reported, never silently overwritten),
  keeps incoming ids when free so re-merges are no-ops. `replace` needs the
  current **password** (re-authentication, mirroring account deletion) plus
  `REPLACE ALL MY DATA`, aborts on any invalid record, wipes only the
  caller's financial collections, and **preserves login, sessions, security
  history and account identity**. The UI auto-downloads a pre-restore backup
  first — that file is the rollback (re-restore it to undo). Post-restore
  the server re-verifies counts; balances always rebuild from the ledger,
  never from cached totals. Legacy `/api/export` payloads restore too.
- **Per-account CSV** (`GET /api/portability/export.csv?account=NAME`)
  matches ledger rows from any side (account/from/to).
- **History** (`GET /api/portability/history`): a **metadata-only registry**
  (audit trail: what + when, never file contents). There is no server-side
  backup storage — downloaded files ARE your backups. No paid storage is
  used or required.
- **Limits & honesty:** request bodies cap at 8 MB; backups over 8 MB /
  10,000 transactions are rejected (HTTP 413/400); Vercel caps serverless
  bodies at ~4.5 MB, so large restores must run against a local server.
  Replace-mode restore is wipe-then-insert on the single-document store —
  **not atomic** (documented risk; concurrency control is Phase 3.5 next).
  Validate/preview/restore are rate-limited (best-effort in-memory, per
  serverless instance, like login limits).

## Database reliability — concurrency & recovery (FinTrack 3.0 · Phase 3.5)

- **Design choice: optimistic concurrency first (Option A).** The store is one
  JSON document (`fintrack_store.key='main'`); it now carries a monotonic
  `version` column (additive `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, old
  rows default to v1, old code ignores the column → rollback-safe). Every
  Neon write is compare-and-swap (`UPDATE … WHERE key AND version`,
  bump atomically); a mismatch is rejected, never silently overwritten.
- **No blind last-write-wins:** all mutating routes run through a central
  guard (installed once, zero per-route edits, future routes covered): a
  per-instance write mutex serializes requests, each request reloads a fresh
  snapshot, sessions are re-verified post-reload (a concurrent revoke wins),
  and every handler is wrapped so async throws become JSON errors, not hangs.
- **Conflict contract:** a lost race returns **HTTP 409
  `{code: VERSION_CONFLICT}`** — nothing was written. The client surfaces
  `err.code`/`err.status`; callers must refresh and ask the user to retry
  deliberately. Money-moving requests are never auto-retried.
- **Idempotency:** `POST /api/transactions` accepts `idempotencyKey` (per
  user) — a retried POST returns the original (`idempotentReplay: true`)
  instead of duplicating. Import confirm already dedups on its key; a
  same-key race resolves to one import + one deduped answer via the 409 path.
- **Diagnostics:** `GET /api/storage/status` (auth) reports store kind,
  document version, timestamp and per-user counts — used to verify migrations
  and writer/reader agreement after deploys.
- **Migration safety:** additive schema only; pre-migration backup via the
  Portability Center; dry run via validate/preview; counts via storage
  status; rollback = redeploy previous build (old code reads new rows fine).
- **Honest limits:** rate limits and the write mutex are per serverless
  instance (documented, not distributed); replace-mode restore stays
  wipe-then-insert (not atomic); no point-in-time recovery is claimed —
  enable Neon point-in-time restore / branching manually if needed. The
  credible next step is **normalized per-collection tables** (schema sketched
  in `db/schema.sql`); the version column migrates with it as a
  fencing token during cutover.
- **Tests:** `tests/reliability.test.mjs` — CAS semantics vs a faithful
  in-memory PG double (overlap → exactly one winner + `VERSION_CONFLICT`;
  retry-after-refresh merges cleanly), plus live concurrency/idempotency/
  race tests on an isolated server. Disclosed gap: no live-Neon concurrency
  test (no isolated Neon test DB configured).

## Assets & Debt (FinTrack 3.0 · Phase 4)

- **Workspace** (sidebar → ⚖️): net-worth summary (assets, liabilities, net
  worth, debt-to-asset, completeness + estimate flags), asset allocation and
  debt mix, asset register, liability schedule/scenario/payment flows.
- **Assets** (`/api/assets`): cash, bank, fixed deposit, investment, gold,
  property, vehicle, other. Manual estimates are labelled estimates (never
  market prices); valuations are append-only history (latest date wins —
  backfills stay historical); linked accounts use the LIVE ledger balance as
  the single source of truth (entered value ignored, never added twice, and
  a broken link falls back with a flag).
- **Liabilities** (`/api/liabilities`): personal/education/home/vehicle
  loans, credit-card*, other debt. Principal, outstanding, rate (0–100),
  EMI, monthly frequency only (documented limit), next-due and maturity
  dates validated. `*` Credit-card liabilities are EXCLUDED from totals —
  card debt is tracked via card accounts (bill payments stay transfers).
- **Engine** (`src/services/loans.js`, paise-exact): reducing-balance
  monthly rests reusing the Calculators formula; extra-monthly and one-time
  prepayments; payoff date, interest saved, unpayable-EMI detection (never
  an infinite loop); every scenario ships visible assumptions. Simulations
  never touch the ledger — recording a payment is an explicit POST that
  writes exactly one transfer + reduces outstanding (principal slice only).
- **Net worth = assets − liabilities**, with stale-valuation (>90d) and
  estimate-share flags; status reads complete / partial, never implied full.
- **Portability:** assets + liabilities are exported, validated, previewed
  and merged/replaced like every other collection (old backups restore
  cleanly — new collections default to empty).
- **Tests:** `tests/assets.test.mjs` — engine cross-checked against the
  existing EMI calculator, zero-interest/rounding/early-payoff/unpayable
  edges, net-worth double-count guards, plus live CRUD/isolation/payment/
  portability tests on isolated users.

## Data-accuracy rules
- Transfers (incl. credit-card repayments) are **excluded** from
  income/expense and never change net worth.
- Refunds reduce the matching category as negative expenses, never income.
- `pending` / `scheduled` are excluded from balances and reports by default.
- Credit-card purchases grow the outstanding liability; paying the bill is a
  transfer, not a second expense.
- Zero denominators render as `n/a`; partial periods are labelled
  in-progress; `Asia/Kolkata` day boundaries; paise-exact arithmetic.
