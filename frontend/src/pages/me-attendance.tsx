import * as React from "react";
import { BadgeMinus, CheckCircle2, ChevronLeft, ChevronRight, Contrast, Lock, Palmtree, Wallet, Wrench } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useCycle } from "@/lib/cycle";
import { fmtDate, fmtDays, num } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { Pager } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { AttendanceHeatmap, HeatmapLegend } from "@/components/shared/heatmap";
import { ErrorState, PageHeader, StatTile } from "@/components/shared/page";
import { StatusLegend } from "@/components/shared/status-badge";
import { FadeIn } from "@/components/shared/motion";
import { useProfile, useRegularizations, useSummary } from "@/features/leave/api";
import { CycleCalendar } from "@/features/me/cycle-calendar";
import { ListSkeleton, MyRegularizationList } from "@/features/me/my-requests";
import { NotLinked } from "@/features/me/not-linked";
import { RegularizationDialog } from "@/features/me/regularization-dialog";
import { StatementMenu } from "@/features/me/statement-menu";

const LEGEND = ["P", "WFH", "OD", "HD", "L", "CO", "A", "WO", "H"];

export default function MeAttendancePage() {
  const { user } = useAuth();
  const empId = user?.employee_id ?? undefined;
  const { cycle, cycles, setCycleId } = useCycle();
  const [reg, setReg] = React.useState<{ open: boolean; date?: string; status?: string | null }>({ open: false });

  const sorted = React.useMemo(() => [...cycles].sort((a, b) => a.start_date.localeCompare(b.start_date)), [cycles]);
  const idx = cycle ? sorted.findIndex((c) => c.id === cycle.id) : -1;
  const prev = idx > 0 ? sorted[idx - 1] : undefined;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : undefined;

  if (!user) return null;
  return (
    <>
      <PageHeader title="My attendance"
        description={cycle ? `Cycle ${cycle.label} · ${fmtDate(cycle.start_date, "d MMM")} → ${fmtDate(cycle.end_date, "d MMM yyyy")}` : "Your days, cycle by cycle."}
        actions={empId ? <>
          <StatementMenu cycle={cycle} />
          <Button onClick={() => setReg({ open: true })}><Wrench />Request correction</Button>
        </> : undefined} />
      {!empId ? <NotLinked /> : (
        <Body empId={empId} onCorrect={(date, status) => setReg({ open: true, date, status })}
          prev={prev ? () => setCycleId(prev.id) : undefined} next={next ? () => setCycleId(next.id) : undefined} />
      )}
      <RegularizationDialog open={reg.open} onOpenChange={(o) => setReg((r) => ({ ...r, open: o }))} date={reg.date}
        currentStatus={reg.status} />
    </>
  );
}

function Body({ empId, onCorrect, prev, next }: {
  empId: number; onCorrect: (date: string, status: string | null) => void; prev?: () => void; next?: () => void;
}) {
  const { cycle } = useCycle();
  const summary = useSummary(empId, cycle?.id);
  const profile = useProfile(empId);
  const [page, setPage] = React.useState(1);
  const regs = useRegularizations({ scope: "mine", page, page_size: 8 });
  const s = summary.data;

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Cycle summary">
        {!s ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />) : <>
          <StatTile label="Present" value={s.present_days} icon={<CheckCircle2 />} tone="success" sub={`of ${s.eligible_days} eligible days`} />
          <StatTile label="Half-days" value={s.half_days} icon={<Contrast />} tone="warning" sub="0.5 day each" />
          <StatTile label="Leave used" value={fmtDays(num(s.paid_leave_used) + num(s.comp_off_used))} icon={<Palmtree />} tone="primary"
            sub={num(s.comp_off_used) ? `${fmtDays(s.comp_off_used)} from comp-off` : "from usable balance"} />
          <StatTile label="Loss of pay" value={<span className={num(s.lop_days) ? "text-destructive" : ""}>{fmtDays(s.lop_days)}</span>}
            icon={<BadgeMinus />} tone={num(s.lop_days) ? "destructive" : "muted"} sub="days deducted" />
          <StatTile label="Payable days" value={fmtDays(s.projected_payable_days)} icon={<Wallet />} tone="primary"
            className="col-span-2 sm:col-span-1" sub={s.pending_days ? `projected · ${s.pending_days} days to go` : "final for this cycle"} />
        </>}
      </div>

      <FadeIn delay={0.05}>
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle className="flex items-center gap-2">
                {cycle?.label ?? "Cycle"}
                {cycle?.status === "locked" && <Badge variant="secondary"><Lock className="size-3" aria-hidden />Locked</Badge>}
              </CardTitle>
              <CardDescription>Tap a day for details. Use arrow keys to move between days.</CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" onClick={prev} disabled={!prev} aria-label="Previous cycle"><ChevronLeft /></Button>
              <Button variant="outline" size="icon-sm" onClick={next} disabled={!next} aria-label="Next cycle"><ChevronRight /></Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            {summary.isError ? <ErrorState error={summary.error} onRetry={() => void summary.refetch()} /> :
              !s || !cycle ? (
                <div className="grid grid-cols-7 gap-1.5" aria-busy="true">
                  {Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} className="h-[58px] rounded-lg sm:h-[76px]" />)}
                </div>
              ) : <CycleCalendar cycle={cycle} days={s.days} onRequestCorrection={onCorrect} />}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <StatusLegend codes={LEGEND} />
              <ul className="flex items-center gap-3 text-xs text-muted-foreground">
                <li className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-status-l" aria-hidden />Paid leave</li>
                <li className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-destructive" aria-hidden />LOP</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </FadeIn>

      <div className="grid gap-5 lg:grid-cols-5">
        <FadeIn className="min-w-0 lg:col-span-3" delay={0.1}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Your year</CardTitle>
              <CardDescription>Last 12 months of attendance.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {profile.isError ? <ErrorState error={profile.error} onRetry={() => void profile.refetch()} /> :
                !profile.data ? <Skeleton className="h-[128px] w-full rounded-lg" /> : (
                  <>
                    <AttendanceHeatmap days={profile.data.heatmap} />
                    <HeatmapLegend />
                  </>
                )}
            </CardContent>
          </Card>
        </FadeIn>
        <FadeIn className="min-w-0 lg:col-span-2" delay={0.14}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>My corrections</CardTitle>
              <CardDescription>Requests to fix a day’s attendance.</CardDescription>
            </CardHeader>
            <CardContent>
              {regs.isLoading ? <ListSkeleton /> : regs.isError ? <ErrorState error={regs.error} onRetry={() => void regs.refetch()} /> :
                !regs.data?.items.length ? (
                  <EmptyState compact title="No corrections requested"
                    description="If a day looks wrong, tap it on the calendar and choose Request correction." />
                ) : (
                  <>
                    <MyRegularizationList items={regs.data.items} />
                    {regs.data.pages > 1 && <Pager page={page} pages={regs.data.pages} total={regs.data.total} onPage={setPage} />}
                  </>
                )}
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
