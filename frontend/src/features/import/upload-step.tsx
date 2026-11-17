import * as React from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { useMutation } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Columns3, FileSpreadsheet, Loader2, Rows3, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { upload, errorMessage } from "@/lib/api";
import type { InspectOut } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { InlineAlert } from "@/components/shared/page";
import { TemplateButtons } from "./template-buttons";
import { toInspect, type Inspect } from "./types";

const ACCEPT = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
  "text/csv": [".csv"],
};
const MAX = 15 * 1024 * 1024;

export function UploadStep({ onUploaded }: { onUploaded: (i: Inspect) => void }) {
  const reduce = useReducedMotion();
  const [rejection, setRejection] = React.useState<string | null>(null);
  const up = useMutation({
    meta: { silent: true },
    mutationFn: (file: File) => upload<InspectOut>("/api/imports/upload", file),
    onSuccess: (d) => {
      toast.success(`Read ${d.batch.filename}`, { description: `${d.headers.length} columns found` });
      onUploaded(toInspect(d));
    },
    onError: (e) => setRejection(errorMessage(e)),
  });

  const onDrop = React.useCallback((files: File[], rejected: FileRejection[]) => {
    setRejection(null);
    if (rejected.length) {
      const code = rejected[0].errors[0]?.code;
      setRejection(code === "file-too-large" ? "That file is larger than 15 MB." :
        code === "file-invalid-type" ? "Upload an .xlsx, .xls or .csv file." : rejected[0].errors[0]?.message ?? "File not accepted");
      return;
    }
    if (files[0]) up.mutate(files[0]);
  }, [up]);

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop, accept: ACCEPT, maxSize: MAX, multiple: false, disabled: up.isPending,
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-3">
        <div {...getRootProps({ role: "button", "aria-label": "Upload attendance file: drop a file here or press Enter to browse",
          "aria-busy": up.isPending || undefined })}
          className={cn("group relative flex min-h-[260px] cursor-pointer flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl border-2 border-dashed bg-card p-8 text-center shadow-e1 transition-[border-color,background-color] duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            isDragActive && !isDragReject && "border-primary bg-primary/5",
            isDragReject && "border-destructive bg-destructive/5",
            !isDragActive && "border-border hover:border-primary/50")}>
          <input {...getInputProps()} aria-label="Attendance file" />
          <motion.div animate={reduce ? undefined : { y: isDragActive ? -6 : 0, scale: isDragActive ? 1.06 : 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className={cn("flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary",
              isDragReject && "bg-destructive/10 text-destructive")}>
            {up.isPending ? <Loader2 className="size-7 animate-spin" aria-hidden /> : <UploadCloud className="size-7" aria-hidden />}
          </motion.div>
          <div className="grid gap-1" aria-live="polite">
            <p className="text-base font-semibold">
              {up.isPending ? "Reading your file…" : isDragReject ? "That file type isn't supported" :
                isDragActive ? "Drop to upload" : "Drag your attendance sheet here"}
            </p>
            <p className="text-sm text-muted-foreground">
              Excel (.xlsx, .xls) or CSV · up to 15 MB · nothing is saved until you confirm
            </p>
          </div>
          <span aria-hidden className={cn("inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-e1 transition-colors group-hover:bg-primary/90",
            up.isPending && "opacity-50")}>
            <FileSpreadsheet className="size-4" />Browse files
          </span>
        </div>
        {rejection && <InlineAlert tone="destructive" title="Couldn't use that file">{rejection}</InlineAlert>}
      </div>

      <Card className="grid content-start gap-4 p-5">
        <div>
          <h3 className="text-sm font-semibold">Two layouts work</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">We detect which one you uploaded — you can adjust it next.</p>
        </div>
        <LayoutHint icon={<Columns3 />} title="Wide" text="One row per employee, one column per date (like a muster roll)." sample={["Emp Code", "20-Oct", "21-Oct", "…"]} />
        <LayoutHint icon={<Rows3 />} title="Long" text="One row per employee per day, with Date, Status and optional Note columns." sample={["Emp Code", "Date", "Status", "Note"]} />
        <div className="border-t pt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Start from a blank template, pre-filled with active employees</p>
          <TemplateButtons />
        </div>
      </Card>
    </div>
  );
}

function LayoutHint({ icon, title, text, sample }: { icon: React.ReactNode; title: string; text: string; sample: string[] }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{text}</p>
        <div className="mt-1.5 flex flex-wrap gap-1" aria-hidden>
          {sample.map((s) => <span key={s} className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-2xs text-muted-foreground ring-1 ring-inset ring-border">{s}</span>)}
        </div>
      </div>
    </div>
  );
}
