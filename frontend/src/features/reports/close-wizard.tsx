import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ExternalLink, Lock, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, client, errorMessage, unwrap } from "@/lib/api";
import type { Cycle } from "@/lib/types";
import { cn, fmtDate, fmtDays, num, pluralize } from "@/lib/utils";
import { qk } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Checkbox, Skeleton } from "@/components/ui/misc";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState, InlineAlert } from "@/components/shared/page";
import { CountUp, easeOut } from "@/components/shared/motion";
import { reportKeys, type CloseCheck, type CloseChecks, type LockResult } from "./types";

type Step = "checks" | "preview" | "lock" | "done";
const STEPS: { key: Step; label: string }[] = [
  { key: "checks", label: "Checks" }, { key: "preview", label: "Preview" }, { key: "lock", label: "Lock" }, { key: "done", label: "Done" },
];
const LINKS: Record<string, { to: string; label: string }> = {
  unmarked: { to: "/attendance", label: "Open attendance grid" },
  pending_leave: { to: "/leave", label: "Review leave requests" },
  pending_regularization: { to: "/leave", label: "Review corrections" },
};

export function CloseCycleWizard({ cycle, open, onOpenChange, onDone }: {
  cycle: Cycle; open: boolean; onOpenChange: (v: boolean) => void; onDone?: (r: LockResult) => void;
}) {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [step, setStep] = React.useState<Step>("checks");
  const [ack, setAck] = React.useState(false);
  const [result, setResult] = React.useState<LockResult | null>(null);
  React.useEffect(() => { if (open) { setStep("checks"); setAck(false); setResult(null); } }, [open]);

  const checks = useQuery({
    queryKey: reportKeys.checks(cycle.id), enabled: open, staleTime: 0,
    queryFn: async () => (await unwrap(client.GET("/api/cycles/{cycle_id}/close-checks", {
      params: { path: { cycle_id: cycle.id } } }))) as unknown as CloseChecks,
  });
  const warnings = (checks.data?.checks ?? []).filter((c) => c.status !== "ok");
  const needsAck = warnings.length > 0;

  const lock = useMutation({
    meta: { silent: true },
    mutationFn: async () => (await unwrap(client.POST("/api/cycles/{cycle_id}/lock", {
      params: { path: { cycle_id: cycle.id } }, body: { acknowledge_warnings: needsAck && ack } }))) as unknown as LockResult,
    onSuccess: (r) => {
      setResult(r);
      setStep("done");
      toast.success(`${cycle.label} locked`, { description: "Pay-days figures are now frozen for payroll." });
      qc.invalidateQueries({ queryKey: qk.cycles });
      qc.invalidateQueries({ queryKey: reportKeys.payDays(cycle.id) });
      qc.invalidateQueries({ queryKey: ["report-runs"] });
      qc.invalidateQueries({ queryKey: ["grid"] });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      onDone?.(r);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "checks_pending") {
        checks.refetch();
        setStep("checks");
        toast.warning("Some checks changed — please review them again.");
        return;
      }
      toast.error(errorMessage(e));
    },
  });

  const idx = STEPS.findIndex((s) => s.key === step);
  const t = checks.data?.totals;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!lock.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl gap-5">
        <DialogHeader>
          <DialogTitle>Close {cycle.label}</DialogTitle>
          <DialogDescription>
            {fmtDate(cycle.start_date)} – {fmtDate(cycle.end_date)}. Locking freezes attendance and leave for this cycle and snapshots the pay-days report.
          </DialogDescription>
        </DialogHeader>

        <ol className="grid grid-cols-4 gap-2" aria-label="Close cycle steps">
          {STEPS.map((s, i) => (
            <li key={s.key} aria-current={i === idx ? "step" : undefined} className="grid gap-1.5">
              <span className={cn("h-1 rounded-full transition-colors duration-slow", i <= idx ? "bg-primary" : "bg-muted")} />
              <span className={cn("text-xs font-medium", i === idx ? "text-foreground" : "text-muted-foreground")}>
                <span className="tnum">{i + 1}.</span> {s.label}
              </span>
            </li>
          ))}
        </ol>

        <div className="max-h-[56vh] min-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} initial={reduce ? false : { opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -12 }} transition={{ duration: 0.22, ease: easeOut }}>
              {step === "checks" && (
                checks.isLoading ? (
                  <div className="grid gap-2" aria-busy="true">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
                ) : checks.isError ? <ErrorState error={checks.error} onRetry={() => checks.refetch()} /> : (
                  <div className="grid gap-3">
                    {checks.data?.ready ? (
                      <InlineAlert tone="success" icon={<CheckCircle2 className="size-4" />} title="All checks passed">
                        This cycle is ready to lock.
                      </InlineAlert>
                    ) : (
                      <InlineAlert tone="warning" title={`${pluralize(warnings.length, "check")} need${warnings.length === 1 ? "s" : ""} attention`}>
                        You can fix them first, or lock anyway after acknowledging them.
                      </InlineAlert>
                    )}
                    <ul className="grid gap-2">
                      {checks.data?.checks.map((c) => <CheckRow key={c.key} check={c} />)}
                    </ul>
                  </div>
                )
              )}

              {step === "preview" && t && (
                <div className="grid gap-4">
                  <p className="text-sm text-muted-foreground">These totals will be frozen when you lock. Review the full table on the page behind this dialog if needed.</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Total label="Employees" value={<CountUp value={t.employees} />} />
                    <Total label="Eligible days" value={fmtDays(t.eligible_days)} />
                    <Total label="Payable days" value={fmtDays(t.payable_days)} />
                    <Total label="Paid leave used" value={fmtDays(t.paid_leave_used)} />
                    <Total label="Comp-offs used" value={fmtDays(t.comp_off_used)} />
                    <Total label="LOP days" value={fmtDays(t.lop_days)} tone={num(t.lop_days) > 0 ? "lop" : undefined} />
                  </div>
                  <p className="text-xs text-muted-foreground">Accounts calculates salary amounts from these payable and LOP days.</p>
                </div>
              )}

              {step === "lock" && (
                <div className="grid gap-4">
                  <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Lock className="size-5" aria-hidden /></span>
                    <div className="text-sm">
                      <p className="font-medium">What happens when you lock</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                        <li>All open figures are recalculated one last time and snapshotted.</li>
                        <li>Attendance, leave and adjustments in this cycle become read-only.</li>
                        <li>Accounts can download the pay-days report.</li>
                        <li>You can unlock later, but a reason is required and audited.</li>
                      </ul>
                    </div>
                  </div>
                  {needsAck && (
                    <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
                      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-warning">
                        <AlertTriangle className="size-4" aria-hidden />Unresolved: {warnings.map((w) => `${w.label} (${w.count})`).join(", ")}
                      </p>
                      <div className="flex items-start gap-2.5">
                        <Checkbox id="ack-warnings" checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
                        <Label htmlFor="ack-warnings" className="cursor-pointer text-sm font-normal leading-snug">
                          I've reviewed these warnings and want to lock {cycle.label} anyway.
                        </Label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === "done" && (
                <EmptyState art="check" title={`${cycle.label} is locked`}
                  description={result ? <span className="tnum">{pluralize(result.employees, "employee")} · {fmtDays(result.totals.payable_days)} payable days · {fmtDays(result.totals.lop_days)} LOP</span> : undefined} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <DialogFooter className="sm:justify-between">
          {step === "checks" && (
            <>
              <Button variant="ghost" onClick={() => checks.refetch()} loading={checks.isFetching} disabled={checks.isLoading}><RefreshCw />Re-run checks</Button>
              <Button onClick={() => setStep("preview")} disabled={!checks.data}>Preview totals<ArrowRight /></Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="ghost" onClick={() => setStep("checks")}><ArrowLeft />Back</Button>
              <Button onClick={() => setStep("lock")}>Continue<ArrowRight /></Button>
            </>
          )}
          {step === "lock" && (
            <>
              <Button variant="ghost" onClick={() => setStep("preview")} disabled={lock.isPending}><ArrowLeft />Back</Button>
              <Button onClick={() => lock.mutate()} loading={lock.isPending} disabled={needsAck && !ack}><Lock />Lock {cycle.label}</Button>
            </>
          )}
          {step === "done" && <Button className="sm:ml-auto" onClick={() => onOpenChange(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckRow({ check }: { check: CloseCheck }) {
  const [open, setOpen] = React.useState(false);
  const ok = check.status === "ok";
  const id = `check-${check.key}`;
  const link = LINKS[check.key];
  return (
    <li className={cn("rounded-lg border bg-card", !ok && "border-warning/40")}>
      <button type="button" disabled={ok || !check.items.length} aria-expanded={!ok ? open : undefined} aria-controls={!ok ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", ok ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
          {ok ? <CheckCircle2 className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{check.label}</span>
          <span className="block text-xs text-muted-foreground">{ok ? "Looks good" : `${pluralize(check.count, "item")} to review`}</span>
        </span>
        {!ok && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning tnum">{check.count}</span>}
        {!ok && check.items.length > 0 && <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-base", open && "rotate-180")} aria-hidden />}
        <span className="sr-only">{ok ? "passed" : "warning"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && !ok && (
          <motion.div id={id} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: easeOut }} className="overflow-hidden">
            <div className="border-t px-3 pb-3 pt-2">
              <ul className="grid max-h-56 gap-1 overflow-y-auto scrollbar-thin">
                {check.items.map((it, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md px-2 py-1.5 text-sm odd:bg-muted/40">
                    {it.code && <span className="font-mono text-xs text-muted-foreground">{it.code}</span>}
                    {it.full_name && (it.employee_id ? (
                      <Link to={`/employees/${it.employee_id}`} className="font-medium hover:underline">{it.full_name}</Link>
                    ) : <span className="font-medium">{it.full_name}</span>)}
                    {it.issue && <span className="text-muted-foreground">{it.issue}</span>}
                    {check.key === "unmarked" && it.count !== undefined && (
                      <span className="w-full text-xs text-muted-foreground">
                        <span className="font-semibold text-warning tnum">{it.count} day{it.count === 1 ? "" : "s"}</span>
                        {it.dates?.length ? <> · <span className="tnum">{it.dates.slice(0, 10).map((d) => fmtDate(d, "d MMM")).join(", ")}{(it.dates.length > 10 || (it.count ?? 0) > it.dates.length) ? "…" : ""}</span></> : null}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {link && (
                <Link to={link.to} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  {link.label}<ExternalLink className="size-3" aria-hidden />
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function Total({ label, value, tone, plain }: { label: string; value: React.ReactNode; tone?: "lop"; plain?: boolean }) {
  return (
    <div className={cn(!plain && "rounded-lg border bg-card p-3", tone === "lop" && "border-status-lop/40 bg-status-lop/10")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tnum", tone === "lop" && "text-status-lop-fg")}>{value}</div>
    </div>
  );
}
