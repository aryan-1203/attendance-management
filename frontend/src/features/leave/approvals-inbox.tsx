import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowRight, Check, Info, MessageSquarePlus, Palmtree, Paperclip, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { client, download, errorMessage, unwrap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { LeaveRequest, Regularization } from "@/lib/types";
import { cn, downloadBlob, fmtDate, num } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { PersonAvatar, Skeleton, Tooltip } from "@/components/ui/misc";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { easeOut } from "@/components/shared/motion";
import { invalidateLeaveData, leaveKeys } from "./api";
import { decide, type DecisionVars } from "./actions";
import { LEAVE_TYPE_LABEL, PayBreakdown, dayWord, fmtRange, parseUtc, payParts } from "./format";
import { Segmented } from "./segmented";

export type InboxItem =
  | { kind: "leave"; key: string; created_at: string; data: LeaveRequest }
  | { kind: "regularization"; key: string; created_at: string; data: Regularization };

export function useInbox(enabled = true) {
  const { user, role } = useAuth();
  return useQuery({
    queryKey: leaveKeys.inbox,
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [l, r] = await Promise.all([
        unwrap(client.GET("/api/leave/requests", { params: { query: { status: "pending", page_size: 200 } } })),
        unwrap(client.GET("/api/regularizations", { params: { query: { status: "pending", page_size: 200 } } })),
      ]);
      const items: InboxItem[] = [
        ...l.items.map((d) => ({ kind: "leave" as const, key: `l${d.id}`, created_at: d.created_at, data: d })),
        ...r.items.map((d) => ({ kind: "regularization" as const, key: `r${d.id}`, created_at: d.created_at, data: d })),
      ];
      // managers can't decide their own requests — those go to HR
      const mine = role === "manager" ? user?.employee_id : undefined;
      return items.filter((i) => mine === undefined || i.data.employee_id !== mine)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
  });
}

/** Unified approvals inbox (leave + corrections) with optimistic removal. */
export function ApprovalsInbox() {
  const qc = useQueryClient();
  const inbox = useInbox();
  const [filter, setFilter] = React.useState<"" | "leave" | "regularization">("");
  const reduce = useReducedMotion();

  const m = useMutation({
    mutationFn: decide,
    onMutate: async (v: DecisionVars) => {
      await qc.cancelQueries({ queryKey: leaveKeys.inbox });
      const prev = qc.getQueryData<InboxItem[]>(leaveKeys.inbox);
      qc.setQueryData<InboxItem[]>(leaveKeys.inbox, (old) => old?.filter((i) => !(i.kind === v.kind && i.data.id === v.id)));
      qc.setQueryData<number>(["approvals-count"], (c) => (typeof c === "number" ? Math.max(0, c - 1) : c));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(leaveKeys.inbox, ctx.prev);
    },
    onSuccess: (_r, v) => {
      const what = v.kind === "leave" ? "Leave" : "Correction";
      toast.success(`${what} ${v.action === "approve" ? "approved" : "rejected"}`, {
        description: v.action === "approve" ? (v.kind === "leave" ? "Marked on the grid and posted to the ledger." :
          "Attendance updated and pay days recalculated.") : "The employee has been notified.",
      });
    },
    onSettled: () => invalidateLeaveData(qc),
  });

  if (inbox.isLoading) {
    return (
      <div className="grid gap-3" aria-busy="true" aria-label="Loading approvals">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[148px] rounded-xl" />)}
      </div>
    );
  }
  if (inbox.isError) return <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />;

  const all = inbox.data ?? [];
  const items = all.filter((i) => !filter || i.kind === filter);
  const nLeave = all.filter((i) => i.kind === "leave").length;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Show" value={filter} onChange={setFilter} options={[
          { value: "", label: "All", count: all.length },
          { value: "leave", label: "Leave", count: nLeave },
          { value: "regularization", label: "Corrections", count: all.length - nLeave },
        ]} />
        <p className="text-xs text-muted-foreground">Oldest first · paid/LOP shown is the estimate when the request was made.</p>
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border bg-card shadow-e1">
          <EmptyState art="check" title="You're all caught up"
            description={all.length ? "Nothing in this filter." : "No leave or attendance corrections are waiting for a decision."} />
        </div>
      ) : (
        <ul className="grid gap-3" aria-label="Pending approvals">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((item) => (
              <motion.li key={item.key} layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.98, transition: { duration: 0.22 } }}
                transition={{ duration: 0.3, ease: easeOut }}>
                <InboxCard item={item} busy={m.isPending && m.variables?.id === item.data.id && m.variables.kind === item.kind}
                  onDecide={(action, note) => m.mutate({ kind: item.kind, id: item.data.id, action, note })} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

function InboxCard({ item, onDecide, busy }: {
  item: InboxItem; onDecide: (a: "approve" | "reject", note?: string) => void; busy: boolean;
}) {
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const noteId = React.useId();
  const emp = item.data.employee;
  const waited = formatDistanceToNowStrict(parseUtc(item.created_at), { addSuffix: false });
  const isLeave = item.kind === "leave";
  const lopDays = isLeave ? payParts(item.data.days, item.data.paid_days_estimate, item.data.lop_days_estimate).lop : 0;

  return (
    <article aria-label={`${isLeave ? "Leave request" : "Attendance correction"} from ${emp.full_name}`}
      className={cn("rounded-xl border bg-card p-4 shadow-e1 transition-shadow hover:shadow-e2",
        lopDays > 0 && "border-l-4 border-l-destructive/60")}>
      <div className="flex gap-3">
        <PersonAvatar name={emp.full_name} src={emp.photo_url} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-semibold">{emp.full_name}</p>
            <span className="text-xs text-muted-foreground">{emp.code}</span>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset",
              isLeave ? "bg-status-l/10 text-status-l-fg ring-status-l/25" : "bg-primary/10 text-primary ring-primary/20")}>
              {isLeave ? <Palmtree className="size-3" aria-hidden /> : <Wrench className="size-3" aria-hidden />}
              {isLeave ? LEAVE_TYPE_LABEL[item.data.leave_type] ?? "Leave" : "Correction"}
            </span>
            <span className="ml-auto text-2xs text-muted-foreground">
              <time dateTime={item.created_at} title={fmtDate(parseUtc(item.created_at), "d MMM yyyy, HH:mm")}>waiting {waited}</time>
            </span>
          </div>

          {item.kind === "leave" ? (
            <>
              <p className="mt-1 text-sm tnum">
                <span className="font-medium">{fmtRange(item.data.start_date, item.data.end_date, item.data.is_half_day)}</span>
                <span className="text-muted-foreground"> · {dayWord(num(item.data.days))}</span>
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <PayBreakdown days={item.data.days} paid={item.data.paid_days_estimate} lop={item.data.lop_days_estimate} />
                {item.data.attachment_path && (
                  <button type="button"
                    onClick={async () => {
                      try {
                        const { blob, filename } = await download(`/api/leave/attachments/${item.data.attachment_path!.split("/").pop()}`);
                        downloadBlob(blob, filename);
                      } catch (e) { toast.error(errorMessage(e)); }
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded text-2xs font-medium text-primary hover:underline">
                    <Paperclip className="size-3" aria-hidden />View attachment
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium tnum">{fmtDate(item.data.date, "EEE d MMM yyyy")}</span>
              <span className="inline-flex items-center gap-1.5">
                <StatusBadge code={item.data.current_status} showLabel size="xs" />
                <ArrowRight className="size-3.5 text-muted-foreground" aria-label="change to" />
                <StatusBadge code={item.data.requested_status} showLabel size="xs" />
              </span>
            </p>
          )}

          <blockquote className="mt-2 border-l-2 pl-2.5 text-sm text-foreground/80">{item.data.reason}</blockquote>
          {lopDays > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden />
              Approving will deduct {dayWord(lopDays)} as loss of pay unless the balance changes before then.
            </p>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {noteOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: easeOut }} className="overflow-hidden">
            <div className="mt-3 grid gap-1.5 sm:pl-[52px]">
              <label htmlFor={noteId} className="text-xs font-medium">Note to {emp.full_name.split(" ")[0]} <span className="font-normal text-muted-foreground">(optional)</span></label>
              <Textarea id={noteId} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
                placeholder="e.g. Approved — please hand over the client calls to Arjun" autoFocus />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 sm:pl-[52px]">
        {!noteOpen && (
          <Button variant="ghost" size="sm" className="mr-auto" onClick={() => setNoteOpen(true)}>
            <MessageSquarePlus />Add note
          </Button>
        )}
        <Tooltip content="Reject and notify the employee">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onDecide("reject", note)}
            className="text-destructive hover:bg-destructive/10" aria-label={`Reject request from ${emp.full_name}`}>
            <X />Reject
          </Button>
        </Tooltip>
        <Button size="sm" disabled={busy} onClick={() => onDecide("approve", note)}
          className="bg-success text-success-foreground hover:bg-success/90" aria-label={`Approve request from ${emp.full_name}`}>
          <Check />Approve
        </Button>
      </div>
    </article>
  );
}
