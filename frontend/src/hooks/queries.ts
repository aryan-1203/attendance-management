import { useQuery } from "@tanstack/react-query";
import { client, unwrap } from "@/lib/api";

export const qk = {
  cycles: ["cycles"] as const,
  grid: (cycleId: number | undefined, f: object) => ["grid", cycleId, f] as const,
  summary: (emp: number | undefined, cycle: number | undefined) => ["summary", emp, cycle] as const,
  employees: (f: object) => ["employees", f] as const,
  employee: (id: number) => ["employee", id] as const,
  profile: (id: number) => ["profile", id] as const,
  departments: ["departments"] as const,
  settings: ["settings"] as const,
  dashboard: ["dashboard"] as const,
  notifications: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
};

export function useCycles() {
  return useQuery({ queryKey: qk.cycles, staleTime: 60_000, queryFn: () => unwrap(client.GET("/api/cycles")) });
}

export function useDepartments() {
  return useQuery({ queryKey: qk.departments, staleTime: 5 * 60_000,
    queryFn: () => unwrap(client.GET("/api/departments")) });
}

export function useDesignations() {
  return useQuery({ queryKey: ["designations"], staleTime: 5 * 60_000,
    queryFn: () => unwrap(client.GET("/api/designations")) });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, staleTime: 5 * 60_000, queryFn: () => unwrap(client.GET("/api/settings")) });
}

export function useSettingValue<T = unknown>(key: string): T | undefined {
  const s = useSettings();
  return s.data?.find((x) => x.key === key)?.value as T | undefined;
}
