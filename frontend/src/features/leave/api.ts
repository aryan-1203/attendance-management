import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { components } from "@/api/schema";
import { client, unwrap } from "@/lib/api";
import type { Employee } from "@/lib/types";

type S = components["schemas"];
export type Balances = S["Balances"];
export type CarryForward = S["CarryForwardOut"];
export type CarryForwardRow = S["CarryForwardRow"];
export type Encashment = S["EncashmentOut"];
export type DayDetail = S["DayDetail"];

/** `/api/employees/{id}/profile` returns a plain dict — typed locally. */
export interface Profile {
  employee: Employee;
  manager: { id: number; code: string; full_name: string } | null;
  balances: Balances;
  current_cycle: { id: number; label: string };
  summary: S["CycleSummaryOut"];
  heatmap: { date: string; status: string | null }[];
}

export const leaveKeys = {
  balances: (emp: number | undefined) => ["balances", emp] as const,
  ledger: (emp: number | undefined) => ["ledger", emp] as const,
  compOffs: (emp: number | undefined) => ["comp-offs", emp] as const,
  requests: (f: object) => ["leave-requests", f] as const,
  regularizations: (f: object) => ["regularizations", f] as const,
  inbox: ["approvals-inbox"] as const,
};

export function useBalances(employeeId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: leaveKeys.balances(employeeId),
    enabled: enabled && !!employeeId,
    queryFn: async () => (await unwrap(client.GET("/api/leave/balances", {
      params: { query: { employee_id: employeeId } },
    }))) as unknown as Balances,
  });
}

export function useLedger(employeeId: number | undefined, limit = 500) {
  return useQuery({
    queryKey: [...leaveKeys.ledger(employeeId), limit],
    enabled: !!employeeId,
    queryFn: () => unwrap(client.GET("/api/employees/{emp_id}/ledger", {
      params: { path: { emp_id: employeeId! }, query: { limit } },
    })),
  });
}

export function useCompOffs(employeeId: number | undefined) {
  return useQuery({
    queryKey: leaveKeys.compOffs(employeeId),
    enabled: !!employeeId,
    queryFn: () => unwrap(client.GET("/api/employees/{emp_id}/comp-offs", { params: { path: { emp_id: employeeId! } } })),
  });
}

export function useProfile(employeeId: number | undefined | null) {
  return useQuery({
    queryKey: ["profile", employeeId],
    enabled: !!employeeId,
    queryFn: async () => (await unwrap(client.GET("/api/employees/{emp_id}/profile", {
      params: { path: { emp_id: employeeId! } },
    }))) as unknown as Profile,
  });
}

export function useSummary(employeeId: number | undefined | null, cycleId: number | undefined, self = true) {
  return useQuery({
    queryKey: ["summary", employeeId ?? undefined, cycleId],
    enabled: !!employeeId,
    queryFn: () => unwrap(client.GET("/api/attendance/summary", {
      params: { query: { cycle_id: cycleId, employee_id: self ? undefined : employeeId ?? undefined } },
    })),
  });
}

export interface RequestFilters { status?: string; scope?: "mine" | "all"; employee_id?: number; page?: number; page_size?: number }

export function useLeaveRequests(f: RequestFilters, enabled = true) {
  return useQuery({
    queryKey: leaveKeys.requests(f),
    enabled,
    placeholderData: (prev) => prev,
    queryFn: () => unwrap(client.GET("/api/leave/requests", {
      params: { query: { status: f.status || undefined, scope: f.scope, employee_id: f.employee_id,
        page: f.page ?? 1, page_size: f.page_size ?? 25 } },
    })),
  });
}

export function useRegularizations(f: Omit<RequestFilters, "employee_id">, enabled = true) {
  return useQuery({
    queryKey: leaveKeys.regularizations(f),
    enabled,
    placeholderData: (prev) => prev,
    queryFn: () => unwrap(client.GET("/api/regularizations", {
      params: { query: { status: f.status || undefined, scope: f.scope, page: f.page ?? 1, page_size: f.page_size ?? 25 } },
    })),
  });
}

/** Everything a leave / ledger / attendance change can affect. */
export function invalidateLeaveData(qc: QueryClient) {
  for (const k of ["approvals-count", "approvals-inbox", "notifications", "summary", "profile", "grid", "balances",
    "ledger", "comp-offs", "leave-requests", "regularizations", "dashboard", "employee", "pay-days", "carry-forward",
    "encashment"]) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
}
