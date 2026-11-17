# Test report

Run on 17 Nov 2026 (business date pinned to that day in backend tests).

| Suite | Command | Result |
|---|---|---|
| Leave & pay-day engine (pure, incl. all 7 worked examples in §2.7) | `cd backend && .venv/bin/pytest tests/test_engine.py` | **64 passed** |
| Backend total — engine + services + imports/Excel + API + legacy-sheet loader (SQLite) | `cd backend && .venv/bin/pytest` | **118 passed** |
| Backend total on **MySQL 8.4** (migrations + utf8mb4) | `TEST_DATABASE_URL=mysql+pymysql://…/prosparity_test .venv/bin/pytest` | **116 passed** (before the legacy-sheet change; not re-run) |
| Frontend typecheck | `cd frontend && npx tsc -b --noEmit` | clean |
| Frontend unit/component (Vitest + RTL) | `npm test` | **14 passed** |
| E2E (Playwright, Chromium, freshly seeded backend) | `npx playwright test` | **4 passed** |
| Production build + PWA service worker | `npm run build` | OK (no chunk > 600 kB) |

## What is covered

**Engine (64):** cycle bounds incl. configurable start day & year wrap; rounding modes; mandatory examples 1–7;
accrual timing (start/end/daily); probation split, cumulative on/off, release on/after confirmation, locked never used;
joiner/leaver pro-rata; half-day, approved leave → LOP; absence on Sunday ignored; leave spanning a weekend;
negative balance; unmarked policy & future "pending" days; WFH/OD; sandwich rule (on/off, holiday+Sunday runs);
late marks; comp-off earn/use/expiry/auto-apply; no floats;
determinism/idempotency; opening balances never mutated; ledger replay equals engine closing.

**Services (24):** examples 1, 3, 6, 7 end-to-end on the database (incl. locked cycle → HTTP 423, reversal rows,
idempotent recalculation); holiday added later removes a deduction; attendance validation; mark-all-present + undo;
grid auto codes; side-panel projection; leave preview/approve/cancel, overlaps, half-day; adjustments; comp-off
projection; carry-forward with cap (idempotent); regularization; cycle close checks/lock/snapshot/unlock and lock order;
policy validation; go-live boundary.

**Imports & Excel (12):** wide/long auto-detection, header row detection, day-number headers, status aliases,
duplicates/before-DOJ/invalid date/future/locked-cycle errors, overwrite & Sunday warnings, commit, rollback
(incl. locked), error-row export; **every generated workbook opened and asserted Abadi 9 on every non-empty cell**;
pay-days layout (title block, bold filled header, freeze panes, auto-filter, `0.0` format, `=SUM` totals, no salary columns); muster `COUNTIF`; PDFs render.

**API (17):** login/refresh/me, lockout after 5 failures, consistent error shape, forgot/reset password + policy,
password change revokes tokens, role restrictions (employee/manager/accounts), manager-scoped dashboard, full HTTP
flows (grid, bulk, reports, statement PDF, email to accounts, audit, dashboard), leave via API with notifications,
settings validation, employee CRUD, attachments, last-HR-admin guard.

**Frontend (14):** day formatters, status badge accessibility (icon + text, never colour alone), radial picker
(click, shortcuts, disabled rules), attendance grid (accessible names, keyboard set, Shift-range skipping Sundays and
respecting future-day rules, read-only mode), login validation + friendly server errors.

**E2E (4):** (1) HR marks attendance: mark all present → keyboard exception → side panel → undo; locked cycle is
read-only; (2) HR records leave for an employee with the live paid/LOP preview → it appears as approved in leave
records and as `L` on the grid;
(3) Excel import: upload → mapping → validation with an error row → import → history → roll back.

## Not verified here
* `docker compose up` itself (Docker is not installed on the build machine). The images are standard; the same
  migrations/seed/tests were run against a real MySQL 8.4 server.
* Real SMTP delivery (dev mode writes `.eml` files to `backend/storage/outbox/`).
