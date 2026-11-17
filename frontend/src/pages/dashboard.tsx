import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowRight, BadgeCheck, CalendarClock, Cake, CalendarCheck2, ClipboardCheck, Gift, Hourglass,
  TrendingDown, Upload, Users, Wallet,
} from "lucide-react";
import { client, unwrap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDate } from "@/lib/utils";
import { STATUS, type StatusCode } from "@/lib/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PersonAvatar, Progress, Skeleton, Tooltip } from "@/components/ui/misc";
import { ErrorState, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { CountUp, stagger } from "@/components/shared/motion";
import { CycleRing, Ring } from "@/components/shared/rings";

interface Brief { id: number; code: string; full_name: string; photo_url: string | null; department: string | null }
interface Overview {
  today: { date: string; total: number; present: number; wfh: number; od: number; absent: number; half_day: number;
    on_leave: number; weekly_off: number; holiday: number; unmarked: number };
  cycle: { id: number; label: string; start_date: string; end_date: string; day: number; days: number;
    days_remaining: number; report_due_date: string | null; days_to_report: number | null; status: string };
  absent_today: Brief[]; on_leave_today: Brief[];
  pending: { leave: number; regularization: number };
  birthdays: (Brief & { date: string })[]; anniversaries: (Brief & { date: string; years: number })[];
  trend: { date: string; pct: number | null; present: number; expected: number }[];
  lop_by_department: { department: string; lop_days: number }[];
  top_absentees: (Brief & { absences: number })[];
  utilization: { accrued: number; used: number; lop: number; pct: number; year_start: string; year_end: string };
  alerts: { zero_balance: (Brief & { usable: number })[]; zero_balance_count: number;
    monday_friday: (Brief & { count: number })[]; unmarked_today: Brief[];
    probation_due: (Brief & { probation_end_date: string })[] };
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function DashboardPage() {
  const { user, can } = useAuth();
  const q = useQuery({
    queryKey: ["dashboard"], refetchInterval: 60_000,
    queryFn: async () => (await unwrap(client.GET("/api/dashboard"))) as unknown as Overview,
  });
  const first = user?.full_name.split(" ")[0];
  return (
    <div>
      <PageHeader eyebrow={format(new Date(), "EEEE, d MMMM yyyy")} title={`${greeting()}, ${first ?? "there"}`}
        description={can("manager") ? "Here's how your team is doing today." : "Here's how the office is doing today."}
        actions={can("hr_admin") ? (<>
          <Button variant="outline" asChild><Link to="/reports"><Wallet />Cycle close</Link></Button>
          <Button asChild><Link to="/attendance"><CalendarCheck2 />Mark attendance</Link></Button>
        </>) : undefined} />
      {q.isLoading ? <DashboardSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> :
        q.data && <DashboardBody d={q.data} />}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72 rounded-xl lg:col-span-2" /><Skeleton className="h-72 rounded-xl" /></div>
    </div>
  );
}

const TILES: { key: keyof Overview["today"]; code: StatusCode; label: string }[] = [
  { key: "present", code: "P", label: "Present" },
  { key: "absent", code: "A", label: "Absent" },
  { key: "on_leave", code: "L", label: "On leave" },
  { key: "half_day", code: "HD", label: "Half-day" },
  { key: "wfh", code: "WFH", label: "Work from home" },
];

function DashboardBody({ d }: { d: Overview }) {
  const { can } = useAuth();
  const working = Math.max(0, d.today.total - d.today.weekly_off - d.today.holiday);
  const marked = working - d.today.unmarked;
  // const pending = d.pending.leave + d.pending.regularization; // used by the disabled "Pending approvals" card
  return (
    <motion.div variants={stagger.container} initial="hidden" animate="show" className="grid gap-4">
      {/* Today */}
      <motion.section variants={stagger.item} aria-labelledby="today-h">
        <h2 id="today-h" className="sr-only">Today</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {TILES.map((t) => {
            const m = STATUS[t.code];
            const Icon = m.icon;
            const v = d.today[t.key] as number;
            return (
              <div key={t.key} className="group rounded-xl border bg-card p-4 shadow-e1 transition-shadow hover:shadow-e2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Icon className={cn("size-3.5", m.text)} aria-hidden />{t.label}
                    </p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight"><CountUp value={v} /></p>
                  </div>
                  <Ring value={v} max={Math.max(1, working)} size={46} stroke={5} color={m.color}
                    label={`${t.label}: ${v} of ${working}`}>
                    <span className="text-[10px] font-semibold text-muted-foreground tnum">{working ? Math.round((v / working) * 100) : 0}%</span>
                  </Ring>
                </div>
              </div>
            );
          })}
          <div className={cn("rounded-xl border p-4 shadow-e1", d.today.unmarked ? "bg-warning/[.07] border-warning/30" : "bg-card")}>
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Hourglass className="size-3.5 text-warning" aria-hidden />Marked today
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight tnum"><CountUp value={marked} /><span className="text-base text-muted-foreground">/{working}</span></p>
            <Progress value={working ? (marked / working) * 100 : 100} className="mt-2 h-1.5" label="Attendance marked today"
              indicatorClassName={d.today.unmarked ? "bg-warning" : "bg-success"} />
          </div>
        </div>
      </motion.section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Cycle progress */}
        <motion.div variants={stagger.item}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Pay cycle</CardTitle>
              <CardDescription>{d.cycle.label}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
              <CycleRing day={d.cycle.day} days={d.cycle.days} label={d.cycle.label} size={156} />
              <div className="grid w-full gap-3 text-sm">
                <Fact icon={<CalendarClock />} label="Days remaining" value={`${d.cycle.days_remaining}`} />
                <Fact icon={<Wallet />} label="Report due"
                  value={d.cycle.report_due_date ? fmtDate(d.cycle.report_due_date, "d MMM") : "—"}
                  sub={d.cycle.days_to_report !== null ? `in ${d.cycle.days_to_report} day${d.cycle.days_to_report === 1 ? "" : "s"}` : undefined} />
                <Progress value={(d.cycle.day / d.cycle.days) * 100} label="Cycle progress" />
                {can("hr_admin") && (
                  <Button variant="soft" size="sm" asChild className="justify-between">
                    <Link to="/reports">Prepare cycle close <ArrowRight /></Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Trend */}
        <motion.div variants={stagger.item} className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle>Attendance by day</CardTitle>
                <CardDescription>% of expected staff present (half-days count 0.5) this cycle</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <TrendChart data={d.trend} />
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Absent today */}
        <motion.div variants={stagger.item}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Who's out today
                <span className="rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground tnum">{d.absent_today.length + d.on_leave_today.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {d.absent_today.length + d.on_leave_today.length === 0 ? (
                <EmptyState art="check" compact title="Full house" description="Nobody is absent or on leave today." />
              ) : (<>
                <PeopleRow label="Absent" code="A" people={d.absent_today} />
                <PeopleRow label="On leave" code="L" people={d.on_leave_today} />
              </>)}
            </CardContent>
          </Card>
        </motion.div>

        {/* Quick actions (HR-only version; replaces the "Pending approvals" card, kept commented below) */}
        <motion.div variants={stagger.item}>
          <Card className="h-full">
            <CardHeader><CardTitle>Quick actions</CardTitle><CardDescription>Everything HR does most days</CardDescription></CardHeader>
            <CardContent className="grid gap-2">
              {[
                { to: "/attendance", icon: <CalendarCheck2 />, label: "Mark today's attendance",
                  sub: d.today.unmarked ? `${d.today.unmarked} not marked yet` : "Everyone is marked" },
                { to: "/leave", icon: <ClipboardCheck />, label: "Record leave", sub: "Paid / LOP preview before saving" },
                { to: "/import", icon: <Upload />, label: "Import from Excel", sub: "Bulk or historical attendance" },
                { to: "/reports", icon: <Wallet />, label: "Close cycle & reports", sub: d.cycle.label },
              ].map((a) => (
                <Link key={a.to} to={a.to}
                  className="group flex items-center gap-3 rounded-lg border bg-surface-sunken/60 p-2.5 transition-colors hover:border-primary/40 hover:bg-primary/5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">{a.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{a.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.sub}</span>
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              ))}
            </CardContent>
          </Card>
        </motion.div>

        {/* HR-only version — "Pending approvals" card disabled (no employee-raised requests):
        {/ * Pending approvals *\/}
        <motion.div variants={stagger.item}>
          <Card className="h-full">
            <CardHeader><CardTitle>Pending approvals</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex items-end gap-3">
                <span className="text-4xl font-semibold tracking-tight"><CountUp value={pending} /></span>
                <span className="pb-1 text-sm text-muted-foreground">awaiting a decision</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Link to="/leave?tab=approvals" className="rounded-lg border bg-surface-sunken/60 p-3 transition-colors hover:border-primary/40">
                  <span className="block text-xs text-muted-foreground">Leave</span><span className="text-lg font-semibold tnum">{d.pending.leave}</span>
                </Link>
                <Link to="/leave?tab=approvals" className="rounded-lg border bg-surface-sunken/60 p-3 transition-colors hover:border-primary/40">
                  <span className="block text-xs text-muted-foreground">Corrections</span><span className="text-lg font-semibold tnum">{d.pending.regularization}</span>
                </Link>
              </div>
              <Button asChild variant={pending ? "default" : "outline"} size="sm">
                <Link to="/leave?tab=approvals"><ClipboardCheck />Review requests</Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        */}

        {/* Celebrations */}
        <motion.div variants={stagger.item}>
          <Card className="h-full">
            <CardHeader><CardTitle>This week</CardTitle><CardDescription>Birthdays & work anniversaries</CardDescription></CardHeader>
            <CardContent>
              {d.birthdays.length + d.anniversaries.length === 0 ? (
                <EmptyState art="calendar" compact title="No celebrations this week" />
              ) : (
                <ul className="grid gap-2.5">
                  {d.birthdays.map((b) => (
                    <CelebrationItem key={`b${b.id}`} p={b} icon={<Cake className="size-4 text-status-co-fg" />}
                      text={`Birthday · ${fmtDate(b.date, "EEE d MMM")}`} />
                  ))}
                  {d.anniversaries.map((a) => (
                    <CelebrationItem key={`a${a.id}`} p={a} icon={<Gift className="size-4 text-accent" />}
                      text={`${a.years} year${a.years === 1 ? "" : "s"} · ${fmtDate(a.date, "EEE d MMM")}`} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div variants={stagger.item}>
          <Card className="h-full">
            <CardHeader><CardTitle>LOP by department</CardTitle><CardDescription>Loss-of-pay days this cycle</CardDescription></CardHeader>
            <CardContent>
              {d.lop_by_department.length ? <LopChart data={d.lop_by_department} /> :
                <EmptyState art="chart" compact title="No LOP this cycle" description="Everyone has had enough leave balance." />}
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={stagger.item}>
          <Card className="h-full">
            <CardHeader><CardTitle>Top absentees</CardTitle><CardDescription>Unplanned absences, last 90 days</CardDescription></CardHeader>
            <CardContent>
              {d.top_absentees.length ? (
                <ol className="grid gap-2">
                  {d.top_absentees.map((p, i) => {
                    const max = d.top_absentees[0].absences;
                    return (
                      <li key={p.id}>
                        <Link to={`/employees/${p.id}`} className="flex items-center gap-3 rounded-lg p-1 transition-colors hover:bg-muted/60">
                          <span className="w-4 text-xs text-muted-foreground tnum">{i + 1}</span>
                          <PersonAvatar name={p.full_name} src={p.photo_url} size={28} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{p.full_name}</span>
                            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                              <span className="block h-full rounded-full bg-status-a/70" style={{ width: `${(p.absences / max) * 100}%` }} />
                            </span>
                          </span>
                          <span className="text-sm font-semibold tnum">{p.absences}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              ) : <EmptyState art="check" compact title="No absences in 90 days" />}
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={stagger.item}>
          <Card className="h-full">
            <CardHeader><CardTitle>Leave utilisation</CardTitle>
              <CardDescription>Leave year {fmtDate(d.utilization.year_start, "MMM yyyy")} – {fmtDate(d.utilization.year_end, "MMM yyyy")}</CardDescription></CardHeader>
            <CardContent className="flex items-center gap-5">
              <Ring value={d.utilization.pct} size={120} stroke={11} color="hsl(var(--st-l))" label={`${d.utilization.pct}% of accrued leave used`}>
                <span className="text-center"><span className="block text-2xl font-semibold tnum"><CountUp value={d.utilization.pct} decimals={0} />%</span>
                  <span className="text-2xs text-muted-foreground">used</span></span>
              </Ring>
              <dl className="grid gap-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">Accrued</dt><dd className="font-semibold tnum">{d.utilization.accrued.toFixed(1)} days</dd></div>
                <div><dt className="text-xs text-muted-foreground">Used (paid)</dt><dd className="font-semibold tnum">{d.utilization.used.toFixed(1)} days</dd></div>
                <div><dt className="text-xs text-muted-foreground">LOP</dt><dd className="font-semibold tnum text-status-lop-fg">{d.utilization.lop.toFixed(1)} days</dd></div>
              </dl>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={stagger.item}><Alerts d={d} /></motion.div>
    </motion.div>
  );
}

function Fact({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">{icon}</span>
      <div className="flex-1 text-muted-foreground">{label}</div>
      <div className="text-right"><div className="font-semibold tnum">{value}</div>{sub && <div className="text-xs text-muted-foreground">{sub}</div>}</div>
    </div>
  );
}

function PeopleRow({ label, code, people }: { label: string; code: StatusCode; people: Brief[] }) {
  if (!people.length) return null;
  const m = STATUS[code];
  const Icon = m.icon;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon className={cn("size-3.5", m.text)} aria-hidden />{label} · {people.length}</p>
      <div className="flex flex-wrap gap-2">
        {people.slice(0, 12).map((p) => (
          <Tooltip key={p.id} content={`${p.full_name} · ${p.department ?? ""}`}>
            <Link to={`/employees/${p.id}`} className="rounded-full transition-transform hover:-translate-y-0.5" aria-label={p.full_name}>
              <PersonAvatar name={p.full_name} src={p.photo_url} size={36} ring />
            </Link>
          </Tooltip>
        ))}
        {people.length > 12 && <span className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-medium">+{people.length - 12}</span>}
      </div>
    </div>
  );
}

function CelebrationItem({ p, icon, text }: { p: Brief; icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-3">
      <PersonAvatar name={p.full_name} src={p.photo_url} size={32} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.full_name}</p><p className="text-xs text-muted-foreground">{text}</p></div>
      {icon}
    </li>
  );
}

function ChartTooltip({ active, payload, render }: { active?: boolean; payload?: { payload: any }[]; render: (p: any) => React.ReactNode }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-lg border glass px-3 py-2 text-xs shadow-e2">{render(payload[0].payload)}</div>;
}

const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 11, tickLine: false, axisLine: false };

function TrendChart({ data }: { data: Overview["trend"] }) {
  const rows = data.map((r) => ({ ...r, label: format(parseISO(r.date), "d MMM") }));
  const valid = rows.filter((r) => r.pct !== null);
  if (!valid.length) return <EmptyState art="chart" compact title="No working days yet this cycle" />;
  const avg = valid.reduce((s, r) => s + (r.pct ?? 0), 0) / valid.length;
  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">Average <b className="text-foreground tnum">{avg.toFixed(1)}%</b> across {valid.length} working days</p>
      <div className="h-56" role="img" aria-label={`Attendance trend, average ${avg.toFixed(1)} percent`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={18} />
            <YAxis domain={[0, 100]} ticks={[0, 50, 100]} {...axis} tickFormatter={(v) => `${v}%`} />
            <RTooltip cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }}
              content={<ChartTooltip render={(p) => (<>
                <p className="font-semibold">{format(parseISO(p.date), "EEE d MMM")}</p>
                <p className="text-muted-foreground tnum">{p.pct === null ? "Non-working day" : `${p.pct}% · ${p.present} of ${p.expected}`}</p>
              </>)} />} />
            <Area type="monotone" dataKey="pct" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#trend-fill)"
              connectNulls dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LopChart({ data }: { data: Overview["lop_by_department"] }) {
  return (
    <div className="h-52" role="img" aria-label={`LOP by department: ${data.map((d) => `${d.department} ${d.lop_days} days`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
          <XAxis type="number" {...axis} allowDecimals />
          <YAxis type="category" dataKey="department" {...axis} width={96} />
          <RTooltip cursor={{ fill: "hsl(var(--muted) / .6)" }}
            content={<ChartTooltip render={(p) => (<><p className="font-semibold">{p.department}</p><p className="text-muted-foreground tnum">{p.lop_days} LOP days</p></>)} />} />
          <Bar dataKey="lop_days" fill="hsl(var(--st-lop))" radius={[0, 4, 4, 0]} maxBarSize={18}
            label={{ position: "right", fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Alerts({ d }: { d: Overview }) {
  const groups = [
    { key: "unmarked", title: "Unmarked attendance today", icon: Hourglass, tone: "text-warning", people: d.alerts.unmarked_today,
      detail: () => "Not marked yet", cta: { to: "/attendance", label: "Mark now" } },
    { key: "probation", title: "Probation confirmations due (15 days)", icon: BadgeCheck, tone: "text-status-l-fg",
      people: d.alerts.probation_due, detail: (p: any) => `Ends ${fmtDate(p.probation_end_date, "d MMM")}` },
    { key: "pattern", title: "Frequent Monday/Friday absences", icon: AlertTriangle, tone: "text-status-a-fg",
      people: d.alerts.monday_friday, detail: (p: any) => `${p.count} Mon/Fri absences (90 days)` },
    { key: "zero", title: `Zero leave balance (${d.alerts.zero_balance_count})`, icon: TrendingDown, tone: "text-status-lop-fg",
      people: d.alerts.zero_balance, detail: () => "Next absence becomes LOP" },
  ];
  const any = groups.some((g) => g.people.length);
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" aria-hidden />Needs attention</CardTitle></CardHeader>
      <CardContent>
        {!any ? <EmptyState art="check" compact title="All clear" description="No alerts right now." /> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {groups.map((g) => {
              const Icon = g.icon;
              return (
                <section key={g.key} className="rounded-xl border bg-surface-sunken/50 p-3" aria-label={g.title}>
                  <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Icon className={cn("size-4", g.tone)} aria-hidden />{g.title}</p>
                  {g.people.length === 0 ? <p className="text-xs text-muted-foreground">Nothing to flag.</p> : (
                    <ul className="grid gap-1.5">
                      {g.people.slice(0, 5).map((p) => (
                        <li key={p.id}>
                          <Link to={`/employees/${p.id}`} className="flex items-center gap-2 rounded-md p-1 text-sm hover:bg-muted/70">
                            <PersonAvatar name={p.full_name} src={p.photo_url} size={22} />
                            <span className="truncate">{p.full_name}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{g.detail(p)}</span>
                          </Link>
                        </li>
                      ))}
                      {g.people.length > 5 && <li className="px-1 text-xs text-muted-foreground">+{g.people.length - 5} more</li>}
                    </ul>
                  )}
                  {g.cta && g.people.length > 0 && (
                    <Button variant="link" size="sm" asChild className="mt-1 h-auto px-1"><Link to={g.cta.to}>{g.cta.label} <ArrowRight /></Link></Button>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
