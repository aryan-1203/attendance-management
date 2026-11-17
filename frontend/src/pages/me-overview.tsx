import * as React from "react";
import { Link } from "react-router-dom";
import { differenceInCalendarDays, parseISO } from "date-fns";
import {
  ArrowRight, CalendarClock, CalendarDays, CheckCircle2, Contrast, FileSpreadsheet, FileText,
  BadgeMinus, Hourglass, Palmtree, Plus, Wallet, Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useCycle } from "@/lib/cycle";
import { download, errorMessage } from "@/lib/api";
import { cn, downloadBlob, fmtDate, fmtDays, num } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { ErrorState, InlineAlert, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { CycleRing } from "@/components/shared/rings";
import { CountUp, FadeIn } from "@/components/shared/motion";
import { useBalances, useLeaveRequests, useLedger, useRegularizations, useSummary } from "@/features/leave/api";
import { BalanceCards } from "@/features/leave/balance-cards";
import { LedgerTimeline } from "@/features/leave/ledger";
import { ApplyLeaveDialog } from "@/features/leave/apply-leave-dialog";
import { RegularizationDialog } from "@/features/me/regularization-dialog";
import { ListSkeleton, MyLeaveList, MyRegularizationList } from "@/features/me/my-requests";
import { NotLinked } from "@/features/me/not-linked";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function MeOverviewPage() {
  const { user } = useAuth();
  const empId = user?.employee_id ?? undefined;
  const firstName = (user?.employee?.full_name ?? user?.full_name ?? "").split(/\s+/)[0];
  const [applyOpen, setApplyOpen] = React.useState(false);
  const [regOpen, setRegOpen] = React.useState(false);

  if (!user) return null;
  if (!empId) {
    return (
      <>
        <PageHeader title={`${greeting()}${firstName ? `, ${firstName}` : ""}`} description="Your attendance and leave at a glance." />
        <NotLinked />
      </>
    );
  }
  return (
    <>
      <PageHeader eyebrow={fmtDate(new Date(), "EEEE, d MMMM")} title={`${greeting()}, ${firstName}`}
        description="Your attendance, leave and pay days at a glance."
        actions={<>
          <Button variant="outline" onClick={() => setRegOpen(true)}><Wrench />Request correction</Button>
          <Button onClick={() => setApplyOpen(true)}><Plus />Apply leave</Button>
        </>} />
      <Overview empId={empId} onApply={() => setApplyOpen(true)} onCorrect={() => setRegOpen(true)} />
      <ApplyLeaveDialog open={applyOpen} onOpenChange={setApplyOpen} />
      <RegularizationDialog open={regOpen} onOpenChange={setRegOpen} />
    </>
  );
}

function Overview({ empId, onApply, onCorrect }: { empId: number; onApply: () => void; onCorrect: () => void }) {
  const { current } = useCycle();
  const summary = useSummary(empId, current?.id);
  const balances = useBalances(empId);
  const ledger = useLedger(empId, 12);
  const leave = useLeaveRequests({ scope: "mine", status: "pending", page_size: 10 });
  const regs = useRegularizations({ scope: "mine", status: "pending", page_size: 10 });

  return (
    <div className="grid gap-5">
      <BalanceCards balances={balances.data ?? summary.data?.balance} onProbation={summary.data?.on_probation}
        loading={balances.isLoading && summary.isLoading} />

      <div className="grid gap-5 lg:grid-cols-5">
        <FadeIn className="lg:col-span-3" delay={0.05}>
          <CycleCard summary={summary} cycleLabel={current?.label} cycleStart={current?.start_date} cycleDays={current?.days} />
        </FadeIn>
        <FadeIn className="lg:col-span-2" delay={0.1}>
          <Card className="h-full">
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div className="grid gap-1">
                <CardTitle>Pending requests</CardTitle>
                <CardDescription>Waiting for your manager or HR.</CardDescription>
              </div>
              <Button asChild variant="link" size="sm" className="px-0"><Link to="/me/leave">All requests<ArrowRight /></Link></Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              {leave.isLoading || regs.isLoading ? <ListSkeleton rows={2} /> :
                leave.isError ? <ErrorState error={leave.error} onRetry={() => void leave.refetch()} /> :
                  (leave.data?.items.length ?? 0) + (regs.data?.items.length ?? 0) === 0 ? (
                    <EmptyState compact title="Nothing pending" description="All your requests have been decided."
                      action={<Button variant="soft" size="sm" onClick={onApply}><Plus />Apply leave</Button>} />
                  ) : (
                    <>
                      {!!leave.data?.items.length && <MyLeaveList items={leave.data.items} />}
                      {!!regs.data?.items.length && <MyRegularizationList items={regs.data.items} />}
                    </>
                  )}
            </CardContent>
          </Card>
        </FadeIn>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <FadeIn className="lg:col-span-3" delay={0.12}>
          <Card className="h-full">
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div className="grid gap-1">
                <CardTitle>Recent leave activity</CardTitle>
                <CardDescription>Your leave ledger — every accrual, deduction and adjustment.</CardDescription>
              </div>
              <Button asChild variant="link" size="sm" className="px-0"><Link to="/me/leave?tab=ledger">Full history<ArrowRight /></Link></Button>
            </CardHeader>
            <CardContent>
              {ledger.isError ? <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} /> :
                <LedgerTimeline entries={ledger.data} loading={ledger.isLoading} limit={8} />}
            </CardContent>
          </Card>
        </FadeIn>
        <FadeIn className="lg:col-span-2" delay={0.16}>
          <QuickActions onApply={onApply} onCorrect={onCorrect} />
        </FadeIn>
      </div>
    </div>
  );
}

function CycleCard({ summary, cycleLabel, cycleStart, cycleDays }: {
  summary: ReturnType<typeof useSummary>; cycleLabel?: string; cycleStart?: string; cycleDays?: number;
}) {
  const s = summary.data;
  const days = s?.cycle_days ?? cycleDays ?? 30;
  const day = cycleStart ? Math.min(days, Math.max(1, differenceInCalendarDays(new Date(), parseISO(cycleStart)) + 1)) : 1;
  const lop = num(s?.lop_days);
  const leaveUsed = num(s?.paid_leave_used) + num(s?.comp_off_used);
  const metrics = s ? [
    { label: "Present", value: s.present_days, icon: CheckCircle2, cls: "text-status-p-fg bg-status-p/10" },
    { label: "Half-days", value: s.half_days, icon: Contrast, cls: "text-status-hd-fg bg-status-hd/10" },
    { label: "Leave used", value: leaveUsed, icon: Palmtree, cls: "text-status-l-fg bg-status-l/10", decimals: true },
    { label: "LOP", value: lop, icon: BadgeMinus, cls: lop ? "text-destructive bg-destructive/10" : "text-muted-foreground bg-muted", decimals: true },
    { label: "Pending days", value: s.pending_days, icon: Hourglass, cls: "text-muted-foreground bg-muted" },
  ] : [];

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle>This salary cycle</CardTitle>
          <CardDescription className="tnum">{cycleLabel ?? "Current cycle"} · runs 20th → 19th</CardDescription>
        </div>
        {s?.on_probation && <Badge variant="warning">On probation</Badge>}
      </CardHeader>
      <CardContent>
        {summary.isError ? <ErrorState error={summary.error} onRetry={() => void summary.refetch()} /> : !s ? (
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <Skeleton className="size-[152px] rounded-full" />
            <div className="grid w-full flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-stretch">
              <div className="flex shrink-0 flex-col items-center gap-2">
                <CycleRing day={day} days={days} size={152} label={cycleLabel ?? ""} />
              </div>
              <div className="grid w-full flex-1 grid-cols-2 gap-2.5 sm:grid-cols-3">
                <div className="col-span-2 flex flex-col justify-center rounded-xl bg-gradient-to-br from-primary/10 to-accent/10 p-3 ring-1 ring-inset ring-primary/15 sm:col-span-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-primary"><Wallet className="size-3.5" aria-hidden />Projected payable</span>
                  <span className="mt-1 text-3xl font-semibold leading-none tracking-tight">
                    <CountUp value={num(s.projected_payable_days)} format={(n) => fmtDays(Math.round(n * 2) / 2)} />
                  </span>
                  <span className="mt-1 text-2xs text-muted-foreground tnum">of {s.eligible_days} eligible days</span>
                </div>
                {metrics.map((m) => {
                  const Icon = m.icon;
                  return (
                    <div key={m.label} className="rounded-xl border bg-surface p-3">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn("flex size-5 items-center justify-center rounded-md", m.cls)}><Icon className="size-3" aria-hidden /></span>
                        {m.label}
                      </span>
                      <span className="mt-1 block text-xl font-semibold tracking-tight">
                        <CountUp value={Number(m.value)} format={m.decimals ? (n) => fmtDays(Math.round(n * 2) / 2) : undefined} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            {lop > 0 ? (
              <InlineAlert tone="destructive" title={`${fmtDays(lop)} day${lop === 1 ? "" : "s"} of loss of pay so far`}>
                Absences beyond your usable balance (and comp-off, if chosen) are deducted as LOP. Sundays and holidays stay paid.
              </InlineAlert>
            ) : s.pending_days > 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock className="size-3.5" aria-hidden />
                <span className="tnum">{s.pending_days}</span> day{s.pending_days === 1 ? "" : "s"} still to come this cycle — projected
                payable days assume they're worked.
              </p>
            ) : null}
            {s.remarks.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Remarks">
                {s.remarks.map((r) => <li key={r}><Badge variant="secondary">{r}</Badge></li>)}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActions({ onApply, onCorrect }: { onApply: () => void; onCorrect: () => void }) {
  const { current } = useCycle();
  const [busy, setBusy] = React.useState<string | null>(null);
  const get = async (fmt: "pdf" | "xlsx") => {
    setBusy(fmt);
    try {
      const { blob, filename } = await download("/api/reports/statement", { fmt, cycle_id: current?.id });
      downloadBlob(blob, filename);
      toast.success("Statement downloaded", { description: current?.label });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const tile = "group flex min-h-[64px] w-full cursor-pointer items-center gap-3 rounded-xl border bg-surface p-3 text-left text-sm " +
    "shadow-e1 transition-[background-color,box-shadow,transform] duration-base hover:bg-muted/50 hover:shadow-e2 active:scale-[.98] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
  const icon = "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4";
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
        <CardDescription>Statement for {current?.label ?? "the current cycle"}.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <button type="button" className={tile} onClick={onApply}>
          <span className={cn(icon, "bg-status-l/10 text-status-l-fg")}><Palmtree /></span>
          <span><span className="block font-medium">Apply leave</span><span className="text-xs text-muted-foreground">See paid vs LOP first</span></span>
        </button>
        <button type="button" className={tile} onClick={onCorrect}>
          <span className={cn(icon, "bg-primary/10 text-primary")}><Wrench /></span>
          <span><span className="block font-medium">Request correction</span><span className="text-xs text-muted-foreground">Fix a wrongly marked day</span></span>
        </button>
        <button type="button" className={tile} onClick={() => void get("pdf")} disabled={!!busy} aria-busy={busy === "pdf"}>
          <span className={cn(icon, "bg-destructive/10 text-destructive")}><FileText /></span>
          <span><span className="block font-medium">{busy === "pdf" ? "Preparing…" : "Statement (PDF)"}</span><span className="text-xs text-muted-foreground">Monthly attendance & pay days</span></span>
        </button>
        <button type="button" className={tile} onClick={() => void get("xlsx")} disabled={!!busy} aria-busy={busy === "xlsx"}>
          <span className={cn(icon, "bg-success/10 text-success")}><FileSpreadsheet /></span>
          <span><span className="block font-medium">{busy === "xlsx" ? "Preparing…" : "Statement (Excel)"}</span><span className="text-xs text-muted-foreground">Day-by-day breakdown</span></span>
        </button>
        <Link to="/me/attendance" className={cn(tile, "sm:col-span-2 lg:col-span-1 xl:col-span-2")}>
          <span className={cn(icon, "bg-status-p/10 text-status-p-fg")}><CalendarDays /></span>
          <span className="flex-1"><span className="block font-medium">My attendance calendar</span><span className="text-xs text-muted-foreground">Every day of this cycle, plus your year</span></span>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

