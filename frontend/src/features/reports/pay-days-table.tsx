import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeMinus, Search, X } from "lucide-react";
import type { PayDaysRow } from "@/lib/types";
import { cn, fmtDate, fmtDays, num } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/misc";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { sumDec, type PayDaysTotals } from "./types";

type Kind = "days" | "int";
interface Col { id: keyof PayDaysRow; header: string; kind?: Kind; size?: number }

const NUMERIC: Col[] = [
  { id: "cycle_days", header: "Cycle days", kind: "int" },
  { id: "eligible_days", header: "Eligible days", kind: "days" },
  { id: "weekly_offs", header: "Sundays / WO", kind: "days" },
  { id: "holidays", header: "Holidays", kind: "days" },
  { id: "present_days", header: "Present", kind: "days" },
  { id: "half_days", header: "Half-days", kind: "days" },
  { id: "paid_leave_used", header: "Paid leave used", kind: "days" },
  { id: "comp_off_used", header: "Comp-offs used", kind: "days" },
  { id: "lop_days", header: "LOP days", kind: "days" },
  { id: "payable_days", header: "Payable days", kind: "days" },
  { id: "opening_usable", header: "Opening balance", kind: "days" },
  { id: "accrued", header: "Accrued", kind: "days" },
  { id: "used", header: "Used", kind: "days" },
  { id: "closing_usable", header: "Closing usable", kind: "days" },
  { id: "closing_locked", header: "Locked", kind: "days" },
];
/** columns whose totals are not meaningful */
const NO_TOTAL = new Set<keyof PayDaysRow>(["cycle_days"]);

function fmt(kind: Kind | undefined, v: string | number) {
  if (kind === "int") return String(num(v));
  return fmtDays(v);
}

export function PayDaysTable({ rows, totals, loading }: { rows: PayDaysRow[]; totals?: PayDaysTotals; loading?: boolean }) {
  const [search, setSearch] = React.useState("");
  const [lopOnly, setLopOnly] = React.useState(false);
  const q = search.trim().toLowerCase();
  const filtered = React.useMemo(() => rows.filter((r) =>
    (!lopOnly || num(r.lop_days) > 0) &&
    (!q || r.code.toLowerCase().includes(q) || r.full_name.toLowerCase().includes(q) || r.department.toLowerCase().includes(q))),
  [rows, q, lopOnly]);
  const isFiltered = filtered.length !== rows.length;
  const lopCount = React.useMemo(() => rows.filter((r) => num(r.lop_days) > 0).length, [rows]);

  const columns = React.useMemo<ColumnDef<PayDaysRow, unknown>[]>(() => [
    {
      accessorKey: "code", header: "Emp code", size: 96,
      cell: ({ row: { original: r } }) => (
        <span className="flex items-center gap-1.5 font-mono text-xs font-semibold tnum">
          {num(r.lop_days) > 0 && <span className="size-1.5 shrink-0 rounded-full bg-status-lop" aria-hidden />}
          {r.code}
        </span>
      ),
    },
    {
      accessorKey: "full_name", header: "Name", size: 190,
      cell: ({ row: { original: r } }) => (
        <span className="flex min-w-[160px] items-center gap-1.5">
          <span className="truncate font-medium">{r.full_name}</span>
          {r.joined_in_cycle && <Badge variant="default" className="shrink-0">Joined</Badge>}
          {r.exited_in_cycle && <Badge variant="secondary" className="shrink-0">Exited</Badge>}
        </span>
      ),
    },
    { accessorKey: "department", header: "Department", cell: ({ getValue }) => <span className="whitespace-nowrap">{String(getValue() || "—")}</span> },
    {
      accessorKey: "date_of_joining", header: "DOJ",
      cell: ({ getValue }) => <span className="whitespace-nowrap tnum">{fmtDate(getValue() as string, "dd MMM yy")}</span>,
    },
    { accessorKey: "employment_type", header: "Type", cell: ({ getValue }) => <span className="whitespace-nowrap">{String(getValue())}</span> },
    ...NUMERIC.map<ColumnDef<PayDaysRow, unknown>>((c) => ({
      id: c.id, accessorFn: (r) => num(r[c.id] as string), header: c.header, meta: { align: "right" },
      cell: ({ row: { original: r } }) => {
        const v = r[c.id] as string;
        if (c.id === "lop_days" && num(v) > 0) {
          return <span className="inline-flex items-center gap-1 rounded-full bg-status-lop/15 px-2 py-0.5 text-xs font-semibold text-status-lop-fg ring-1 ring-inset ring-status-lop/25">
            <BadgeMinus className="size-3" aria-hidden />{fmtDays(v)}</span>;
        }
        if (c.id === "payable_days") return <span className="font-semibold">{fmtDays(v)}</span>;
        if (c.id === "closing_usable" && num(v) < 0) return <span className="font-medium text-destructive">{fmtDays(v)}</span>;
        return <span className={cn("whitespace-nowrap", num(v) === 0 && "text-muted-foreground/70")}>{fmt(c.kind, v)}</span>;
      },
    })),
    {
      accessorKey: "remarks", header: "Remarks", enableSorting: false, size: 220,
      cell: ({ getValue }) => {
        const v = String(getValue() ?? "");
        if (!v) return <span className="text-muted-foreground">—</span>;
        return <Tooltip content={v}><span tabIndex={0} className="block max-w-[260px] truncate text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">{v}</span></Tooltip>;
      },
    },
  ], []);

  const footTotals = React.useMemo(() => {
    const out: Partial<Record<keyof PayDaysRow, number>> = {};
    NUMERIC.forEach((c) => {
      if (NO_TOTAL.has(c.id)) return;
      const serverValue = !isFiltered && totals ? (totals as unknown as Record<string, string | undefined>)[c.id] : undefined;
      out[c.id] = serverValue !== undefined ? num(serverValue) : sumDec(filtered.map((r) => r[c.id] as string));
    });
    return out;
  }, [filtered, totals, isFiltered]);

  const footer = filtered.length > 0 ? (
    <tfoot className="sticky bottom-0 z-20">
      <tr>
        {columns.map((c, i) => {
          const id = (c.id ?? (c as { accessorKey?: string }).accessorKey) as keyof PayDaysRow;
          const col = NUMERIC.find((n) => n.id === id);
          const v = footTotals[id];
          return (
            <td key={String(id)} className={cn("glass whitespace-nowrap border-t px-3 py-2.5 text-xs font-semibold",
              i === 0 && "sticky left-0 z-30", col && "text-right tnum")}>
              {i === 0 ? "Totals" : i === 1 ? <span className="font-normal text-muted-foreground tnum">{filtered.length} employees{isFiltered ? " (filtered)" : ""}</span>
                : col && v !== undefined ? fmt(col.kind, v) : ""}
            </td>
          );
        })}
      </tr>
    </tfoot>
  ) : null;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name, code, department"
            aria-label="Filter pay-days rows" className="pl-9" />
        </div>
        <button type="button" aria-pressed={lopOnly} onClick={() => setLopOnly((v) => !v)} disabled={!lopCount}
          className={cn("inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            lopOnly ? "border-status-lop/40 bg-status-lop/10 text-status-lop-fg" : "bg-surface text-muted-foreground hover:text-foreground")}>
          <BadgeMinus className="size-4" aria-hidden />With LOP <span className="tnum">({lopCount})</span>
        </button>
        {isFiltered && (
          <button type="button" onClick={() => { setSearch(""); setLopOnly(false); }}
            className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" aria-hidden />Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground tnum" aria-live="polite">
          {isFiltered ? `${filtered.length} of ${rows.length}` : `${rows.length}`} employees
        </span>
      </div>
      <DataTable columns={columns} data={filtered} loading={loading} virtual={filtered.length > 60} maxHeight="68vh"
        rowKey={(r) => r.employee_id} footer={footer}
        empty={<EmptyState art={rows.length ? "search" : "people"} compact={!!rows.length}
          title={rows.length ? "No rows match" : "No employees in this cycle"}
          description={rows.length ? "Try another name or clear the filter." : "Nobody was employed during this cycle."} />} />
    </div>
  );
}
