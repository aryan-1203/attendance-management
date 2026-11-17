import * as React from "react";
import { useDropzone } from "react-dropzone";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud, X, XOctagon } from "lucide-react";
import { toast } from "sonner";
import { upload } from "@/lib/api";
import { cn, downloadBlob, pluralize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/shared/page";
import { toastHolidayError } from "./holiday-dialog";

interface BulkResult {
  dry_run: boolean; total: number; created: number; updated: number;
  errors: { row: number; code: string; message: string }[];
}

const ACCEPT = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
  "text/csv": [".csv"],
};

function sampleCsv(year: number) {
  const rows = [["Date", "Name", "Type"], [`${year}-01-26`, "Republic Day", "public"], [`${year}-03-14`, "Holi", "public"],
    [`${year}-04-03`, "Good Friday", "optional"], [`${year}-08-28`, "Raksha Bandhan", "restricted"]];
  downloadBlob(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }), `holidays_${year}_sample.csv`);
}

export function HolidayImportDialog({ open, onOpenChange, year, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; year: number; onDone: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<BulkResult | null>(null);
  React.useEffect(() => { if (!open) { setFile(null); setPreview(null); } }, [open]);

  const dry = useMutation({
    meta: { silent: true },
    mutationFn: (f: File) => upload<BulkResult>("/api/holidays/import", f, { dry_run: true }),
    onSuccess: setPreview,
    onError: (e) => { setFile(null); toastHolidayError(e); },
  });
  const commit = useMutation({
    meta: { silent: true },
    mutationFn: (f: File) => upload<BulkResult>("/api/holidays/import", f, { dry_run: false }),
    onSuccess: (r) => {
      toast.success(`Imported ${pluralize(r.created, "holiday")}`, {
        description: `${r.errors.length ? `${pluralize(r.errors.length, "row")} skipped. ` : ""}Open cycles recalculated.`,
      });
      onDone();
      onOpenChange(false);
    },
    onError: toastHolidayError,
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPT, multiple: false, maxSize: 5 * 1024 * 1024, disabled: dry.isPending,
    onDrop: (files, rej) => {
      if (rej.length) { toast.error("Upload an .xlsx, .xls or .csv file under 5 MB"); return; }
      if (files[0]) { setFile(files[0]); setPreview(null); dry.mutate(files[0]); }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import holidays</DialogTitle>
          <DialogDescription>
            Upload a sheet with <b className="text-foreground">Date</b>, <b className="text-foreground">Name</b> and an optional{" "}
            <b className="text-foreground">Type</b> (public, optional, restricted). We'll check it first — nothing is saved until you confirm.
          </DialogDescription>
        </DialogHeader>

        {!file ? (
          <div {...getRootProps({ role: "button", "aria-label": "Upload holiday file: drop a file here or press Enter to browse" })}
            className={cn("flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isDragActive ? "border-primary bg-primary/5" : "hover:border-primary/50")}>
            <input {...getInputProps()} aria-label="Holiday file" />
            <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden><UploadCloud className="size-6" /></span>
            <div>
              <p className="text-sm font-semibold">{isDragActive ? "Drop to check" : "Drop a file or click to browse"}</p>
              <p className="text-xs text-muted-foreground">.xlsx, .xls or .csv</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="flex items-center gap-3 rounded-lg border bg-surface-sunken/60 px-3 py-2.5">
              <FileSpreadsheet className="size-4 text-success" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
              <Button variant="ghost" size="icon-sm" aria-label="Choose a different file" onClick={() => { setFile(null); setPreview(null); }}
                disabled={commit.isPending}><X aria-hidden /></Button>
            </div>
            {dry.isPending && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden />Checking rows…
              </p>
            )}
            {preview && (
              <div className="grid gap-3" aria-live="polite">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Count label="Rows" value={preview.total} />
                  <Count label="Will be added" value={preview.created} tone="success" />
                  <Count label="Skipped" value={preview.errors.length} tone={preview.errors.length ? "destructive" : undefined} />
                </div>
                {preview.errors.length > 0 ? (
                  <div className="max-h-56 overflow-y-auto rounded-lg border scrollbar-thin">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                        <tr><th scope="col" className="px-3 py-2 text-left font-medium">Row</th><th scope="col" className="px-3 py-2 text-left font-medium">Name</th><th scope="col" className="px-3 py-2 text-left font-medium">Problem</th></tr>
                      </thead>
                      <tbody>
                        {preview.errors.map((e, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-2 tnum text-muted-foreground">{e.row}</td>
                            <td className="max-w-[10rem] truncate px-3 py-2">{e.code || "—"}</td>
                            <td className="px-3 py-2 text-destructive"><span className="inline-flex items-start gap-1.5"><XOctagon className="mt-0.5 size-3.5 shrink-0" aria-hidden />{e.message}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : preview.created > 0 ? (
                  <InlineAlert tone="success" icon={<CheckCircle2 className="size-4" />} title="Everything checks out" />
                ) : null}
                {preview.created === 0 && (
                  <InlineAlert tone="warning" title="Nothing new to add">Every row was skipped — fix the problems above and try again.</InlineAlert>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => sampleCsv(year)}><Download aria-hidden />Sample CSV</Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={!file || !preview || preview.created === 0} loading={commit.isPending}
              onClick={() => file && commit.mutate(file)}>
              {preview?.created ? `Import ${pluralize(preview.created, "holiday")}` : "Import"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "success" | "destructive" }) {
  return (
    <div className="rounded-lg border bg-surface px-2 py-2.5">
      <p className={cn("text-xl font-semibold tnum", tone === "success" && "text-success", tone === "destructive" && "text-destructive")}>{value}</p>
      <p className="text-2xs text-muted-foreground">{label}</p>
    </div>
  );
}
