import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeftRight, ArrowRight, MessageSquareQuote, Palmtree, Paperclip, Wrench } from "lucide-react";
import type { LeaveRequest, Regularization } from "@/lib/types";
import { cn, fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/misc";
import { StatusBadge } from "@/components/shared/status-badge";
import { easeOut } from "@/components/shared/motion";
import { canCancel, useCancelLeave } from "@/features/leave/actions";
import { LEAVE_TYPE_LABEL, PayBreakdown, RequestStatusBadge, dayWord, fmtRange } from "@/features/leave/format";
import { num } from "@/lib/utils";

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="grid gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-lg border p-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="grid flex-1 gap-1.5"><Skeleton className="h-3.5 w-48" /><Skeleton className="h-3 w-32" /></div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

/** My leave requests as cards, with cancel for pending / approved-future. */
export function MyLeaveList({ items }: { items: LeaveRequest[] }) {
  const reduce = useReducedMotion();
  const cancel = useCancelLeave();
  const [confirm, setConfirm] = React.useState<LeaveRequest | null>(null);
  return (
    <>
      <ul className="grid gap-2" aria-label="My leave requests">
        <AnimatePresence initial={false}>
          {items.map((r) => {
            const Icon = r.leave_type === "comp_off" ? ArrowLeftRight : Palmtree;
            return (
              <motion.li key={r.id} layout={!reduce} initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: easeOut }}
                className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-e1 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 gap-3">
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg",
                    r.leave_type === "comp_off" ? "bg-status-co/10 text-status-co-fg" : "bg-status-l/10 text-status-l-fg")}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
                      <span className="tnum">{fmtRange(r.start_date, r.end_date, r.is_half_day)}</span>
                      <span className="text-xs font-normal text-muted-foreground tnum">
                        {dayWord(num(r.days))} · {LEAVE_TYPE_LABEL[r.leave_type] ?? r.leave_type}
                      </span>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <PayBreakdown days={r.days} paid={r.paid_days_estimate} lop={r.lop_days_estimate} />
                      {r.attachment_path && <span className="inline-flex items-center gap-0.5 text-2xs text-muted-foreground">
                        <Paperclip className="size-3" aria-hidden />Attachment</span>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.reason}</p>
                    {r.decision_note && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-foreground/80">
                        <MessageSquareQuote className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />{r.decision_note}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
                  <RequestStatusBadge status={r.status} />
                  {canCancel(r) && (
                    <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirm(r)} aria-label={`Cancel leave ${fmtRange(r.start_date, r.end_date)}`}>
                      Cancel
                    </Button>
                  )}
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} destructive
        title="Cancel this leave?" confirmLabel="Cancel leave" loading={cancel.isPending}
        description={confirm ? `${fmtRange(confirm.start_date, confirm.end_date, confirm.is_half_day)} · ${dayWord(num(confirm.days))}. ${
          confirm.status === "approved" ? "The days will be cleared from your attendance and your balance restored." :
            "Your approver will no longer see this request."}` : undefined}
        onConfirm={() => confirm && cancel.mutate(confirm.id, { onSuccess: () => setConfirm(null) })} />
    </>
  );
}

/** My attendance corrections. */
export function MyRegularizationList({ items }: { items: Regularization[] }) {
  return (
    <ul className="grid gap-2" aria-label="My correction requests">
      {items.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-e1 sm:flex-row sm:items-center">
          <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex">
            <Wrench className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <span className="tnum">{fmtDate(r.date, "EEE d MMM yyyy")}</span>
              <span className="inline-flex items-center gap-1">
                <StatusBadge code={r.current_status} size="xs" />
                <ArrowRight className="size-3 text-muted-foreground" aria-label="to" />
                <StatusBadge code={r.requested_status} size="xs" />
              </span>
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.reason}</p>
            {r.decision_note && (
              <p className="mt-1 flex items-start gap-1 text-xs text-foreground/80">
                <MessageSquareQuote className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />{r.decision_note}
              </p>
            )}
          </div>
          <RequestStatusBadge status={r.status} className="self-start sm:self-center" />
        </li>
      ))}
    </ul>
  );
}
