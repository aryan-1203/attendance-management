import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import type { CompOff, Employee } from "@/lib/types";
import { fmtDate, fmtDays, num } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/label";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState, StatTile } from "@/components/shared/page";
import { useCompOffs } from "./api";
import { EmployeePicker } from "./employee-picker";
import { daysFromToday } from "./format";

const LOT_STATUS: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "destructive" }> = {
  available: { label: "Available", variant: "success" },
  partial: { label: "Partly used", variant: "warning" },
  used: { label: "Used", variant: "secondary" },
  expired: { label: "Expired", variant: "destructive" },
};

const remaining = (c: CompOff) => Math.max(0, num(c.days) - num(c.used_days) - num(c.expired_days));

/** HR: comp-off lots for one employee. */
export function CompOffPanel({ employee, onEmployee, onGrant }: {
  employee: Employee | null; onEmployee: (e: Employee | null) => void; onGrant: () => void;
}) {
  const uid = React.useId();
  const lots = useCompOffs(employee?.id);
  const data = lots.data ?? [];
  const totals = React.useMemo(() => ({
    earned: data.reduce((s, c) => s + num(c.days), 0),
    used: data.reduce((s, c) => s + num(c.used_days), 0),
    expired: data.reduce((s, c) => s + num(c.expired_days), 0),
    open: data.reduce((s, c) => s + remaining(c), 0),
    soon: data.filter((c) => remaining(c) > 0 && daysFromToday(c.expires_on) >= 0 && daysFromToday(c.expires_on) <= 14).length,
  }), [data]);

  const columns = React.useMemo<ColumnDef<CompOff>[]>(() => [
    { accessorKey: "earned_date", header: "Earned on", cell: ({ getValue }) => <span className="whitespace-nowrap tnum font-medium">{fmtDate(getValue<string>(), "EEE d MMM yyyy")}</span> },
    { accessorKey: "days", header: "Days", meta: { align: "right" }, cell: ({ getValue }) => fmtDays(getValue<string>()) },
    { accessorKey: "used_days", header: "Used", meta: { align: "right" }, cell: ({ getValue }) => fmtDays(getValue<string>()) },
    { accessorKey: "expired_days", header: "Expired", meta: { align: "right" }, cell: ({ getValue }) => (
      <span className={num(getValue<string>()) ? "text-destructive" : ""}>{fmtDays(getValue<string>())}</span>) },
    { id: "remaining", header: "Remaining", meta: { align: "right" }, accessorFn: remaining, cell: ({ getValue }) => (
      <span className="font-semibold">{fmtDays(getValue<number>())}</span>) },
    { accessorKey: "expires_on", header: "Expires", cell: ({ row }) => {
      const d = daysFromToday(row.original.expires_on);
      const left = remaining(row.original) > 0;
      return (
        <span className="grid whitespace-nowrap">
          <span className="tnum">{fmtDate(row.original.expires_on, "d MMM yyyy")}</span>
          {left && <span className={d <= 14 ? "text-2xs font-medium text-warning" : "text-2xs text-muted-foreground"}>
            {d < 0 ? "expired" : d === 0 ? "expires today" : `in ${d} day${d === 1 ? "" : "s"}`}</span>}
        </span>
      );
    } },
    { accessorKey: "status", header: "Status", cell: ({ getValue }) => {
      const m = LOT_STATUS[getValue<string>()] ?? { label: getValue<string>(), variant: "secondary" as const };
      return <Badge variant={m.variant}>{m.label}</Badge>;
    } },
  ], []);

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1">
            <CardTitle>Comp-off lots</CardTitle>
            <CardDescription>Earned by working on a weekly off or holiday; used oldest-first and expire if unused.</CardDescription>
          </div>
          <Button variant="soft" onClick={onGrant} disabled={!employee}><Plus />Grant comp-off</Button>
        </CardHeader>
        <CardContent>
          <Field label="Employee" htmlFor={`${uid}-emp`} className="max-w-md">
            <EmployeePicker id={`${uid}-emp`} value={employee} onChange={onEmployee} />
          </Field>
        </CardContent>
      </Card>
      {!employee ? (
        <div className="rounded-xl border bg-card shadow-e1">
          <EmptyState art="search" title="Pick an employee" description="See every comp-off lot with its usage, expiry and status." />
        </div>
      ) : lots.isError ? <ErrorState error={lots.error} onRetry={() => void lots.refetch()} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Available now" value={fmtDays(totals.open)} tone="primary"
              sub={totals.soon ? `${totals.soon} lot${totals.soon === 1 ? "" : "s"} expiring within 14 days` : "days across open lots"} />
            <StatTile label="Earned" value={fmtDays(totals.earned)} sub={`${data.length} lot${data.length === 1 ? "" : "s"}`} />
            <StatTile label="Used" value={fmtDays(totals.used)} />
            <StatTile label="Expired" value={fmtDays(totals.expired)} tone={totals.expired ? "destructive" : "muted"} />
          </div>
          <DataTable columns={columns} data={data} loading={lots.isLoading} rowKey={(r) => r.id}
            empty={<EmptyState compact art="calendar" title="No comp-off earned"
              description={`${employee.full_name} hasn't worked on a weekly off or holiday yet.`} />} />
        </>
      )}
    </div>
  );
}
