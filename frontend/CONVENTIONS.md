# Frontend conventions (ProsParity)

Stack: React 18 + Vite + TS, Tailwind 3 (tokens in `src/styles/index.css`, theme in `tailwind.config.ts`),
shadcn-style primitives on Radix, Framer Motion, TanStack Query/Table/Virtual, React Hook Form + Zod, Recharts,
date-fns, Lucide, cmdk, Sonner.

## Files you can use (do not edit shared files — add new ones next to your page if you need a helper)
- `@/lib/api` — `client` (typed openapi-fetch, paths start with `/api/...`), `unwrap(promise)` → data or throws
  `ApiError` (friendly `.message`), `download(path, params)` → `{blob, filename}`, `upload(path, file, params)`,
  `errorMessage(e)`.
- `@/lib/types` — aliases for generated schemas (`Employee`, `Cycle`, `LeaveRequest`, `PayDaysRow`, ...).
  Generated types: `src/api/schema.d.ts` (from backend OpenAPI). Endpoints that return plain dicts are typed `{}`
  — declare a local interface and cast (`as unknown as MyType`).
- `@/lib/utils` — `cn`, `num` (decimal string → number), `fmtDays`, `fmtMoney` (currency from settings),
  `fmtDate(d, pattern)`, `isoDate(date)`, `downloadBlob(blob, name)`, `pluralize`.
- `@/lib/status` — `STATUS[code]` → `{label, icon, soft, solid, text, color, key}`; `SETTABLE`; `statusMeta(code)`.
- `@/lib/auth` — `useAuth()` → `{user, role, can(...roles)}`; roles `hr_admin | manager | employee | accounts`.
- `@/lib/cycle` — `useCycle()` → `{cycle, cycles, current, setCycleId}` (global top-bar cycle switcher).
- `@/hooks/queries` — `useCycles`, `useDepartments`, `useDesignations`, `useSettings`, `useSettingValue(key)`, `qk`.
- UI: `@/components/ui/button` (`Button` variants default|accent|destructive|outline|secondary|ghost|soft|link,
  `loading` prop), `input` (`Input`, `Textarea`), `label` (`Label`, `Field` — label + error + hint), `card`,
  `badge`, `dialog` (`DialogContent side="right"` = sheet), `popover`, `dropdown-menu`, `select`,
  `alert-dialog` (`ConfirmDialog`), `misc` (`Tabs*`, `Tooltip`, `Switch`, `Checkbox`, `PersonAvatar`,
  `Separator`, `Progress`, `Skeleton`, `Kbd`).
- Shared: `@/components/shared/page` (`PageHeader`, `ErrorState`, `InlineAlert`, `StatTile`),
  `empty-state` (`EmptyState art="calendar|inbox|search|upload|chart|people|check|error"`),
  `status-badge` (`StatusBadge`, `StatusLegend`), `motion` (`CountUp`, `FadeIn`, `stagger`, `spring`),
  `rings` (`Ring`, `CycleRing`), `heatmap` (`AttendanceHeatmap`, `HeatmapLegend`),
  `data-table` (`DataTable` with sticky header/first column, sorting, `virtual`, `Pager`).

## Patterns
- Data: `useQuery({ queryKey: [...], queryFn: () => unwrap(client.GET("/api/...", { params: { query } })) })`.
  Mutations: `useMutation({ mutationFn, onSuccess: () => { toast.success(...); qc.invalidateQueries(...) } })`.
  Errors from mutations are toasted globally (set `meta: { silent: true }` to handle yourself).
- All days/money from the API are **decimal strings** — never do float math for display beyond `num()`;
  format with `fmtDays` / `fmtMoney`; always add `tnum` class to numbers.
- Every page starts with `<PageHeader title=... description=... actions=... />`.
- Loading → `Skeleton`; empty → `EmptyState`; error → `ErrorState onRetry`.
- Forms: React Hook Form + Zod, `Field` for label/error, `aria-invalid`, inline errors next to fields.
- Status codes: always `StatusBadge` (icon + text), never color alone.
- Colors: tokens only (`bg-primary`, `text-muted-foreground`, `bg-status-a/12`, ...). No raw hex in components.
- Layout: mobile-first, works on tablet (768px) and phone (375px); no horizontal page scroll (tables scroll
  inside their card). Touch targets ≥ 36px. Icon-only buttons need `aria-label`.
- Motion: subtle, 150–400ms, `FadeIn`/`stagger`; honour reduced motion (framer handles `useReducedMotion`).
- Cards: `rounded-xl border bg-card shadow-e1`; glass surfaces: `glass` utility.
- Role-gate actions in the UI with `can(...)` (backend enforces too).
- Pages are default exports in `src/pages/<name>.tsx`; sub-components may live in `src/features/<area>/`.
- Typecheck: `npx tsc -b --noEmit` from `frontend/`. Fix only errors in files you own.

## Backend
FastAPI routers live in `backend/app/api/*.py`; services in `backend/app/services/*.py` (read them for exact
response shapes of dict endpoints). Business rules: see the repository README / DECISIONS.md.
