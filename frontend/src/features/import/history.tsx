import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { format, formatDistanceToNow } from "date-fns";
import { Columns3, FileSpreadsheet, PlayCircle, Rows3, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { client, unwrap } from "@/lib/api";
import { pluralize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { DataTable, Pager } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/page";
import { BATCH_STATUS, utc, type ImportBatch, type RollbackResult } from "./types";

export function ImportHistory({ onResume, onStart }: { onResume: (b: ImportBatch) => void; onStart: () => void }) {
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [target, setTarget] = React.useState<ImportBatch | null>(null);
  const q = useQuery({
    queryKey: ["imports", page],
    placeholderData: (p) => p,
    queryFn: () => unwrap(client.GET("/api/imports", { params: { query: { page, page_size: 15 } } })),
  });
  const rollback = useMutation({
    mutationFn: (id: number) => unwrap(client.POST("/api/imports/{batch_id}/rollback", { params: { path: { batch_id: id } } })),
    onSuccess: (d) => {
      const r = d as unknown as RollbackResult;
      toast.success("Import rolled back", {
        description: `${pluralize(r.restored, "mark")} restored${r.kept_newer ? ` · ${r.kept_newer} edited since were kept` : ""}. Cycles recalculated.`,
      });
      setTarget(null);
      qc.invalidateQueries();
    },
  });

  const columns = React.useMemo<ColumnDef<ImportBatch>[]>(() => [
    { accessorKey: "filename", header: "File", cell: (c) => {
      const b = c.row.original;
      return (
        <div className="flex min-w-[12rem] items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success" aria-hidden>
            <FileSpreadsheet className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="max-w-[16rem] truncate font-medium" title={b.filename}>{b.filename}</p>
            <p className="text-2xs text-muted-foreground tnum">#{b.id}{b.sheet_name ? ` · ${b.sheet_name}` : ""}</p>
          </div>
        </div>
      );
    } },
    { accessorKey: "created_at", header: "Uploaded", cell: (c) => {
      const d = utc(c.getValue<string>());
      return (
        <Tooltip content={format(d, "d MMM yyyy, HH:mm")}>
          <span className="whitespace-nowrap text-muted-foreground" tabIndex={0}>{formatDistanceToNow(d, { addSuffix: true })}</span>
        </Tooltip>
      );
    } },
    { accessorKey: "layout", header: "Layout", cell: (c) => (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        {c.getValue<string>() === "long" ? <Rows3 className="size-3.5" aria-hidden /> : <Columns3 className="size-3.5" aria-hidden />}
        {c.getValue<string>() === "long" ? "Long" : "Wide"}
      </span>
    ) },
    { id: "rows", header: "Rows", enableSorting: false, cell: (c) => {
      const b = c.row.original;
      if (!b.total_rows) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs tnum">
          <span className="text-success" title="Valid">{b.valid_rows}<span className="sr-only"> valid</span></span>
          <span className="text-warning" title="Warnings">{b.warning_rows}<span className="sr-only"> warnings</span></span>
          <span className="text-destructive" title="Errors">{b.error_rows}<span className="sr-only"> errors</span></span>
          <span className="text-muted-foreground">of {b.total_rows}</span>
        </span>
      );
    } },
    { accessorKey: "applied_rows", header: "Applied", meta: { align: "right" }, cell: (c) => c.getValue<number>() || "—" },
    { accessorKey: "status", header: "Status", cell: (c) => {
      const s = BATCH_STATUS[c.getValue<string>()] ?? { label: c.getValue<string>(), variant: "secondary" as const };
      return <Badge variant={s.variant}>{s.label}</Badge>;
    } },
    { id: "actions", header: () => <span className="sr-only">Actions</span>, enableSorting: false, cell: (c) => {
      const b = c.row.original;
      if (b.status === "committed") {
        return (
          <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10"
            onClick={(e) => { e.stopPropagation(); setTarget(b); }} aria-label={`Roll back ${b.filename}`}>
            <Undo2 aria-hidden />Roll back
          </Button>
        );
      }
      if (b.status === "validated" || b.status === "uploaded") {
        return (
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onResume(b); }} aria-label={`Resume ${b.filename}`}>
            <PlayCircle aria-hidden />Resume
          </Button>
        );
      }
      return null;
    } },
  ], [onResume]);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <DataTable columns={columns} data={q.data?.items ?? []} loading={q.isLoading} rowKey={(r) => r.id}
        empty={<EmptyState art="upload" title="No imports yet" description="Uploaded files and their outcome show up here, with one-click roll back."
          action={<Button size="sm" onClick={onStart}>Start an import</Button>} />} />
      {q.data && q.data.total > 0 && <Pager page={page} pages={q.data.pages} total={q.data.total} onPage={setPage} />}
      <ConfirmDialog open={!!target} onOpenChange={(v) => !v && setTarget(null)} destructive
        title="Roll back this import?" confirmLabel="Roll back" loading={rollback.isPending}
        onConfirm={() => target && rollback.mutate(target.id)}
        description={target && <>
          The {pluralize(target.applied_rows, "mark")} from <b className="text-foreground">{target.filename}</b> will be restored to
          their previous values and affected cycles recalculated. Marks edited after the import are kept. Locked cycles
          must be unlocked first.
        </>} />
    </>
  );
}
