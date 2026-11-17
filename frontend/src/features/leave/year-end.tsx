import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CheckCircle2, Info, Repeat2, Send, TrendingDown, Users } from "lucide-react";
import { toast } from "sonner";
import { client, unwrap } from "@/lib/api";
import type { Employee } from "@/lib/types";
import { cn, fmtDate, fmtDays, isoDate, num } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton, Switch } from "@/components/ui/misc";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState, InlineAlert, StatTile } from "@/components/shared/page";
import { CountUp } from "@/components/shared/motion";
import { invalidateLeaveData, type CarryForward, type CarryForwardRow, type Encashment } from "./api";
import { EmployeePicker } from "./employee-picker";

/* ================================================================== carry forward */
export function CarryForwardPanel() {
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => thisYear - i);
  const [year, setYear] = React.useState(thisYear - 1);
  const [onlyLapse, setOnlyLapse] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const toggleId = React.useId();

  const q = useQuery({
    queryKey: ["carry-forward", year],
    queryFn: () => unwrap(client.GET("/api/leave/carry-forward", { params: { query: { year } } })) as Promise<CarryForward>,
  });
  const post = useMutation({
    mutationFn: () => unwrap(client.POST("/api/leave/carry-forward/{year}", { params: { path: { year } } })) as Promise<unknown>,
    onSuccess: (r) => {
      const n = (r as { posted?: number })?.posted ?? 0;
      toast.success(`Carry-forward posted for ${year}`, { description: `${n} employee${n === 1 ? "" : "s"} updated.` });
      setConfirm(false);
      invalidateLeaveData(qc);
    },
  });

  const d = q.data;
  const rows = React.useMemo(() => (d?.rows ?? []).filter((r) => !onlyLapse || num(r.lapse) > 0), [d, onlyLapse]);
  const totals = React.useMemo(() => ({
    carry: (d?.rows ?? []).reduce((s, r) => s + num(r.carry_forward), 0),
    lapse: (d?.rows ?? []).reduce((s, r) => s + num(r.lapse), 0),
    lapsing: (d?.rows ?? []).filter((r) => num(r.lapse) > 0).length,
    pending: (d?.rows ?? []).filter((r) => !r.already_posted).length,
  }), [d]);
  const yearOpen = !!d && d.year_end >= isoDate(new Date());

  const columns = React.useMemo<ColumnDef<CarryForwardRow>[]>(() => [
    { id: "employee", header: "Employee", accessorFn: (r) => r.full_name, cell: ({ row }) => (
      <span className="flex min-w-[160px] items-center gap-2">
        {num(row.original.lapse) > 0 && <span className="h-6 w-1 rounded-full bg-destructive" aria-hidden />}
        <span><span className="block font-medium">{row.original.full_name}</span>
          <span className="block text-2xs text-muted-foreground">{row.original.code}</span></span>
      </span>) },
    { accessorKey: "balance", header: "Year-end balance", meta: { align: "right" }, sortingFn: (a, b) => num(a.original.balance) - num(b.original.balance),
      cell: ({ getValue }) => fmtDays(getValue<string>()) },
    { accessorKey: "carry_forward", header: "Carries forward", meta: { align: "right" }, sortingFn: (a, b) => num(a.original.carry_forward) - num(b.original.carry_forward),
      cell: ({ getValue }) => <span className="font-semibold text-success">{fmtDays(getValue<string>())}</span> },
    { accessorKey: "lapse", header: "Lapses", meta: { align: "right" }, sortingFn: (a, b) => num(a.original.lapse) - num(b.original.lapse),
      cell: ({ getValue }) => num(getValue<string>()) > 0
        ? <Badge variant="destructive" className="tnum"><TrendingDown className="size-3" aria-hidden />{fmtDays(getValue<string>())}</Badge>
        : <span className="text-muted-foreground">0</span> },
    { accessorKey: "locked", header: "Locked (kept)", meta: { align: "right" }, cell: ({ getValue }) => (
      <span className="text-muted-foreground">{fmtDays(getValue<string>())}</span>) },
    { accessorKey: "already_posted", header: "Status", cell: ({ getValue }) => getValue<boolean>()
      ? <Badge variant="success"><CheckCircle2 className="size-3" aria-hidden />Posted</Badge>
      : <Badge variant="secondary">Not posted</Badge> },
  ], []);

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1">
            <CardTitle>Year-end carry forward</CardTitle>
            <CardDescription>
              Usable balance above the cap lapses at the end of the leave year. Locked probation days are untouched.
            </CardDescription>
          </div>
          <div className="flex items-end gap-2">
            <Field label="Leave year" htmlFor="cf-year">
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger id="cf-year" className="w-28 tnum"><SelectValue /></SelectTrigger>
                <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Button onClick={() => setConfirm(true)} disabled={!d || d.already_posted || yearOpen || totals.pending === 0}>
              <Repeat2 />Post carry-forward
            </Button>
          </div>
        </CardHeader>
        {d && (
          <CardContent className="grid gap-3">
            {d.already_posted ? (
              <InlineAlert tone="success" icon={<CheckCircle2 className="size-4" />} title={`Carry-forward for ${d.year} is posted`}>
                All employees have their year-end entry. Corrections go through manual adjustments.
              </InlineAlert>
            ) : yearOpen ? (
              <InlineAlert tone="info" icon={<Info className="size-4" />} title="This leave year hasn't ended">
                The {d.year} leave year runs {fmtDate(d.year_start)} – {fmtDate(d.year_end)}. This is a projection; you can post after it ends.
              </InlineAlert>
            ) : null}
          </CardContent>
        )}
      </Card>

      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {!d ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />) : <>
              <StatTile label="Carry-forward cap" value={d.cap === null || d.cap === undefined ? "No cap" : `${fmtDays(d.cap)} days`}
                sub={d.cap === null || d.cap === undefined ? "Whole balance carries over" : "max per employee"} />
              <StatTile label="Employees" value={<CountUp value={d.rows.length} />} icon={<Users />} tone="primary"
                sub={`${totals.pending} not yet posted`} />
              <StatTile label="Carrying forward" value={fmtDays(totals.carry)} icon={<Repeat2 />} tone="success" sub="days in total" />
              <StatTile label="Lapsing" value={<span className={totals.lapse ? "text-destructive" : ""}>{fmtDays(totals.lapse)}</span>}
                icon={<TrendingDown />} tone={totals.lapse ? "destructive" : "muted"}
                sub={`${totals.lapsing} employee${totals.lapsing === 1 ? "" : "s"} above cap`} />
            </>}
          </div>
          <div className="flex items-center gap-2">
            <Switch id={toggleId} checked={onlyLapse} onCheckedChange={setOnlyLapse} />
            <Label htmlFor={toggleId} className="font-normal text-muted-foreground">Only show employees with lapsing days</Label>
          </div>
          <DataTable columns={columns} data={rows} loading={q.isLoading} rowKey={(r) => r.employee_id}
            empty={<EmptyState compact art="chart" title={onlyLapse ? "Nobody loses leave" : "No employees in this leave year"}
              description={onlyLapse ? "Every balance is within the cap." : undefined} />} />
        </>
      )}

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Post carry-forward for ${year}?`} confirmLabel="Post carry-forward"
        loading={post.isPending} destructive={totals.lapse > 0} onConfirm={() => post.mutate()}
        description={`${totals.pending} employee${totals.pending === 1 ? "" : "s"} will get a year-end entry dated ${d ? fmtDate(d.year_end) : ""}.`}>
        {totals.lapse > 0 ? (
          <InlineAlert tone="destructive" title={`${fmtDays(totals.lapse)} days will lapse`}>
            {totals.lapsing} employee{totals.lapsing === 1 ? "" : "s"} above the cap lose the excess. Ledger rows are permanent.
          </InlineAlert>
        ) : <InlineAlert tone="info" icon={<Info className="size-4" />}>No balance is above the cap — nothing lapses.</InlineAlert>}
      </ConfirmDialog>
    </div>
  );
}

/* ================================================================== encashment */

export function EncashmentPanel() {
  const qc = useQueryClient();
  const uid = React.useId();
  const [emp, setEmp] = React.useState<Employee | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const q = useQuery({
    queryKey: ["encashment", emp?.id],
    enabled: !!emp,
    queryFn: () => unwrap(client.GET("/api/leave/encashment/{emp_id}", { params: { path: { emp_id: emp!.id } } })) as Promise<Encashment>,
  });
  const post = useMutation({
    mutationFn: () => unwrap(client.POST("/api/leave/encashment/{emp_id}", { params: { path: { emp_id: emp!.id } } })) as Promise<Encashment>,
    onSuccess: (r) => {
      toast.success("Encashment posted", { description: `${fmtDays(r.days)} days for ${emp?.full_name} — Accounts computes the amount` });
      qc.setQueryData(["encashment", emp?.id], r);
      setConfirm(false);
      invalidateLeaveData(qc);
    },
  });
  const d = q.data;

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Leave encashment</CardTitle>
          <CardDescription>Pay out the usable balance of an employee who has left. Locked and comp-off days aren't encashed.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field label="Exited employee" htmlFor={`${uid}-emp`}>
            <EmployeePicker id={`${uid}-emp`} value={emp} onChange={setEmp} status="exited" placeholder="Search exited employees…" />
          </Field>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        {!emp ? (
          <EmptyState art="people" title="Choose an exited employee" description="You'll see the days to encash before posting. Accounts converts them into the settlement amount." />
        ) : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? (
          <div className="grid gap-3 p-5" aria-busy="true"><Skeleton className="h-6 w-40" /><Skeleton className="h-16 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : (
          <>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle>{emp.full_name}</CardTitle>
                <CardDescription>{emp.code}{d.exit_date ? ` · exited ${fmtDate(d.exit_date)}` : ""}</CardDescription>
              </div>
              {d.already_posted && <Badge variant="success"><CheckCircle2 className="size-3" aria-hidden />Posted</Badge>}
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="rounded-xl bg-gradient-to-br from-primary/10 to-accent/10 p-4 ring-1 ring-inset ring-primary/15">
                <p className="flex items-center gap-1.5 text-xs font-medium text-primary"><Banknote className="size-3.5" aria-hidden />Days to encash</p>
                <p className="mt-1 text-4xl font-semibold tracking-tight tnum">{fmtDays(d.days)} <span className="text-lg font-medium text-muted-foreground">day{num(d.days) === 1 ? "" : "s"}</span></p>
                <p className="mt-1 text-sm text-muted-foreground">Usable leave balance at exit. Accounts calculates the amount for the final settlement.</p>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                {([["Usable", d.usable, true], ["Locked", d.locked, false], ["Comp-off", d.comp_off, false]] as const).map(([l, v, enc]) => (
                  <div key={l} className={cn("rounded-lg border px-3 py-2", !enc && "opacity-70")}>
                    <dt className="text-2xs text-muted-foreground">{l}{!enc && " · not encashed"}</dt>
                    <dd className="text-lg font-semibold tnum">{fmtDays(v)}</dd>
                  </div>
                ))}
              </dl>
              {d.already_posted ? (
                <InlineAlert tone="success" icon={<CheckCircle2 className="size-4" />} title="Already encashed">
                  The usable balance was debited with an ENCASHMENT entry. Share the encashed days with Accounts for the final settlement.
                </InlineAlert>
              ) : num(d.days) <= 0 ? (
                <InlineAlert tone="info" icon={<Info className="size-4" />} title="Nothing to encash">No usable balance remains.</InlineAlert>
              ) : (
                <div className="flex justify-end">
                  <Button onClick={() => setConfirm(true)}><Send />Post encashment</Button>
                </div>
              )}
            </CardContent>
          </>
        )}
      </Card>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Post encashment?" confirmLabel="Post encashment"
        loading={post.isPending} onConfirm={() => post.mutate()}
        description={d && emp ? `Debit ${fmtDays(d.days)} usable day(s) from ${emp.full_name} for encashment. This can only be posted once.` : undefined} />
    </div>
  );
}
