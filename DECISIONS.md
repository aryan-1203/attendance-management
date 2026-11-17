# DECISIONS.md — assumptions & defaults

## HR-only version (current)

* Only HR signs in. HR marks attendance, records leave (applied immediately, with the paid/LOP preview), adjusts
  balances, imports Excel and closes cycles. Employees, managers and Accounts have no login in this version.
* Kept but commented out (search the code for "HR-only version"): the "Me" self-service section and `/me…`
  routes, the approvals and corrections inboxes on the Leave page, the "Pending approvals" dashboard card, the
  "Approve immediately" toggle (leave recorded by HR is always applied), non-HR demo logins in the seed, and the
  non-HR roles in **Settings → Users & roles**. The backend keeps full role support (manager / employee / accounts,
  approvals, regularizations), so these can be re-enabled without backend changes.
* **No salary amounts.** Salaries are handled by the Accounts team, so ProsParity stores no monthly gross and
  computes no per-day rate, LOP amount, net payable or encashment amount. It produces the **day counts** Accounts
  needs (eligible, payable, LOP, paid leave, comp-off, balances, encashable days). The `monthly_gross` column was
  dropped (migration `0002`), as were the currency / per-day-basis / encashment-rate settings.
* Product and company name: **ProsParity**. HR admin: **Shraddha Rajeshirke** (`shraddha@prosparity.in`).

## Real data: the legacy "Payable Days Calculation" sheets

The dev database holds the real Sept and Oct 2026 sheets, loaded with `python -m app.importers.load_legacy`
(see README). **Only data is taken from the sheets; every figure is calculated with ProsParity's own rules
(below), not the sheets' formulas** (the sheets use 2/1 days a month, a 30-day month, etc.; those are ignored).

* Taken from the sheets: employee names, DOJ, exits (last marked day for people who leave or vanish from the next
  sheet — e.g. Kunal Sahu and Praveen Kumar, exited 19 Sep), every P / A / HD / WFH mark, and the September
  sheet's **"Leaves in Hand"** as each
  employee's opening balance on go-live (20 Aug 2026) — including the negative ones, which under ProsParity's rules
  mean any leave is LOP until accruals bring the balance back above zero.
* The sheets' last (remarks) column is ignored, including the "30" remarks.
* **No paid public holidays this year.** The festival columns (Raksha Bandhan 28 Aug, Ganesh Chaturthi 14 Sep,
  Gandhi Jayanti 2 Oct) are stored as **optional** holidays: they are normal working days for the engine; nobody has
  a mark on them, so they count as unmarked (treated as present). How employees avail optional holidays is still to
  be decided — today HR can mark `H` for a person who takes one (paid, not deducted). Sunday is the weekly off.
* Staff with no DOJ in the sheets are permanent (probation completed); their DOJ field holds the placeholder
  01 Jan 2025 until the real date is entered.
* Probation follows the app setting: DOJ + 6 months. If that date has passed the employee is confirmed on it
  (locked probation leave is released then); otherwise they are still on probation and HR confirms them.
* Sept and Oct are calculated by the engine and then **locked** like any closed month. Their LOP / payable days
  therefore differ from what the sheets paid (e.g. LOP 42 vs 10 days in Sept) — unlock a cycle if it needs review.
* The Sept sheet starts on 21 Aug; ProsParity's cycle starts on the 20th, so 20 Aug is unmarked (treated as present).
* Employee codes `PP001…` were generated (none in the sheets). A future joiner in the Sept sheet who never
  appears in Oct (Supriya Yadav) was not created. Someone who leaves before probation ends is never confirmed.
* A locked cycle's per-employee panel shows the figures frozen at lock time (same as its reports).

Every rule below is a **default**; the ones marked ⚙︎ are editable in **Settings** (stored in `policy_settings`).
Changing a ⚙︎ calculation setting automatically recalculates every **open** cycle (locked cycles keep their
snapshot).

## 0. Inputs that were not available

| Item | Decision |
|---|---|
| `docs/sample_attendance.xlsx` | **Not present** when the project was built. The importer therefore supports both layouts the brief describes and auto-detects them: **wide** (`Emp Code`, optional `Name`, then one column per date) and **long** (`Emp Code`, `Date`, `Status`, optional `Note`). Header row is auto-detected (title rows above the header are skipped), date headers may be real Excel dates, `20-Oct-2026`, `2026-10-20`, `20/10/2026`, `20 Oct`, or bare day numbers (`20`, `21`, … mapped into a chosen cycle). The downloadable template (`Excel import → Download template`) is the canonical format. When a sample file is supplied, save its mapping as a **template** in the wizard (no code change needed); status aliases can be added per import. |
| Docker | Docker is not installed on the build machine, so `docker compose up` could not be run here. The Compose stack was written to standard images (mysql:8.0, python:3.12-slim, node:20, nginx). The same migrations, seed and the full backend test suite **were run against a real MySQL 8.4 server** and pass, in addition to SQLite. |

## 1. Calendar & cycle

| Topic | Decision |
|---|---|
| Cycle ⚙︎ | 20th → 19th of next month (`cycle_start_day`, 1–28; 29–31 would not exist in February). |
| Cycle creation | Cycles are created on demand (the nightly job, the cycle switcher, or any write that touches a date). **Go-live boundary:** the earliest existing cycle is the system's go-live; history before it is never created implicitly. Balances from a previous system are entered as **opening-balance ADJUSTMENT** ledger rows. |
| Changing the start day | New cycles never overlap existing ones; the next cycle is clipped to start the day after the last one. |
| Report due ⚙︎ | cycle end + 2 days (`report_due_days`). |
| Business date | `Asia/Kolkata` ⚙︎ (`BUSINESS_TIMEZONE`). All attendance/ledger dates are `DATE` columns; audit timestamps are UTC `DATETIME`. |
| Weekly off | Per-employee weekday list (default Sunday = `6`). |
| Holidays | Only **public** holidays are non-working days. **Optional/restricted** holidays are listed in the calendar but are working days (an employee takes them as leave). |

## 2. Leave engine (pure module `backend/app/engine/`)

| Topic | Decision |
|---|---|
| Accrual ⚙︎ | 1.5 / cycle, credited on the **first eligible day** of the cycle (`accrual_timing`: `start` · `end` (credited on the last eligible day, so not usable within that cycle) · `daily` (pro-rata per day on a 0.01-day grid, rounded down so availability is never overstated)). |
| Pro-rata ⚙︎ | Applied to **both joiners and leavers**: `1.5 × eligible ÷ cycle days`, rounded to the nearest 0.5 (half-up) by default (`prorata_rounding`: nearest_half / floor_half / ceil_half / none). Worked example: 19/31 → 0.92 → **1.0**; 22/31 → 1.06 → **1.0**. |
| Probation split ⚙︎ | Full cycle: 0.5 usable + 1.0 locked. Partial cycle: usable part = round(total × 0.5/1.5), locked = remainder (e.g. joiner 1.0 → 0.5 usable + 0.5 locked). |
| Who is on probation | If `confirmation_date` is set: on probation strictly **before** that date. Otherwise: `employment_type == "probation"`. Contract staff and interns accrue like permanent staff (fully usable). |
| Probation release | On the confirmation date the **entire** locked bucket (including the current cycle's locked part, if accrued before confirmation) moves to usable: two `PROBATION_RELEASE` rows (−locked, +usable). If the confirmation date is earlier than the cycle (set retroactively), the release is posted on the first day of the first open cycle. |
| `probation_usable_cumulative` ⚙︎ | TRUE (default): unused usable 0.5s accumulate. FALSE: usage is **capped** at 0.5 per cycle while on probation; the unused usable balance is retained (not forfeited) and is fully usable after confirmation. |
| Deduction order | A / HD / L: usable → (comp-off only if `comp_off_auto_apply` ⚙︎, default off) → LOP. `CO`: comp-off → usable → LOP. **Locked balance is never used.** Leaves are consumed chronologically within the cycle. |
| `L` with no balance | Approved leave without balance becomes LOP (the leave application preview warns first: “2 days paid, 1 day LOP”). |
| Absence on a weekly-off/holiday | `A`, `L` or `CO` marked on a Sunday/holiday is **not deducted** (it's a paid off day) and raises a warning — unless the sandwich rule applies. |
| Working on a weekly-off/holiday | `P`/`OD` earns 1.0 comp-off, `HD` earns 0.5 (if comp-off ⚙︎ enabled). `WFH` on a Sunday does **not** earn comp-off. Comp-off expires after 60 days ⚙︎; usable up to and including the expiry date; the `COMP_OFF_EXPIRED` row is dated the next day. Comp-off lots are consumed earliest-expiry first. |
| Range marking safety | In the grid, applying a status to a **range** skips auto Sundays/holidays, so selecting a whole row never grants accidental comp-offs. A single Sunday cell can still be marked deliberately. |
| Sandwich rule ⚙︎ (off) | A run of weekly-offs/holidays is counted as leave when the nearest working days on **both** sides are full-day `A`/`L`/`CO` (neighbours outside the cycle are looked up, ±14 days). |
| Late-mark rule ⚙︎ (off) | Every N-th late mark (`is_late` on a present day) in a cycle deducts 0.5 (default N = 3), via the normal deduction order. |
| Negative balance ⚙︎ (off) | When on, usable may go down to −`negative_balance_limit` before LOP applies. |
| Unmarked working days ⚙︎ | Treated as **present** by default (`unmarked_policy`), counted and flagged in the cycle-close checks. Future days of the current cycle are always "pending" (never deducted), so projections assume presence. |
| `NJ` / `EX` | Never stored; derived from DOJ/exit date. Days outside employment are not counted as eligible. |
| Encashment | At exit, the usable balance (in days) is encashed and posted as an `ENCASHMENT` ledger row once per employee; Accounts converts the days into money. Locked (probation) balance is shown but not encashed by default. |
| Year-end ⚙︎ | Leave year Jan–Dec (`leave_year_start_month`). Carry forward with **no cap** by default; with a cap, the excess is posted as a negative `CARRY_FORWARD` row (lapse). A zero-amount `CARRY_FORWARD` marker row is posted for audit when nothing lapses. The scheduled job only prepares a **preview** and notifies HR; HR posts it (idempotent per year via reference `CF-<year>`). |

## 3. Pay days

| Topic | Decision |
|---|---|
| Formulae | Eligible = cycle days ∩ employment. **Payable = Eligible − LOP.** Sundays and holidays inside the eligible window are paid days. Salary amounts are out of scope (Accounts). |
| Precision | Days are `DECIMAL(5,2)`; no floats anywhere in the backend; the API emits decimals as fixed 2-dp **strings**. |
| Accounts role | May only open/download reports for **locked** cycles. |

## 4. Ledger & recalculation

* `leave_ledger` rows are **never updated or deleted**. A correction posts a reversal row (`reversal_of_id`) with the negated amount; balances are `SUM(amount)` per bucket.
* Recalculation of (employee, cycle) = replay the ledger to get the opening balance (excluding this cycle's system rows) → run the engine → diff the engine's postings against the cycle's active system rows → reverse what disappeared and post what's new. Running it twice writes nothing (tested).
* Any change to attendance, holidays, DOJ/exit/confirmation, employment type, weekly-off, manual adjustments or calculation settings recalculates the affected open cycles **forward** (later cycles depend on earlier closings). Locked cycles are skipped and reject edits with HTTP 423.
* Manual adjustments dated inside a cycle count as available from that cycle's start.
* Bucket `lop` is informational (LOP days per day), not a balance.
* Locking a cycle stores a per-employee **snapshot** of the pay-days row; reports for locked cycles read the snapshot, so later policy changes never alter a closed payroll. Cycles must be locked in order; unlock requires a reason (audited) and is only allowed for the latest locked cycle.

## 5. Excel

* Every generated workbook goes through `backend/app/utils/excel_styles.py`: **Abadi 9** on every cell (bold for titles/headers/totals), light header fill, freeze panes below the header (plus code/name columns where useful), auto-filter, fitted widths, `0.0` days, title block (company, report, cycle, generated on/by), totals row with real `=SUM()` formulas (muster roll also uses per-row `=COUNTIF()`). `to_bytes()` runs a final safety pass that enforces the font. A test opens every generated file and asserts Abadi 9 on every non-empty cell.
* Abadi must be installed on the viewing machine; Excel falls back to a similar sans otherwise (the font name is still stored).
* PDFs (reportlab) embed a Unicode sans (DejaVu Sans in Docker, Geneva on macOS). The ProsParity logo (`backend/app/assets/logo.png`) heads every PDF.

## 6. Security & auth

* JWT access token 60 min ⚙︎ (env) + refresh token 7 days; the frontend refreshes once on 401. Changing/resetting a password or deactivating a user bumps `token_version`, revoking all existing tokens.
* Client-side idle timeout equal to the access-token lifetime signs the user out.
* Password policy: ≥ 8 chars with upper, lower, digit and symbol. 5 failed logins lock the account for 15 minutes.
* Forgot password never reveals whether an email exists. In development the reset link is written to `backend/storage/outbox/*.eml`, logged, and returned to the UI as a convenience; never in production.
* Managers see and approve only their direct reports (`employees.manager_id`); HR sees everything; employees only themselves.

## 7. Email

* SMTP settings ⚙︎. When `smtp_host` is empty (default/dev), emails are written to `storage/outbox/*.eml` and logged instead of sent, and the UI says so.

## 8. Misc

* Soft delete for employees (`deleted_at`); their history and ledger remain.
* `comp_offs` is a projection rebuilt from the ledger after every recalculation (the ledger stays the source of truth).
* Scheduler (APScheduler, in-process): 00:30 nightly (ensure the current cycle, recalculate open cycles — posts accruals/expiries — probation alerts 15 days ahead), 01:00 year-end carry-forward preview. Jobs are idempotent and recorded in `job_runs`. Run a single backend replica (or disable `ENABLE_SCHEDULER` on extra replicas).
* Demo data is generated relative to **today**, so the seeded cycles are always the last four.
* API timestamps (`created_at`, `locked_at`, …) are naive ISO strings in **UTC**; the frontend parses them as UTC. Dates (`date`, `entry_date`, …) are business-calendar dates with no time zone.
* Managers never see their own requests in their approvals inbox or badge (`scope=approvals`); those go to HR.
* The leave-application preview runs the real engine across every cycle the request spans, so it includes the accrual of future cycles — "paid" can therefore exceed today's usable balance (the UI explains this).
* Leave attachments (PDF/image, ≤ 5 MB) are stored under `storage/uploads/attachments` and downloadable by the requester, their manager, HR and Accounts.
* HR cannot remove their own HR-admin role/active flag, and the last active HR admin cannot be demoted or deactivated.
* Route changes use a short fade (`AnimatePresence mode="wait"`); the employee avatar carries a shared `layoutId` from list to profile, which animates when both are mounted (it degrades to a plain fade after a cold lazy-load).
