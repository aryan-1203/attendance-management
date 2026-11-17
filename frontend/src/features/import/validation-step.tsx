import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarRange, CheckCircle2, Download, Grid3x3, ListChecks, Users, XOctagon } from "lucide-react";
import { toast } from "sonner";
import { client, download, errorMessage, unwrap } from "@/lib/api";
import { statusMeta } from "@/lib/status";
import { cn, downloadBlob, fmtDate, pluralize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ErrorState, InlineAlert, StatTile } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { CountUp } from "@/components/shared/motion";
import { DataTable, Pager } from "@/components/shared/data-table";
import type { ImportSummary, Issue, PreviewCell, PreviewGrid } from "./types";

type Sev = "ok" | "warning" | "error";
type RowOut = {
  id: number; row_number: number; column_ref: string; employee_code: string; date: string | null; status: string;
  raw_value: string; severity: string; issues: Issue[] | null;
};

export function SummaryTiles({ s }: { s: ImportSummary }) {
  const b = s.batch;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <StatTile label="Valid" tone="success" icon={<CheckCircle2 />} value={<CountUp value={b.valid_rows} />} sub="ready to import" />
      <StatTile label="Warnings" tone="warning" icon={<AlertTriangle />} value={<CountUp value={b.warning_rows} />} sub="imported, worth a look" />
      <StatTile label="Errors" tone="destructive" icon={<XOctagon />} value={<CountUp value={b.error_rows} />} sub="will be skipped" />
      <StatTile label="Employees" tone="primary" icon={<Users />} value={<CountUp value={s.employees} />} sub="matched in file" />
      <StatTile label="Date range" tone="muted" icon={<CalendarRange />} className="col-span-2 md:col-span-1"
        value={<span className="text-lg">{s.date_from ? `${fmtDate(s.date_from, "d MMM")} – ${fmtDate(s.date_to, "d MMM")}` : "—"}</span>}
        sub={s.date_to ? fmtDate(s.date_to, "yyyy") : "no valid dates"} />
    </div>
  );
}

export function ValidationStep({ summary, version, onBack, onNext }: {
  summary: ImportSummary; version: number; onBack: () => void; onNext: () => void;
}) {
  const b = summary.batch;
  const importable = b.valid_rows + b.warning_rows;
  const [dl, setDl] = React.useState(false);
  const downloadErrors = async () => {
    setDl(true);
    try {
      const { blob, filename } = await download(`/api/imports/${b.id}/errors.xlsx`);
      downloadBlob(blob, filename);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDl(false);
    }
  };
  const byStatus = Object.entries(summary.by_status).sort((a, z) => z[1] - a[1]);
  const issues = Object.entries(summary.issue_summary);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <SummaryTiles s={summary} />

      <InlineAlert tone={importable === 0 ? "destructive" : b.error_rows ? "warning" : "success"}
        icon={importable === 0 ? <XOctagon className="size-4" /> : b.error_rows ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
        title={importable === 0 ? "Nothing can be imported yet" :
          `${pluralize(importable, "mark")} will be imported${b.error_rows ? `, ${pluralize(b.error_rows, "error row")} skipped` : ""}`}>
        {importable === 0
          ? "Every row has an error. Fix the file (download the error rows below) or adjust the mapping, then validate again."
          : <>Valid and warning rows are imported; rows with errors are skipped and leave existing attendance untouched.{" "}
            {b.error_rows > 0 && "Download the error rows to fix them and import them in a second pass."}</>}
      </InlineAlert>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>By status</CardTitle><CardDescription>Importable marks per status</CardDescription></CardHeader>
          <CardContent>
            {byStatus.length === 0 ? <p className="text-sm text-muted-foreground">No importable marks.</p> : (
              <ul className="flex flex-wrap gap-2">
                {byStatus.map(([code, n]) => (
                  <li key={code} className="inline-flex items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5 shadow-e1">
                    <StatusBadge code={code} />
                    <span className="text-sm font-semibold tnum">{n}</span>
                    <span className="sr-only">{statusMeta(code)?.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Most common issues</CardTitle><CardDescription>Grouped across all rows</CardDescription></CardHeader>
          <CardContent>
            {issues.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden />No issues found — clean file.</p>
            ) : (
              <ul className="grid gap-1.5">
                {issues.map(([msg, n]) => (
                  <li key={msg} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{msg}</span>
                    <Badge variant="secondary" className="tnum">{n}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="grid">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList aria-label="Preview mode">
            <TabsTrigger value="grid"><Grid3x3 aria-hidden />Grid</TabsTrigger>
            <TabsTrigger value="issues"><ListChecks aria-hidden />Issue rows</TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" onClick={downloadErrors} loading={dl}
            disabled={b.error_rows + b.warning_rows === 0}>
            {!dl && <Download aria-hidden />}Download error rows
          </Button>
        </div>
        <TabsContent value="grid"><PreviewGridCard batchId={b.id} version={version} /></TabsContent>
        <TabsContent value="issues"><IssueRows batchId={b.id} version={version} errors={b.error_rows} warnings={b.warning_rows} /></TabsContent>
      </Tabs>

      <div className="sticky bottom-0 z-20 -mx-1 flex flex-col-reverse gap-2 rounded-xl border glass px-3 py-3 shadow-e2 safe-bottom sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft aria-hidden />Adjust mapping</Button>
        <Button onClick={onNext} disabled={importable === 0}>Review &amp; confirm<ArrowRight aria-hidden /></Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ grid */

const SEV_CELL: Record<Sev, string> = {
  ok: "bg-success/5 text-foreground ring-success/15",
  warning: "bg-warning/15 text-warning ring-warning/40",
  error: "bg-destructive/10 text-destructive ring-destructive/40",
};

function PreviewGridCard({ batchId, version }: { batchId: number; version: number }) {
  const [filter, setFilter] = React.useState<"all" | "issues" | "error">("all");
  const q = useQuery({
    queryKey: ["import-preview", batchId, version],
    queryFn: async () => (await unwrap(client.GET("/api/imports/{batch_id}/preview",
      { params: { path: { batch_id: batchId } } }))) as unknown as PreviewGrid,
  });
  const data = q.data;
  const rows = React.useMemo(() => {
    if (!data) return [];
    return data.employees.filter((e) => {
      const cells = Object.values(e.cells);
      if (filter === "error") return cells.some((c) => c.sev === "error");
      if (filter === "issues") return cells.some((c) => c.sev !== "ok");
      return true;
    });
  }, [data, filter]);
  const undated = React.useMemo(() => data?.employees.reduce(
    (n, e) => n + Object.keys(e.cells).filter((k) => k.startsWith("?")).length, 0) ?? 0, [data]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div role="radiogroup" aria-label="Show employees" className="inline-flex gap-0.5 rounded-lg bg-muted p-1">
          {([["all", "All"], ["issues", "With issues"], ["error", "With errors"]] as const).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={filter === v} onClick={() => setFilter(v)}
              className={cn("cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-all duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === v ? "bg-surface text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        <ul className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-label="Cell legend">
          <li className="inline-flex items-center gap-1.5"><span className={cn("size-4 rounded ring-1 ring-inset", SEV_CELL.ok)} />Valid</li>
          <li className="inline-flex items-center gap-1.5"><span className={cn("flex size-4 items-center justify-center rounded ring-1 ring-inset", SEV_CELL.warning)}><AlertTriangle className="size-2.5" aria-hidden /></span>Warning</li>
          <li className="inline-flex items-center gap-1.5"><span className={cn("flex size-4 items-center justify-center rounded ring-1 ring-inset", SEV_CELL.error)}><XOctagon className="size-2.5" aria-hidden /></span>Error (skipped)</li>
        </ul>
      </div>
      {q.isLoading ? (
        <div className="grid gap-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7" />)}</div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !data || data.employees.length === 0 ? (
        <EmptyState art="search" title="Nothing to preview" description="No non-blank cells were found with this mapping." />
      ) : rows.length === 0 ? (
        <EmptyState compact art="check" title={filter === "error" ? "No errors" : "No issues"} description="Every employee in this file is clean for this filter." />
      ) : (
        <div className="max-h-[60vh] overflow-auto scrollbar-thin" role="region" aria-label="Validation grid" tabIndex={0}>
          <table className="border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-20">
              <tr>
                <th scope="col" className="glass sticky left-0 z-30 min-w-[11rem] border-b border-r px-3 py-2 text-left font-semibold text-muted-foreground">Employee</th>
                {data.dates.map((d) => {
                  const dt = new Date(`${d}T00:00:00`);
                  const sun = dt.getDay() === 0;
                  return (
                    <th key={d} scope="col" className={cn("glass min-w-[2.75rem] border-b px-0.5 py-1.5 text-center font-medium", sun ? "text-muted-foreground/60" : "text-muted-foreground")}>
                      <span className="block text-2xs uppercase">{fmtDate(d, "EEEEE")}</span>
                      <span className="block font-semibold text-foreground tnum">{fmtDate(d, "d")}</span>
                      <span className="sr-only">{fmtDate(d, "EEEE d MMMM")}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.code}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-r bg-card px-3 py-1.5 text-left font-normal">
                    <span className="block font-mono text-xs font-semibold">{e.code}</span>
                    <span className="block max-w-[10rem] truncate text-2xs text-muted-foreground">{e.name ?? "Unknown employee"}</span>
                  </th>
                  {data.dates.map((d) => (
                    <td key={d} className="border-b p-0.5 text-center">
                      <GridCell cell={e.cells[d]} label={`${e.code}, ${fmtDate(d, "d MMM")}`} dim={filter !== "all"} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <p className="border-t px-3 py-2 text-2xs text-muted-foreground tnum">
          Showing {rows.length} of {data.employees.length} employees{data.employees.length >= 200 ? " (first 200)" : ""}
          {data.dates.length >= 62 ? " · first 62 dates" : ""}
          {undated > 0 && ` · ${pluralize(undated, "row")} with unreadable dates are listed under Issue rows`}
        </p>
      )}
    </Card>
  );
}

const GridCell = React.memo(function GridCell({ cell, label, dim }: { cell?: PreviewCell; label: string; dim: boolean }) {
  if (!cell) return <span className="block h-7 leading-7 text-muted-foreground/40" aria-hidden>·</span>;
  const Icon = cell.sev === "error" ? XOctagon : cell.sev === "warning" ? AlertTriangle : null;
  const base = cn("flex h-7 w-full min-w-[2.5rem] items-center justify-center gap-0.5 rounded-md px-1 font-mono text-2xs font-semibold ring-1 ring-inset",
    SEV_CELL[cell.sev], dim && cell.sev === "ok" && "opacity-40");
  if (cell.sev === "ok") {
    return <span className={base} title={`${label}: ${cell.v}`}>{cell.v}</span>;
  }
  return (
    <Tooltip content={
      <div className="grid gap-1">
        <p className="font-semibold">{label} · row {cell.row}</p>
        <ul className="grid gap-0.5">
          {cell.issues.map((i, k) => (
            <li key={k} className="flex gap-1.5"><span aria-hidden>{i.severity === "error" ? "✕" : "!"}</span>{i.message}</li>
          ))}
        </ul>
      </div>
    }>
      <button type="button" className={cn(base, "cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        aria-label={`${label}: ${cell.v || "blank"}. ${cell.sev}: ${cell.issues.map((i) => i.message).join("; ")}`}>
        {Icon && <Icon className="size-2.5 shrink-0" aria-hidden />}
        <span className="truncate">{cell.v || "?"}</span>
      </button>
    </Tooltip>
  );
});

/* ------------------------------------------------------------------------------------------ issue rows */

function IssueRows({ batchId, version, errors, warnings }: { batchId: number; version: number; errors: number; warnings: number }) {
  const [sev, setSev] = React.useState<"error" | "warning">(errors ? "error" : "warning");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [sev, version]);
  const q = useQuery({
    queryKey: ["import-rows", batchId, version, sev, page],
    placeholderData: (p) => p,
    queryFn: () => unwrap(client.GET("/api/imports/{batch_id}/rows",
      { params: { path: { batch_id: batchId }, query: { severity: sev, page, page_size: 50 } } })),
  });
  const columns = React.useMemo<ColumnDef<RowOut>[]>(() => [
    { accessorKey: "row_number", header: "Row", size: 64, cell: (c) => <span className="tnum text-muted-foreground">{c.getValue<number>()}</span> },
    { accessorKey: "employee_code", header: "Employee", cell: (c) => <span className="font-mono text-xs font-semibold">{c.getValue<string>() || "—"}</span> },
    { accessorKey: "date", header: "Date", cell: (c) => <span className="whitespace-nowrap tnum">{c.getValue<string | null>() ? fmtDate(c.getValue<string>(), "EEE d MMM") : <span className="text-destructive">Invalid</span>}</span> },
    { accessorKey: "column_ref", header: "Column", cell: (c) => <span className="block max-w-[9rem] truncate font-mono text-xs text-muted-foreground">{c.getValue<string>()}</span> },
    { accessorKey: "raw_value", header: "Value", cell: (c) => {
      const r = c.row.original;
      return statusMeta(r.status) ? <StatusBadge code={r.status} size="xs" /> : <span className="font-mono text-xs">{r.raw_value || "—"}</span>;
    } },
    { id: "issues", header: "Issues", enableSorting: false, cell: (c) => (
      <ul className="grid gap-0.5">
        {(c.row.original.issues ?? []).map((i, k) => (
          <li key={k} className={cn("flex items-start gap-1.5 text-xs", i.severity === "error" ? "text-destructive" : "text-warning")}>
            {i.severity === "error" ? <XOctagon className="mt-0.5 size-3 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />}
            <span className="text-foreground/85">{i.message}</span>
          </li>
        ))}
      </ul>
    ) },
  ], []);
  const data = (q.data?.items ?? []) as unknown as RowOut[];
  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="Severity" className="inline-flex w-fit gap-0.5 rounded-lg bg-muted p-1">
        {([["error", "Errors", errors], ["warning", "Warnings", warnings]] as const).map(([v, l, n]) => (
          <button key={v} type="button" role="radio" aria-checked={sev === v} onClick={() => setSev(v)}
            className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-all duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              sev === v ? "bg-surface text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground")}>
            {l}<span className={cn("rounded-full px-1.5 text-2xs tnum", v === "error" ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning")}>{n}</span>
          </button>
        ))}
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <DataTable columns={columns} data={data} loading={q.isLoading} rowKey={(r) => r.id} maxHeight="60vh"
          empty={<EmptyState compact art="check" title={sev === "error" ? "No errors" : "No warnings"}
            description={sev === "error" ? "Every row passed validation." : "Nothing needs a second look."} />} />
      )}
      {q.data && q.data.pages > 1 && <Pager page={page} pages={q.data.pages} total={q.data.total} onPage={setPage} />}
    </div>
  );
}
