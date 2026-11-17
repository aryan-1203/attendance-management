import * as React from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, CheckCircle2, FileSpreadsheet, RefreshCw, UploadCloud, UserPlus, UserRoundPen, X } from "lucide-react";
import { upload } from "@/lib/api";
import { cn, pluralize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { easeOut } from "@/components/shared/motion";

interface BulkResult {
  dry_run: boolean; total: number; created: number; updated: number;
  errors: { row: number; code: string; message: string }[];
}

const COLUMNS = ["Emp Code*", "Name*", "DOJ*", "Department", "Designation", "Manager Code", "Employment Type",
  "Probation End Date", "Confirmation Date", "Exit Date", "Weekly Off", "Email", "Phone", "DOB"];

/** Bulk employee import: pick file → dry-run preview → commit. */
export function EmployeeImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<BulkResult | null>(null);
  const [done, setDone] = React.useState<BulkResult | null>(null);
  const [reject, setReject] = React.useState<string | null>(null);

  const reset = () => { setFile(null); setPreview(null); setDone(null); setReject(null); };
  React.useEffect(() => { if (!open) reset(); }, [open]);

  const dry = useMutation({
    meta: { silent: true },
    mutationFn: (f: File) => upload<BulkResult>("/api/employees/import", f, { dry_run: true }),
    onSuccess: setPreview,
  });
  const commit = useMutation({
    mutationFn: (f: File) => upload<BulkResult>("/api/employees/import", f, { dry_run: false }),
    onSuccess: (r) => {
      setDone(r);
      toast.success(`Imported ${r.created + r.updated} employees`, {
        description: `${r.created} new · ${r.updated} updated${r.errors.length ? ` · ${r.errors.length} skipped` : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["designations"] });
      qc.invalidateQueries({ queryKey: ["managers"] });
    },
  });

  const onDrop = React.useCallback((accepted: File[], rejected: FileRejection[]) => {
    if (rejected.length) { setReject("Upload an Excel (.xlsx, .xls) or CSV file up to 10 MB."); return; }
    const f = accepted[0];
    if (!f) return;
    setReject(null); setPreview(null); setDone(null); setFile(f);
    dry.mutate(f);
  }, [dry]);
  const dz = useDropzone({
    onDrop, multiple: false, maxSize: 10 * 1024 * 1024,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"], "text/csv": [".csv"],
    },
  });

  const valid = preview ? preview.created + preview.updated : 0;
  const step = done ? "done" : preview ? "preview" : "pick";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!commit.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import employees</DialogTitle>
          <DialogDescription>
            We check the file first (nothing is saved), then you confirm. Existing codes are updated; new codes are created.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex items-center gap-2 text-xs font-medium" aria-label="Import progress">
          {["Choose file", "Review", "Done"].map((s, i) => {
            const idx = step === "pick" ? 0 : step === "preview" ? 1 : 2;
            return (
              <li key={s} className="flex items-center gap-2" aria-current={i === idx ? "step" : undefined}>
                <span className={cn("flex size-5 items-center justify-center rounded-full text-2xs tnum",
                  i < idx ? "bg-success text-success-foreground" : i === idx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  {i < idx ? <CheckCircle2 className="size-3" aria-hidden /> : i + 1}
                </span>
                <span className={i === idx ? "text-foreground" : "text-muted-foreground"}>{s}</span>
                {i < 2 && <span className="h-px w-6 bg-border" aria-hidden />}
              </li>
            );
          })}
        </ol>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: easeOut }} className="grid gap-4">
            {step === "pick" && (
              <>
                <div {...dz.getRootProps({
                  className: cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    dz.isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40"),
                })} aria-label="Choose an employee file to import">
                  <input {...dz.getInputProps()} />
                  {dry.isPending ? (
                    <>
                      <RefreshCw className="size-8 animate-spin text-primary" aria-hidden />
                      <p className="font-medium">Checking {file?.name}…</p>
                      <p className="text-sm text-muted-foreground">Validating rows. Nothing is saved yet.</p>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="size-8 text-primary" aria-hidden />
                      <p className="font-medium">{dz.isDragActive ? "Drop to check the file" : "Drag an Excel or CSV file here"}</p>
                      <p className="text-sm text-muted-foreground">or <span className="font-medium text-primary">browse</span> · .xlsx, .xls, .csv up to 10 MB</p>
                    </>
                  )}
                </div>
                {reject && <InlineAlert tone="destructive">{reject}</InlineAlert>}
                {dry.isError && <InlineAlert tone="destructive" title="We couldn't read that file">{(dry.error as Error).message}</InlineAlert>}
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Recognised columns (* required). Dates as YYYY-MM-DD or DD-MM-YYYY; weekly off as 0–6 (0 = Mon, 6 = Sun).</p>
                  <div className="flex flex-wrap gap-1.5">
                    {COLUMNS.map((c) => <span key={c} className="rounded-md border bg-surface px-1.5 py-0.5 font-mono text-2xs">{c}</span>)}
                  </div>
                </div>
              </>
            )}

            {step === "preview" && preview && (
              <>
                <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
                  <FileSpreadsheet className="size-8 shrink-0 text-success" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{file?.name}</p>
                    <p className="text-xs text-muted-foreground tnum">{pluralize(preview.total, "row")} checked</p>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label="Choose a different file" onClick={reset}><X /></Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Tile icon={<UserPlus />} label="New" value={preview.created} tone="success" />
                  <Tile icon={<UserRoundPen />} label="Updates" value={preview.updated} tone="primary" />
                  <Tile icon={<AlertCircle />} label="Errors" value={preview.errors.length} tone={preview.errors.length ? "destructive" : "muted"} />
                </div>
                {preview.errors.length > 0 ? (
                  <div className="max-h-56 overflow-auto rounded-lg border scrollbar-thin">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Rows with errors</caption>
                      <thead className="glass sticky top-0 text-left text-xs text-muted-foreground">
                        <tr><th className="px-3 py-2 font-semibold">Row</th><th className="px-3 py-2 font-semibold">Code</th>
                          <th className="px-3 py-2 font-semibold">Problem</th></tr>
                      </thead>
                      <tbody>
                        {preview.errors.map((e, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-2 tnum text-muted-foreground">{e.row}</td>
                            <td className="px-3 py-2 font-mono text-xs">{e.code}</td>
                            <td className="px-3 py-2 text-destructive">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <InlineAlert tone="success" icon={<CheckCircle2 className="size-4" />} title="Every row looks good">
                    Ready to import {pluralize(valid, "employee")}.
                  </InlineAlert>
                )}
                {preview.errors.length > 0 && valid > 0 && (
                  <InlineAlert tone="warning">Rows with errors will be skipped. Fix them in the file and re-import later if needed.</InlineAlert>
                )}
                <p className="text-xs text-muted-foreground">New departments and designations in the file are created automatically. Joining/exit date changes recalculate balances.</p>
              </>
            )}

            {step === "done" && done && (
              <EmptyState art="check" title="Import complete"
                description={<span className="tnum">{done.created} created · {done.updated} updated{done.errors.length ? ` · ${done.errors.length} skipped` : ""}</span>} />
            )}
          </motion.div>
        </AnimatePresence>

        <DialogFooter>
          {step === "done" ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={commit.isPending}>Cancel</Button>
              {step === "preview" && (
                <Button onClick={() => file && commit.mutate(file)} loading={commit.isPending} disabled={!valid}>
                  Import {pluralize(valid, "employee")}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number;
  tone: "success" | "primary" | "destructive" | "muted" }) {
  const cls = { success: "text-success bg-success/10", primary: "text-primary bg-primary/10",
    destructive: "text-destructive bg-destructive/10", muted: "text-muted-foreground bg-muted" }[tone];
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card p-3">
      <span className={cn("flex size-8 items-center justify-center rounded-lg [&_svg]:size-4", cls)} aria-hidden>{icon}</span>
      <div>
        <div className="text-lg font-semibold leading-none tnum">{value}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
