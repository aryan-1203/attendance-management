import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, Ban, Check, Paperclip, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import type { Employee, LeaveRequest, Regularization } from "@/lib/types";
import { fmtDate, num } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { PersonAvatar, Tooltip } from "@/components/ui/misc";
import { DataTable, Pager } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { useLeaveRequests, useRegularizations } from "./api";
import { canCancel, useCancelLeave, useDecision } from "./actions";
import { EmployeePicker } from "./employee-picker";
import { LEAVE_TYPE_LABEL, PayBreakdown, RequestStatusBadge, dayWord, fmtRange, parseUtc } from "./format";
import { STATUS_FILTERS, Segmented } from "./segmented";

function Person({ e }: { e: { full_name: string; code: string; photo_url?: string | null } }) {
  return (
    <span className="flex min-w-[160px] items-center gap-2.5">
      <PersonAvatar name={e.full_name} src={e.photo_url} size={28} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{e.full_name}</span>
        <span className="block text-2xs text-muted-foreground">{e.code}</span>
      </span>
    </span>
  );
}

function DecideButtons({ name, onDecide, disabled }: { name: string; onDecide: (a: "approve" | "reject") => void; disabled?: boolean }) {
  return (
    <span className="inline-flex gap-1">
      <Tooltip content="Approve">
        <Button size="icon-sm" variant="soft" disabled={disabled} onClick={() => onDecide("approve")}
          className="bg-success/10 text-success hover:bg-success/15" aria-label={`Approve request from ${name}`}><Check /></Button>
      </Tooltip>
      <Tooltip content="Reject">
        <Button size="icon-sm" variant="ghost" disabled={disabled} onClick={() => onDecide("reject")}
          className="text-destructive hover:bg-destructive/10" aria-label={`Reject request from ${name}`}><X /></Button>
      </Tooltip>
    </span>
  );
}

/** All leave requests (status filter, employee filter, paginated, cancel). */
export function LeaveRequestsTable() {
  const { user, role } = useAuth();
  const [status, setStatus] = React.useState("");
  const [emp, setEmp] = React.useState<Employee | null>(null);
  const [page, setPage] = React.useState(1);
  const q = useLeaveRequests({ status, employee_id: emp?.id, page, page_size: 25 });
  const decide = useDecision();
  const cancel = useCancelLeave();
  const [confirm, setConfirm] = React.useState<LeaveRequest | null>(null);
  const canDecide = (r: LeaveRequest) => r.status === "pending" && (role === "hr_admin" || r.employee_id !== user?.employee_id);

  const columns = React.useMemo<ColumnDef<LeaveRequest>[]>(() => [
    { id: "employee", header: "Employee", accessorFn: (r) => r.employee.full_name, cell: ({ row }) => <Person e={row.original.employee} /> },
    { id: "dates", header: "Dates", accessorFn: (r) => r.start_date, cell: ({ row }) => (
      <span className="whitespace-nowrap tnum">{fmtRange(row.original.start_date, row.original.end_date, row.original.is_half_day)}</span>) },
    { accessorKey: "days", header: "Days", meta: { align: "right" }, sortingFn: (a, b) => num(a.original.days) - num(b.original.days),
      cell: ({ row }) => <span className="tnum font-medium">{dayWord(num(row.original.days))}</span> },
    { id: "pay", header: "Paid / LOP (est.)", enableSorting: false, cell: ({ row }) => (
      <PayBreakdown days={row.original.days} paid={row.original.paid_days_estimate} lop={row.original.lop_days_estimate} className="min-w-[150px]" />) },
    { accessorKey: "leave_type", header: "Type", cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-muted-foreground">{LEAVE_TYPE_LABEL[getValue<string>()] ?? getValue<string>()}</span>) },
    { accessorKey: "reason", header: "Reason", enableSorting: false, cell: ({ row }) => (
      <span className="flex min-w-[180px] items-start gap-1 text-muted-foreground">
        <span className="line-clamp-2">{row.original.reason}</span>
        {row.original.attachment_path && <Paperclip className="mt-0.5 size-3.5 shrink-0" aria-label="Has attachment" />}
      </span>) },
    { accessorKey: "status", header: "Status", cell: ({ row }) => (
      <span className="grid gap-0.5">
        <RequestStatusBadge status={row.original.status} className="w-fit" />
        {row.original.decision_note && <span className="line-clamp-1 max-w-[180px] text-2xs text-muted-foreground" title={row.original.decision_note}>{row.original.decision_note}</span>}
      </span>) },
    { accessorKey: "created_at", header: "Requested", cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground tnum">{fmtDate(parseUtc(getValue<string>()), "d MMM, HH:mm")}</span>) },
    { id: "actions", header: () => <span className="sr-only">Actions</span>, enableSorting: false, cell: ({ row }) => {
      const r = row.original;
      return (
        <span className="flex items-center justify-end gap-1">
          {canDecide(r) && <DecideButtons name={r.employee.full_name} disabled={decide.isPending}
            onDecide={(action) => decide.mutate({ kind: "leave", id: r.id, action })} />}
          {canCancel(r) && (
            <Tooltip content="Cancel request">
              <Button size="icon-sm" variant="ghost" onClick={() => setConfirm(r)} aria-label={`Cancel leave of ${r.employee.full_name}`}>
                <Ban />
              </Button>
            </Tooltip>
          )}
        </span>
      );
    } },
  ], [decide, role, user?.employee_id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented label="Filter by status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_FILTERS} />
        <EmployeePicker value={emp} onChange={(e) => { setEmp(e); setPage(1); }} placeholder="Filter by employee…" className="sm:w-72" />
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable columns={columns} data={q.data?.items ?? []} loading={q.isLoading} rowKey={(r) => r.id}
          empty={<EmptyState compact art="inbox" title="No leave requests" description={status || emp ? "Try a different filter." : "Requests will appear here as employees apply."} />} />
      )}
      {q.data && q.data.pages > 1 && <Pager page={page} pages={q.data.pages} total={q.data.total} onPage={setPage} />}
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} destructive confirmLabel="Cancel leave"
        loading={cancel.isPending} title={`Cancel ${confirm?.employee.full_name ?? ""}'s leave?`}
        description={confirm ? `${fmtRange(confirm.start_date, confirm.end_date, confirm.is_half_day)} · ${dayWord(num(confirm.days))}. ${
          confirm.status === "approved" ? "Leave marks are cleared from the grid and balances recalculated (posted as reversal rows)." :
            "The request will be withdrawn."}` : undefined}
        onConfirm={() => confirm && cancel.mutate(confirm.id, { onSuccess: () => setConfirm(null) })} />
    </div>
  );
}

/** All attendance corrections (status filter, paginated, approve/reject). */
export function RegularizationsTable() {
  const { user, role } = useAuth();
  const [status, setStatus] = React.useState("");
  const [page, setPage] = React.useState(1);
  const q = useRegularizations({ status, page, page_size: 25 });
  const decide = useDecision();
  const columns = React.useMemo<ColumnDef<Regularization>[]>(() => [
    { id: "employee", header: "Employee", accessorFn: (r) => r.employee.full_name, cell: ({ row }) => <Person e={row.original.employee} /> },
    { accessorKey: "date", header: "Date", cell: ({ getValue }) => <span className="whitespace-nowrap tnum">{fmtDate(getValue<string>(), "EEE d MMM yyyy")}</span> },
    { id: "change", header: "Change", enableSorting: false, cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <StatusBadge code={row.original.current_status} size="xs" />
        <ArrowRight className="size-3.5 text-muted-foreground" aria-label="to" />
        <StatusBadge code={row.original.requested_status} size="xs" />
      </span>) },
    { accessorKey: "reason", header: "Reason", enableSorting: false, cell: ({ getValue }) => (
      <span className="line-clamp-2 min-w-[200px] text-muted-foreground">{getValue<string>()}</span>) },
    { accessorKey: "status", header: "Status", cell: ({ row }) => (
      <span className="grid gap-0.5">
        <RequestStatusBadge status={row.original.status} className="w-fit" />
        {row.original.decision_note && <span className="line-clamp-1 max-w-[180px] text-2xs text-muted-foreground" title={row.original.decision_note}>{row.original.decision_note}</span>}
      </span>) },
    { accessorKey: "created_at", header: "Requested", cell: ({ getValue }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground tnum">{fmtDate(parseUtc(getValue<string>()), "d MMM, HH:mm")}</span>) },
    { id: "actions", header: () => <span className="sr-only">Actions</span>, enableSorting: false, cell: ({ row }) => {
      const r = row.original;
      const can = r.status === "pending" && (role === "hr_admin" || r.employee_id !== user?.employee_id);
      return can ? <span className="flex justify-end"><DecideButtons name={r.employee.full_name} disabled={decide.isPending}
        onDecide={(action) => decide.mutate({ kind: "regularization", id: r.id, action })} /></span> : null;
    } },
  ], [decide, role, user?.employee_id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-3">
      <Segmented label="Filter by status" value={status} onChange={(v) => { setStatus(v); setPage(1); }}
        options={STATUS_FILTERS.filter((s) => s.value !== "cancelled")} />
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable columns={columns} data={q.data?.items ?? []} loading={q.isLoading} rowKey={(r) => r.id}
          empty={<EmptyState compact art="inbox" title="No corrections" description={status ? "Try a different filter." : "Attendance correction requests will appear here."} />} />
      )}
      {q.data && q.data.pages > 1 && <Pager page={page} pages={q.data.pages} total={q.data.total} onPage={setPage} />}
    </div>
  );
}
