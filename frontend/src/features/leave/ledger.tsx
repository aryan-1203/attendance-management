import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { motion, useReducedMotion } from "framer-motion";
import { Bot, Undo2, UserPen } from "lucide-react";
import type { LedgerEntry } from "@/lib/types";
import { cn, fmtDate } from "@/lib/utils";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { easeOut } from "@/components/shared/motion";
import { Label } from "@/components/ui/label";
import { Skeleton, Switch, Tooltip } from "@/components/ui/misc";
import { Segmented } from "./segmented";
import { Amount, BUCKET_LABEL, EntryTypeBadge, entryMeta } from "./format";

/** Compact vertical timeline of ledger rows (most recent first). */
export function LedgerTimeline({ entries, loading, limit = 8, className, emptyHint }: {
  entries: LedgerEntry[] | undefined; loading?: boolean; limit?: number; className?: string; emptyHint?: string;
}) {
  const reduce = useReducedMotion();
  if (loading) {
    return (
      <ul className={cn("grid gap-3", className)} aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3"><Skeleton className="size-8 rounded-full" />
            <div className="grid flex-1 gap-1.5"><Skeleton className="h-3.5 w-40" /><Skeleton className="h-3 w-24" /></div>
            <Skeleton className="h-4 w-10" /></li>
        ))}
      </ul>
    );
  }
  const rows = (entries ?? []).slice(0, limit);
  if (!rows.length) {
    return <EmptyState compact title="No ledger activity yet" description={emptyHint ?? "Accruals, leave used and adjustments will appear here."} />;
  }
  return (
    <ol className={cn("relative grid", className)} aria-label="Recent ledger activity">
      <span className="absolute bottom-4 left-4 top-4 w-px bg-border" aria-hidden />
      {rows.map((r, i) => {
        const m = entryMeta(r.entry_type);
        const Icon = r.reversal_of_id ? Undo2 : m.icon;
        return (
          <motion.li key={r.id} initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: reduce ? 0 : i * 0.035, ease: easeOut }}
            className="relative flex items-start gap-3 py-2">
            <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card", m.cls)}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("flex flex-wrap items-center gap-x-1.5 text-sm font-medium", r.is_reversed && "text-muted-foreground")}>
                {r.reversal_of_id ? `Reversal · ${m.label}` : m.label}
                <span className="text-2xs font-normal text-muted-foreground">· {BUCKET_LABEL[r.bucket] ?? r.bucket}</span>
                {r.is_reversed && <span className="rounded bg-muted px-1 text-2xs font-semibold text-muted-foreground">Reversed</span>}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {fmtDate(r.entry_date, "d MMM yyyy")}{r.note ? ` · ${r.note}` : ""}
              </p>
            </div>
            <Amount value={r.amount} bucket={r.bucket} struck={r.is_reversed} className="mt-0.5 text-sm" />
          </motion.li>
        );
      })}
    </ol>
  );
}

const BUCKETS = [["all", "All"], ["usable", "Usable"], ["locked", "Locked"], ["comp_off", "Comp-off"], ["lop", "LOP"]] as const;

/** Full immutable ledger history with bucket filter + reversal handling. */
export function LedgerTable({ entries, loading }: { entries: LedgerEntry[] | undefined; loading?: boolean }) {
  const [bucket, setBucket] = React.useState<(typeof BUCKETS)[number][0]>("all");
  const [hideReversals, setHide] = React.useState(false);
  const toggleId = React.useId();
  const rows = React.useMemo(() => (entries ?? []).filter((r) =>
    (bucket === "all" || r.bucket === bucket) && (!hideReversals || (!r.reversal_of_id && !r.is_reversed))),
  [entries, bucket, hideReversals]);
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: entries?.length ?? 0 };
    (entries ?? []).forEach((r) => { c[r.bucket] = (c[r.bucket] ?? 0) + 1; });
    return c;
  }, [entries]);

  const columns = React.useMemo<ColumnDef<LedgerEntry>[]>(() => [
    { accessorKey: "entry_date", header: "Date", cell: ({ row }) => (
      <span className={cn("whitespace-nowrap tnum", row.original.is_reversed && "text-muted-foreground")}>
        {fmtDate(row.original.entry_date, "d MMM yyyy")}</span>) },
    { accessorKey: "entry_type", header: "Type", cell: ({ row }) => (
      <div className="flex flex-wrap items-center gap-1">
        <EntryTypeBadge type={row.original.entry_type} reversal={!!row.original.reversal_of_id} />
        {row.original.is_reversed && (
          <Tooltip content="A later recalculation reversed this row; the reversal sits alongside it in the ledger.">
            <span tabIndex={0} className="rounded bg-muted px-1.5 py-0.5 text-2xs font-semibold text-muted-foreground">Reversed</span>
          </Tooltip>
        )}
      </div>) },
    { accessorKey: "bucket", header: "Bucket", cell: ({ getValue }) => (
      <span className="text-muted-foreground">{BUCKET_LABEL[getValue<string>()] ?? getValue<string>()}</span>) },
    { accessorKey: "amount", header: "Days", meta: { align: "right" }, sortingFn: (a, b) => Number(a.original.amount) - Number(b.original.amount),
      cell: ({ row }) => <Amount value={row.original.amount} bucket={row.original.bucket} struck={row.original.is_reversed} /> },
    { accessorKey: "note", header: "Details", enableSorting: false, cell: ({ row }) => (
      <span className="line-clamp-2 min-w-[180px] text-muted-foreground">{row.original.note || row.original.reference || "—"}</span>) },
    { id: "source", header: "Source", enableSorting: false, cell: ({ row }) => (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        {row.original.is_system ? <><Bot className="size-3.5" aria-hidden />Engine</> : <><UserPen className="size-3.5" aria-hidden />Manual</>}
      </span>) },
  ], []);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Filter by bucket" value={bucket} onChange={setBucket}
          options={BUCKETS.map(([k, label]) => ({ value: k, label, count: counts[k] ?? 0 }))} />
        <div className="flex items-center gap-2">
          <Switch id={toggleId} checked={hideReversals} onCheckedChange={setHide} />
          <Label htmlFor={toggleId} className="text-xs font-normal text-muted-foreground">Hide recalculation pairs</Label>
        </div>
      </div>
      <DataTable columns={columns} data={rows} loading={loading} rowKey={(r) => r.id} maxHeight="60vh" virtual={rows.length > 300}
        empty={<EmptyState compact art="chart" title="No entries" description="Nothing in this bucket yet." />} />
      <p className="text-2xs text-muted-foreground">
        The ledger is immutable — corrections are posted as reversal rows, never edits. Reversed rows are struck through.
      </p>
    </div>
  );
}
