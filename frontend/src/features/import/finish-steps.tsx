import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, CalendarCheck2, CheckCircle2, FileSpreadsheet, History, RefreshCw, ShieldCheck, Undo2, Upload, Users } from "lucide-react";
import { cn, fmtDate, pluralize } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InlineAlert, StatTile } from "@/components/shared/page";
import { CountUp } from "@/components/shared/motion";
import type { CommitResult, ImportSummary } from "./types";

export function ConfirmStep({ summary, onBack, onCommit, committing }: {
  summary: ImportSummary; onBack: () => void; onCommit: () => void; committing: boolean;
}) {
  const b = summary.batch;
  const importable = b.valid_rows + b.warning_rows;
  const points = [
    { icon: <FileSpreadsheet />, title: `${pluralize(importable, "attendance mark")} will be written`,
      text: `${pluralize(summary.employees, "employee")}, ${summary.date_from ? `${fmtDate(summary.date_from, "d MMM")} – ${fmtDate(summary.date_to, "d MMM yyyy")}` : "—"}.` +
        (b.warning_rows ? ` Includes ${pluralize(b.warning_rows, "row")} with warnings (e.g. overwriting an existing mark).` : "") },
    ...(b.error_rows ? [{ icon: <ShieldCheck />, title: `${pluralize(b.error_rows, "error row")} will be skipped`,
      text: "Existing attendance for those cells stays exactly as it is." }] : []),
    { icon: <RefreshCw />, title: "Affected cycles are recalculated",
      text: "Leave balances, LOP and pay days update automatically for every open cycle the file touches." },
    { icon: <Undo2 />, title: "You can roll back",
      text: "From Import history. Marks edited by hand after the import are kept." },
  ];
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <Card className="overflow-hidden">
        <div className="border-b bg-primary/5 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Ready to import</p>
          <p className="mt-1 truncate text-lg font-semibold">{b.filename}</p>
        </div>
        <ul className="grid gap-4 p-5">
          {points.map((p) => (
            <li key={p.title} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4" aria-hidden>{p.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{p.title}</p>
                <p className="text-sm text-muted-foreground">{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <InlineAlert tone="info">
        Dates inside a locked cycle can't be imported — the server will stop the import and tell you which cycle to unlock.
      </InlineAlert>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onBack} disabled={committing}><ArrowLeft aria-hidden />Back to preview</Button>
        <Button size="lg" onClick={onCommit} loading={committing} disabled={importable === 0}>
          {!committing && <CheckCircle2 aria-hidden />}Import {pluralize(importable, "mark")}
        </Button>
      </div>
    </div>
  );
}

export function DoneStep({ result, filename, onAgain, onHistory }: {
  result: CommitResult; filename: string; onAgain: () => void; onHistory: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="mx-auto grid max-w-2xl gap-5 text-center">
      <motion.div initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        className="mx-auto flex size-20 items-center justify-center rounded-full bg-success/10 text-success ring-8 ring-success/5">
        <CheckCircle2 className="size-10" aria-hidden />
      </motion.div>
      <div role="status">
        <h2 className="text-2xl font-semibold tracking-tight">Import complete</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{filename}</span> is now part of attendance, and the numbers are up to date.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-left">
        <StatTile label="Marks applied" tone="success" icon={<CalendarCheck2 />} value={<CountUp value={result.applied} />} />
        <StatTile label="Employees" tone="primary" icon={<Users />} value={<CountUp value={result.employees} />} />
      </div>
      <Card className="p-4 text-left">
        <p className="text-xs font-medium text-muted-foreground">Cycles recalculated</p>
        {result.affected_cycles.length ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {result.affected_cycles.map((c) => (
              <li key={c} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                <RefreshCw className="size-3.5" aria-hidden />{c}
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm">No salary cycles were affected.</p>}
      </Card>
      <div className="flex flex-col justify-center gap-2 sm:flex-row">
        <Button onClick={onAgain}><Upload aria-hidden />Import another file</Button>
        <Button variant="outline" onClick={onHistory}><History aria-hidden />View history</Button>
        <Link to="/attendance" className={cn(buttonVariants({ variant: "ghost" }))}>Open attendance grid</Link>
      </div>
    </div>
  );
}
