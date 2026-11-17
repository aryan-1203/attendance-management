import * as React from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { parseISO } from "date-fns";
import {
  ArrowLeft, ArrowRight, Banknote, CalendarCheck2, CalendarClock, CalendarX2, CheckCircle2, Hourglass,
  Lock, LogOut, Mail, MoreHorizontal, Pencil, Phone, Sparkles, Trash2, UserCheck, Cake, Users, Coffee,
} from "lucide-react";
import { ApiError, client, unwrap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Employee } from "@/lib/types";
import { cn, fmtDate, fmtDays, num } from "@/lib/utils";
import { statusMeta } from "@/lib/status";
import { qk } from "@/hooks/queries";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton, Tooltip } from "@/components/ui/misc";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState, InlineAlert, PageHeader } from "@/components/shared/page";
import { CountUp, stagger } from "@/components/shared/motion";
import { Ring } from "@/components/shared/rings";
import { AttendanceHeatmap, HeatmapLegend } from "@/components/shared/heatmap";
import {
  EmployeeAvatar, EmployeeStatusBadge, EmploymentTypeBadge, type Profile, weeklyOffLabel,
} from "@/features/employees/shared";
import { EmployeeFormSheet } from "@/features/employees/employee-form";
import { LedgerTimeline } from "@/features/employees/ledger-timeline";
import { CompOffLots } from "@/features/employees/comp-off-lots";
import { ConfirmProbationDialog, DeleteEmployeeDialog, RecordExitDialog } from "@/features/employees/profile-actions";

type Dialogs = "edit" | "confirm" | "exit" | "delete" | null;

export default function EmployeeProfilePage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const loc = useLocation();
  const { can } = useAuth();
  const isHR = can("hr_admin");
  const reduce = useReducedMotion();
  const seed = (loc.state as { employee?: Employee } | null)?.employee;

  const profile = useQuery({
    queryKey: qk.profile(id), enabled: Number.isFinite(id),
    queryFn: async () => (await unwrap(client.GET("/api/employees/{emp_id}/profile", { params: { path: { emp_id: id } } }))) as unknown as Profile,
  });
  const ledger = useQuery({
    queryKey: ["ledger", id], enabled: Number.isFinite(id),
    queryFn: () => unwrap(client.GET("/api/employees/{emp_id}/ledger", { params: { path: { emp_id: id }, query: { limit: 2000 } } })),
  });
  const compOffs = useQuery({
    queryKey: ["comp-offs", id], enabled: Number.isFinite(id),
    queryFn: () => unwrap(client.GET("/api/employees/{emp_id}/comp-offs", { params: { path: { emp_id: id } } })),
  });

  const [dialog, setDialog] = React.useState<Dialogs>(null);
  const emp = profile.data?.employee ?? (seed?.id === id ? seed : undefined);
  const today = React.useMemo(() => new Date(), []);

  React.useEffect(() => { if (emp) document.title = `${emp.full_name} · ProsParity`; }, [emp]);

  if (profile.isError && !emp) {
    const nf = profile.error instanceof ApiError && (profile.error.status === 404 || profile.error.status === 403);
    return (
      <div>
        <BackLink show={can("hr_admin", "manager", "accounts")} />
        {nf ? (
          <EmptyState art="search" title={profile.error instanceof ApiError && profile.error.status === 403 ? "You can't view this profile" : "Employee not found"}
            description="They may have been removed, or the link is out of date."
            action={<Link to="/employees" className={buttonVariants({ variant: "outline", size: "sm" })}>Back to employees</Link>} />
        ) : <ErrorState error={profile.error} onRetry={() => profile.refetch()} />}
      </div>
    );
  }

  const data = profile.data;
  const s = data?.summary;
  const onProbation = emp && emp.employment_type === "probation" && !emp.confirmation_date;

  return (
    <div className="grid gap-6">
      <div>
        <BackLink show={can("hr_admin", "manager", "accounts")} />
        {emp ? (
          <PageHeader className="mb-0 sm:items-center"
            title={
              <span className="flex items-center gap-4">
                <span aria-hidden><EmployeeAvatar employee={emp} size={76} className="shadow-e2 ring-4 ring-background" /></span>
                <span className="min-w-0">
                  <span className="block truncate">{emp.full_name}</span>
                </span>
              </span>
            }
            description={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:pl-[92px]">
                <span className="font-mono text-xs text-foreground tnum">{emp.code}</span>
                {(emp.designation || emp.department) && <span aria-hidden>·</span>}
                <span>{[emp.designation?.name, emp.department?.name].filter(Boolean).join(" · ")}</span>
                <EmploymentTypeBadge type={emp.employment_type} />
                <EmployeeStatusBadge status={emp.status} />
                {onProbation && emp.probation_end_date && emp.probation_end_date < fmtDate(today, "yyyy-MM-dd") && (
                  <span className="inline-flex items-center gap-1 text-2xs font-medium text-warning"><Hourglass className="size-3" aria-hidden />Probation ended — confirm</span>
                )}
              </span>
            }
            actions={isHR && (
              <>
                <Button variant="outline" onClick={() => setDialog("edit")} disabled={!data}><Pencil />Edit</Button>
                {onProbation && !emp.exit_date && (
                  <Button variant="soft" onClick={() => setDialog("confirm")} disabled={!data}><UserCheck />Confirm probation</Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="More actions" disabled={!data}><MoreHorizontal /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!emp.exit_date && <DropdownMenuItem onSelect={() => setDialog("exit")}><LogOut />Record exit</DropdownMenuItem>}
                    {emp.exit_date && (
                      <DropdownMenuItem asChild>
                        <Link to={`/leave?tab=encashment&employee=${emp.id}`}><Banknote />Leave encashment</Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setDialog("delete")}><Trash2 className="!text-destructive" />Delete employee</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )} />
        ) : (
          <div className="flex items-center gap-4" aria-busy="true" aria-label="Loading profile">
            <Skeleton className="size-[76px] rounded-full" />
            <div className="grid gap-2"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-72" /></div>
          </div>
        )}
      </div>

      {emp?.exit_date && isHR && (
        <InlineAlert tone="info" icon={<Banknote className="size-4" />} title={`Exited on ${fmtDate(emp.exit_date)}`}>
          <span>{emp.exit_reason ? `${emp.exit_reason}. ` : ""}Settle any remaining leave via encashment before the cycle is locked. </span>
          <Link to={`/leave?tab=encashment&employee=${emp.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            Preview encashment<ArrowRight className="size-3.5" />
          </Link>
        </InlineAlert>
      )}

      {/* Facts */}
      {emp && (
        <Card>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 p-5 sm:grid-cols-3 lg:grid-cols-5">
            <Fact icon={<CalendarCheck2 />} label="Joined" value={fmtDate(emp.date_of_joining)} />
            <Fact icon={<Hourglass />} label="Probation ends" value={fmtDate(emp.probation_end_date)} />
            <Fact icon={<UserCheck />} label="Confirmed" value={emp.confirmation_date ? fmtDate(emp.confirmation_date) : onProbation ? "On probation" : "—"} />
            <Fact icon={<CalendarX2 />} label="Exit" value={fmtDate(emp.exit_date)} />
            <Fact icon={<Users />} label="Manager" value={data?.manager ? (
              can("hr_admin", "accounts") ? <Link className="text-primary hover:underline" to={`/employees/${data.manager.id}`}>{data.manager.full_name}</Link>
                : data.manager.full_name
            ) : data ? "—" : <Skeleton className="h-4 w-24" />} />
            <Fact icon={<Coffee />} label="Weekly off" value={weeklyOffLabel(emp.weekly_off)} />
            <Fact icon={<Mail />} label="Email" value={emp.email ? <a className="break-all hover:underline" href={`mailto:${emp.email}`}>{emp.email}</a> : "—"} />
            <Fact icon={<Phone />} label="Phone" value={emp.phone ? <a className="hover:underline" href={`tel:${emp.phone}`}>{emp.phone}</a> : "—"} />
            <Fact icon={<Cake />} label="Date of birth" value={fmtDate(emp.date_of_birth)} />
          </dl>
        </Card>
      )}

      {/* Balances */}
      <section aria-labelledby="bal-h">
        <h2 id="bal-h" className="sr-only">Leave balances</h2>
        {data ? (
          <motion.div className="grid gap-3 sm:grid-cols-3" variants={stagger.container} initial={reduce ? false : "hidden"} animate="show">
            <BalanceCard label="Usable leave" value={data.balances.usable} icon={<CheckCircle2 />} tone="success"
              sub="Available to apply now" />
            <BalanceCard label="Locked (probation)" value={data.balances.locked} icon={<Lock />} tone="warning"
              sub={num(data.balances.locked) > 0 ? "Released on confirmation" : "Nothing locked"} />
            <BalanceCard label="Comp-off" value={data.balances.comp_off} icon={<Sparkles />} tone="co"
              sub={`${(compOffs.data ?? []).filter((l) => l.status === "available" || l.status === "partial").length} open lot(s)`} />
          </motion.div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[112px] rounded-xl" />)}</div>
        )}
      </section>

      {/* Current cycle */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>This cycle</CardTitle>
            <CardDescription>{data ? data.current_cycle.label : <Skeleton className="mt-1 h-4 w-40" />}</CardDescription>
          </div>
          {s && s.on_probation && <span className="inline-flex items-center gap-1 text-xs font-medium text-warning"><Hourglass className="size-3.5" aria-hidden />On probation</span>}
        </CardHeader>
        <CardContent>
          {!s ? <Skeleton className="h-40 w-full rounded-lg" /> : (
            <div className="grid gap-5">
              <div className="flex flex-col gap-5 md:flex-row md:items-center">
                <Ring value={num(s.payable_days)} max={Math.max(1, num(s.cycle_days))} size={132} stroke={11}
                  label={`${fmtDays(s.payable_days)} payable of ${fmtDays(s.cycle_days)} cycle days`} className="mx-auto shrink-0 md:mx-0">
                  <div className="text-center">
                    <div className="text-3xl font-semibold leading-none tnum"><CountUp value={num(s.payable_days)} format={(n) => fmtDays(Math.round(n * 2) / 2)} /></div>
                    <div className="mt-1 text-2xs text-muted-foreground tnum">payable / {fmtDays(s.cycle_days)}</div>
                  </div>
                </Ring>
                <dl className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat code="P" label="Present" value={s.present_days} />
                  <Stat code="HD" label="Half-days" value={s.half_days} />
                  <Stat code="L" label="Paid leave" value={s.paid_leave_used} />
                  <Stat code="CO" label="Comp-off used" value={s.comp_off_used} />
                  <Stat code="LOP" label="LOP days" value={s.lop_days} highlight={num(s.lop_days) > 0} />
                  <Stat icon={<CalendarClock className="size-3.5" />} label="Payable days" value={s.payable_days} strong />
                </dl>
              </div>
              {(s.warnings.length > 0 || num(s.unmarked_days) > 0 || num(s.pending_days) > 0) && (
                <InlineAlert tone="warning" title="Heads-up for this cycle">
                  <ul className="list-disc pl-4">
                    {num(s.unmarked_days) > 0 && <li className="tnum">{fmtDays(s.unmarked_days)} working day(s) not marked yet</li>}
                    {num(s.pending_days) > 0 && <li className="tnum">{fmtDays(s.pending_days)} future day(s) in this cycle, assumed present</li>}
                    {s.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                </InlineAlert>
              )}
              {s.days.length > 0 && <CycleStrip days={s.days} />}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Heatmap */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Last 12 months</CardTitle>
            <CardDescription>Every day, coloured by attendance status.</CardDescription>
          </div>
          <HeatmapLegend />
        </CardHeader>
        <CardContent>
          {data ? (data.heatmap.length ? <AttendanceHeatmap days={data.heatmap} /> :
            <EmptyState compact title="No attendance yet" />) : <Skeleton className="h-[124px] w-full" />}
        </CardContent>
      </Card>

      {/* Ledger + comp-offs */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Leave ledger</CardTitle>
            <CardDescription>Every credit and debit, newest first. Corrections appear as reversals — nothing is deleted.</CardDescription>
          </CardHeader>
          <CardContent>
            {ledger.isLoading ? (
              <div className="grid gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : ledger.isError ? <ErrorState error={ledger.error} onRetry={() => ledger.refetch()} /> : (
              <div className="max-h-[640px] overflow-y-auto pr-1 scrollbar-thin">
                <LedgerTimeline entries={ledger.data ?? []} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Comp-off lots</CardTitle>
            <CardDescription>Earned for working on an off day; each lot expires on its own.</CardDescription>
          </CardHeader>
          <CardContent>
            {compOffs.isLoading ? <Skeleton className="h-24 w-full" /> :
              compOffs.isError ? <ErrorState error={compOffs.error} onRetry={() => compOffs.refetch()} /> :
                <CompOffLots lots={compOffs.data ?? []} today={today} />}
          </CardContent>
        </Card>
      </div>

      {isHR && data && (
        <>
          <EmployeeFormSheet open={dialog === "edit"} onOpenChange={(v) => setDialog(v ? "edit" : null)} employee={data.employee} />
          <ConfirmProbationDialog employee={data.employee} open={dialog === "confirm"} onOpenChange={(v) => setDialog(v ? "confirm" : null)} />
          <RecordExitDialog employee={data.employee} open={dialog === "exit"} onOpenChange={(v) => setDialog(v ? "exit" : null)} />
          <DeleteEmployeeDialog employee={data.employee} open={dialog === "delete"} onOpenChange={(v) => setDialog(v ? "delete" : null)} />
        </>
      )}
    </div>
  );
}

function BackLink({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Link to="/employees" className="mb-3 inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <ArrowLeft className="size-4" aria-hidden />Employees
    </Link>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5"><span aria-hidden>{icon}</span>{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium tnum">{value}</dd>
    </div>
  );
}

const TONES = {
  success: "bg-success/10 text-success", warning: "bg-warning/10 text-warning", co: "bg-status-co/10 text-status-co-fg",
};
function BalanceCard({ label, value, icon, tone, sub }: {
  label: string; value: string; icon: React.ReactNode; tone: keyof typeof TONES; sub: string;
}) {
  return (
    <motion.div variants={stagger.item} className="rounded-xl border bg-card p-4 shadow-e1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg [&_svg]:size-4", TONES[tone])} aria-hidden>{icon}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <CountUp value={num(value)} format={(n) => fmtDays(Math.round(n * 100) / 100)} className="text-3xl font-semibold tracking-tight" />
        <span className="text-sm text-muted-foreground">days</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </motion.div>
  );
}

function Stat({ code, icon, label, value, highlight, strong }: {
  code?: string; icon?: React.ReactNode; label: string; value: string | number; highlight?: boolean; strong?: boolean;
}) {
  const meta = code ? statusMeta(code) : null;
  const Icon = meta?.icon;
  return (
    <div className={cn("rounded-lg border p-3", highlight ? "border-status-lop/40 bg-status-lop/10" : strong ? "border-primary/30 bg-primary/5" : "bg-card")}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon ? <span className={cn("flex size-5 items-center justify-center rounded-md", meta?.soft)} aria-hidden><Icon className="size-3" /></span>
          : <span className="flex size-5 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden>{icon}</span>}
        {label}
      </dt>
      <dd className={cn("mt-1.5 text-xl font-semibold tnum", highlight && "text-status-lop-fg")}>{fmtDays(value)}</dd>
    </div>
  );
}


/** One chip per cycle day, status-coloured, with tooltip and screen-reader text. */
function CycleStrip({ days }: { days: Profile["summary"]["days"] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">Day by day</p>
      <ol className="flex flex-wrap gap-1" aria-label="Attendance this cycle">
        {days.map((d) => {
          const m = statusMeta(d.status);
          const dt = parseISO(d.date);
          const extra = [num(d.paid_leave) > 0 && `${fmtDays(d.paid_leave)} paid leave`, num(d.lop) > 0 && `${fmtDays(d.lop)} LOP`,
            num(d.comp_off_earned) > 0 && `+${fmtDays(d.comp_off_earned)} comp-off`, d.note].filter(Boolean).join(" · ");
          const text = `${fmtDate(dt, "EEE d MMM")}: ${m?.label ?? "Not marked"}${extra ? ` (${extra})` : ""}`;
          return (
            <li key={d.date}>
              <Tooltip content={text}>
                <span tabIndex={0} aria-label={text}
                  className={cn("flex h-10 w-8 flex-col items-center justify-center rounded-md text-2xs leading-tight tnum outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    m ? m.soft : "border border-dashed text-muted-foreground", num(d.lop) > 0 && "ring-2 ring-status-lop/60")}>
                  <span className="opacity-70">{fmtDate(dt, "d")}</span>
                  <span className="font-semibold">{m?.code ?? "·"}</span>
                </span>
              </Tooltip>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

