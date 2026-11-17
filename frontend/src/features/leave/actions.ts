import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { client, unwrap } from "@/lib/api";
import type { LeaveRequest } from "@/lib/types";
import { isoDate } from "@/lib/utils";
import { invalidateLeaveData } from "./api";

export function canCancel(r: Pick<LeaveRequest, "status" | "start_date">) {
  return r.status === "pending" || (r.status === "approved" && r.start_date > isoDate(new Date()));
}

export function useCancelLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap(client.POST("/api/leave/requests/{req_id}/cancel", { params: { path: { req_id: id } } })),
    onSuccess: (r) => {
      toast.success("Leave cancelled", {
        description: r.status === "cancelled" ? "Attendance and balances have been restored." : undefined,
      });
      invalidateLeaveData(qc);
    },
  });
}

export type DecisionKind = "leave" | "regularization";
export interface DecisionVars { kind: DecisionKind; id: number; action: "approve" | "reject"; note?: string }

export async function decide({ kind, id, action, note }: DecisionVars): Promise<{ id: number; status: string }> {
  const body = { action, note: note?.trim() || null };
  return kind === "leave"
    ? unwrap(client.POST("/api/leave/requests/{req_id}/decision", { params: { path: { req_id: id } }, body }))
    : unwrap(client.POST("/api/regularizations/{req_id}/decision", { params: { path: { req_id: id } }, body }));
}

/** Approve / reject from tables (non-optimistic). */
export function useDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: decide,
    onSuccess: (_r, v) => {
      toast.success(`${v.kind === "leave" ? "Leave" : "Correction"} ${v.action === "approve" ? "approved" : "rejected"}`);
      invalidateLeaveData(qc);
    },
  });
}
