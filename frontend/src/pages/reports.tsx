import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarDays, formatDistanceToNowStrict, parseISO } from "date-fns";
import { motion, useReducedMotion } from "framer-motion";
import {
  CalendarClock, CheckCircle2, ClipboardCheck, FileSpreadsheet, FileText, History, Lock, LockOpen, Mail, RefreshCw,
  Users, Wallet, BadgeMinus, CalendarCheck2,
} from "lucide-react";
import { toast } from "sonner";
import { client, unwrap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCycle } from "@/lib/cycle";
import type { Cycle } from "@/lib/types";
import { cn, fmtDate, fmtDays, num, pluralize } from "@/lib/utils";
import { qk } from "@/hooks/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, Skeleton } from "@/components/ui/misc";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState, InlineAlert, PageHeader } from "@/components/shared/page";
import { CountUp, stagger } from "@/components/shared/motion";
import { PayDaysTable } from "@/features/reports/pay-days-table";
import { CloseCycleWizard } from "@/features/reports/close-wizard";
import { ReportDownloads } from "@/features/reports/downloads";
import { EmailAccountsDialog, UnlockCycleDialog } from "@/features/reports/cycle-actions";
import { reportKeys, type PayDaysResponse } from "@/features/reports/types";

interface UserLite { id: number; full_name: string; email: string }

export default function ReportsPage() {
  const { can } = useAuth();
  const isHR = can("hr_admin");
  const { cycle, cycles, setCycleId, isLoading: cyclesLoading } = useCycle();
  const qc = useQueryClient();
  const [dialog, setDialog] = React.useState<"close" | "unlock" | "email" | null>(null);

  const locked = cycle?.status === "locked";
  const accessible = !!cycle && (isHR || locked);

  const payDays = useQuery({
    queryKey: reportKeys.payDays(cycle?.id), enabled: accessible,
    queryFn: async () => (await unwrap(client.GET("/api/reports/pay-days", { params: { query: { cycle_id: cycle!.id } } }))) as unknown as PayDaysResponse,
  });
  const runs = useQuery({
    queryKey: reportKeys.runs(cycle?.id), enabled: accessible,
    queryFn: () => unwrap(client.GET("/api/reports/runs", { params: { query: { cycle_id: cycle!.id } } })),
  });
  const users = useQuery({
    queryKey: ["users"], enabled: isHR, staleTime: 5 * 60_000,
    queryFn: async () => (await unwrap(client.GET("/api/users"))) as unknown as UserLite[],
  });
  const userName = (id: number | null | undefined) => (id ? users.data?.find((u) => u.id === id)?.full_name : undefined);

  const recalc = useMutation({
    mutationFn: async () => (await unwrap(client.POST("/api/cycles/{cycle_id}/recalculate", {
      params: { path: { cycle_id: cycle!.id } } }))) as unknown as { cycles: unknown[] },
    onSuccess: (r) => {
      toast.success("Recalculated", { description: `${pluralize(r.cycles?.length ?? 0, "open cycle")} refreshed from ${cycle!.label}.` });
      qc.invalidateQueries({ queryKey: ["pay-days"] });
      qc.invalidateQueries({ queryKey: ["close-checks"] });
      qc.invalidateQueries({ queryKey: ["grid"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });

  const lockedCycles = cycles.filter((c) => c.status === "locked");

  return (
    <div className="grid gap-6">
      <PageHeader className="mb-0" title="Cycle close & reports" eyebrow={cycle?.label}
        description={isHR ? "Check, lock and hand the pay-days report to Accounts." : "Download pay-days and registers for locked cycles."}
        actions={isHR && cycle && (
          <>
            {!locked && (
              <Button variant="outline" onClick={() => recalc.mutate()} loading={recalc.isPending}><RefreshCw />Recalculate</Button>
            )}
            <Button variant="outline" onClick={() => setDialog("email")}><Mail />Email to Accounts</Button>
          </>
        )} />

      {cyclesLoading || !cycle ? (
        cyclesLoading ? <Skeleton className="h-48 rounded-2xl" /> :
          <EmptyState art="calendar" title="No salary cycles yet" description="Cycles appear once the go-live date is reached." />
      ) : !accessible ? (
        <AccountsNotice cycle={cycle} lockedCycles={lockedCycles} onPick={setCycleId} />
      ) : (
        <>
          <CycleHero cycle={cycle} payDays={payDays.data} lockedByName={userName(cycle.locked_by_id)} isHR={isHR}
            onClose={() => setDialog("close")} onUnlock={() => setDialog("unlock")} />

          <Card>
            <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Salary pay-days report</CardTitle>
                <CardDescription>
                  {locked ? "Frozen snapshot taken at lock." : "Live figures — they change as attendance and leave change until the cycle is locked."}
                </CardDescription>
              </div>
              <Badge variant={locked ? "success" : "warning"}>{locked ? <><Lock className="size-3" />Final</> : "Provisional"}</Badge>
            </CardHeader>
            <CardContent>
              {payDays.isError ? <ErrorState error={payDays.error} onRetry={() => payDays.refetch()} /> :
                <PayDaysTable rows={payDays.data?.rows ?? []} totals={payDays.data?.totals} loading={payDays.isLoading} />}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3"><ReportDownloads cycleId={cycle.id} /></div>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><History className="size-4 text-muted-foreground" aria-hidden />Recent report runs</CardTitle>
                <CardDescription>Every generated file and email for {cycle.label}.</CardDescription>
              </CardHeader>
              <CardContent>
                {runs.isLoading ? <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> :
                  runs.isError ? <ErrorState error={runs.error} onRetry={() => runs.refetch()} /> :
                    !runs.data?.length ? <EmptyState art="chart" compact title="No reports generated yet" description="Downloads and emails will be listed here." /> : (
                      <ul className="grid max-h-[420px] gap-1 overflow-y-auto pr-1 scrollbar-thin">
                        {runs.data.map((r) => (
                          <li key={r.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                              r.fmt === "pdf" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")} aria-hidden>
                              {r.fmt === "pdf" ? <FileText className="size-4" /> : <FileSpreadsheet className="size-4" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium capitalize">{r.report_type.replace(/_/g, " ")}
                                <span className="ml-1.5 text-2xs font-semibold uppercase text-muted-foreground">{r.fmt}</span></p>
                              <p className="text-xs text-muted-foreground">
                                <time dateTime={r.created_at} title={fmtDate(r.created_at, "d MMM yyyy, HH:mm")}>
                                  {formatDistanceToNowStrict(parseISO(r.created_at), { addSuffix: true })}
                                </time>
                                {userName(r.generated_by_id) && <> · {userName(r.generated_by_id)}</>}
                              </p>
                              {r.emailed_to && (
                                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-primary"><Mail className="size-3 shrink-0" aria-hidden />Emailed to {r.emailed_to}</p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
              </CardContent>
            </Card>
          </div>

          {isHR && (
            <>
              <CloseCycleWizard cycle={cycle} open={dialog === "close"} onOpenChange={(v) => setDialog(v ? "close" : null)} />
              <UnlockCycleDialog cycle={cycle} open={dialog === "unlock"} onOpenChange={(v) => setDialog(v ? "unlock" : null)} />
            </>
          )}
        </>
      )}
      {isHR && cycle && <EmailAccountsDialog cycle={cycle} open={dialog === "email"} onOpenChange={(v) => setDialog(v ? "email" : null)} />}
    </div>
  );
}

function AccountsNotice({ cycle, lockedCycles, onPick }: { cycle: Cycle; lockedCycles: Cycle[]; onPick: (id: number) => void }) {
  return (
    <Card>
      <EmptyState art="calendar" title={`${cycle.label} is still open`}
        description="HR is still finalising attendance for this cycle. Reports become available here as soon as it's locked."
        action={lockedCycles.length > 0 && (
          <div className="grid gap-2">
            <p className="text-xs font-medium text-muted-foreground">Locked cycles you can open</p>
            <div className="flex flex-wrap justify-center gap-2">
              {lockedCycles.slice(0, 6).map((c) => (
                <Button key={c.id} variant="outline" size="sm" onClick={() => onPick(c.id)}><Lock />{c.label}</Button>
              ))}
            </div>
          </div>
        )} />
    </Card>
  );
}

function CycleHero({ cycle, payDays, lockedByName, isHR, onClose, onUnlock }: {
  cycle: Cycle; payDays?: PayDaysResponse; lockedByName?: string; isHR: boolean; onClose: () => void; onUnlock: () => void;
}) {
  const reduce = useReducedMotion();
  const today = new Date();
  const start = parseISO(cycle.start_date);
  const end = parseISO(cycle.end_date);
  const locked = cycle.status === "locked";
  const elapsed = Math.min(cycle.days, Math.max(0, differenceInCalendarDays(today, start) + 1));
  const ended = differenceInCalendarDays(today, end) > 0;
  const due = cycle.report_due_date ? parseISO(cycle.report_due_date) : null;
  const dueIn = due ? differenceInCalendarDays(due, today) : null;
  const t = payDays?.totals;

  let dueText = "No due date";
  let dueTone: "muted" | "warning" | "destructive" | "success" = "muted";
  if (due && dueIn !== null) {
    if (locked) { dueText = `Due ${fmtDate(due)}`; dueTone = "success"; }
    else if (dueIn > 1) { dueText = `${dueIn} days left · due ${fmtDate(due, "d MMM")}`; dueTone = dueIn <= 3 ? "warning" : "muted"; }
    else if (dueIn === 1) { dueText = `Due tomorrow · ${fmtDate(due, "d MMM")}`; dueTone = "warning"; }
    else if (dueIn === 0) { dueText = "Due today"; dueTone = "warning"; }
    else { dueText = `Overdue by ${pluralize(-dueIn, "day")}`; dueTone = "destructive"; }
  }
  const toneCls = { muted: "text-muted-foreground", warning: "text-warning", destructive: "text-destructive", success: "text-success" }[dueTone];

  return (
    <motion.section aria-labelledby="cycle-hero-title" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border bg-card shadow-e2">
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 opacity-60",
        locked ? "bg-gradient-to-br from-success/10 via-transparent to-transparent" : "bg-gradient-to-br from-primary/10 via-transparent to-accent/5")} />
      <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid content-start gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn("flex size-12 items-center justify-center rounded-2xl shadow-e1",
              locked ? "bg-success text-success-foreground" : "bg-primary/10 text-primary")} aria-hidden>
              {locked ? <Lock className="size-6" /> : <LockOpen className="size-6" />}
            </span>
            <div className="min-w-0">
              <h2 id="cycle-hero-title" className="text-xl font-semibold tracking-tight sm:text-2xl">{cycle.label}</h2>
              <p className="text-sm text-muted-foreground tnum">{fmtDate(start)} – {fmtDate(end)} · {cycle.days} days</p>
            </div>
            <Badge variant={locked ? "success" : "warning"} className="ml-auto text-xs">
              {locked ? <><Lock className="size-3" aria-hidden />Locked</> : <><LockOpen className="size-3" aria-hidden />Open</>}
            </Badge>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl border bg-surface/60 p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="size-3.5" aria-hidden />Report due</dt>
              <dd className={cn("mt-1 font-medium tnum", toneCls)}>{dueText}</dd>
            </div>
            <div className="rounded-xl border bg-surface/60 p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {locked ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CalendarCheck2 className="size-3.5" aria-hidden />}
                {locked ? "Locked" : ended ? "Cycle period" : "Progress"}
              </dt>
              <dd className="mt-1 font-medium tnum">
                {locked ? (
                  <>{cycle.locked_at ? fmtDate(cycle.locked_at, "d MMM yyyy, HH:mm") : "—"}{lockedByName && <span className="font-normal text-muted-foreground"> by {lockedByName}</span>}</>
                ) : ended ? `Ended ${pluralize(differenceInCalendarDays(today, end), "day")} ago` : (
                  <span className="grid gap-1.5">
                    <span>Day {elapsed} of {cycle.days}</span>
                    <Progress value={(elapsed / cycle.days) * 100} className="h-1.5" label={`Day ${elapsed} of ${cycle.days}`} />
                  </span>
                )}
              </dd>
            </div>
          </dl>

          {!locked && cycle.unlock_reason && (
            <InlineAlert tone="info" title="Re-opened">Unlocked previously: “{cycle.unlock_reason}”</InlineAlert>
          )}

          {isHR && (
            <div className="flex flex-wrap gap-2">
              {locked ? (
                <Button variant="outline" onClick={onUnlock}><LockOpen />Unlock cycle</Button>
              ) : (
                <Button onClick={onClose} size="lg"><ClipboardCheck />Close cycle</Button>
              )}
            </div>
          )}
        </div>

        <motion.dl className="grid grid-cols-2 gap-3 self-start" variants={stagger.container} initial={reduce ? false : "hidden"} animate="show">
          <Kpi icon={<Users />} label="Employees" value={t ? <CountUp value={t.employees} /> : undefined} />
          <Kpi icon={<CalendarCheck2 />} label="Payable days" value={t ? <CountUp value={num(t.payable_days)} format={(n) => fmtDays(Math.round(n * 2) / 2)} /> : undefined} />
          <Kpi icon={<BadgeMinus />} label="LOP days" tone={t && num(t.lop_days) > 0 ? "lop" : undefined}
            value={t ? <CountUp value={num(t.lop_days)} format={(n) => fmtDays(Math.round(n * 2) / 2)} /> : undefined} />
          <Kpi icon={<Wallet />} label="Eligible days" value={t ? <CountUp value={num(t.eligible_days)} format={(n) => fmtDays(Math.round(n * 2) / 2)} /> : undefined}
            sub="Salary amounts are calculated by Accounts" />
        </motion.dl>
      </div>
    </motion.section>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value?: React.ReactNode; sub?: string; tone?: "lop" }) {
  return (
    <motion.div variants={stagger.item} className={cn("glass rounded-xl border p-3", tone === "lop" && "border-status-lop/40")}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5"><span aria-hidden>{icon}</span>{label}</dt>
      <dd className={cn("mt-1.5 text-xl font-semibold tracking-tight tnum sm:text-2xl", tone === "lop" && "text-status-lop-fg")}>
        {value ?? <Skeleton className="h-7 w-20" />}
      </dd>
      {sub && <dd className="text-xs text-muted-foreground tnum">{sub}</dd>}
    </motion.div>
  );
}
