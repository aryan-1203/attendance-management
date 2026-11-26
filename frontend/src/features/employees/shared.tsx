import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { CircleDot, LogOut, UserX } from "lucide-react";
import { client, unwrap } from "@/lib/api";
import type { Employee } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/ui/misc";
import { spring } from "@/components/shared/motion";

export const EMPLOYMENT_TYPES = [
  { value: "probation", label: "Probation" },
  { value: "permanent", label: "Permanent" },
  { value: "contract", label: "Contract" },
  { value: "intern", label: "Intern" },
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]["value"];

export const EMPLOYEE_STATUSES = [
  { value: "active", label: "Active" },
  { value: "exited", label: "Exited" },
  { value: "inactive", label: "Inactive" },
] as const;

/** Backend weekday numbering: 0 = Monday … 6 = Sunday. */
export const WEEKDAYS = [
  { value: 0, short: "M", label: "Mon", long: "Monday" },
  { value: 1, short: "T", label: "Tue", long: "Tuesday" },
  { value: 2, short: "W", label: "Wed", long: "Wednesday" },
  { value: 3, short: "T", label: "Thu", long: "Thursday" },
  { value: 4, short: "F", label: "Fri", long: "Friday" },
  { value: 5, short: "S", label: "Sat", long: "Saturday" },
  { value: 6, short: "S", label: "Sun", long: "Sunday" },
] as const;

export function parseWeeklyOff(v: string | null | undefined): number[] {
  return (v ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "" && /^\d$/.test(x)).map(Number)
    .filter((n) => n >= 0 && n <= 6).sort((a, b) => a - b);
}

export function weeklyOffLabel(v: string | null | undefined): string {
  const days = parseWeeklyOff(v);
  if (!days.length) return "None";
  return days.map((d) => WEEKDAYS[d].label).join(", ");
}

const TYPE_VARIANT: Record<string, "warning" | "success" | "default" | "secondary"> = {
  probation: "warning", permanent: "success", contract: "default", intern: "secondary",
};

export function EmploymentTypeBadge({ type, className }: { type: string; className?: string }) {
  const label = EMPLOYMENT_TYPES.find((t) => t.value === type.toLowerCase())?.label ?? type;
  return <Badge variant={TYPE_VARIANT[type.toLowerCase()] ?? "secondary"} className={className}>{label}</Badge>;
}

export function EmployeeStatusBadge({ status, className }: { status: string; className?: string }) {
  if (status === "active") {
    return <Badge variant="success" className={className}><CircleDot className="size-3" aria-hidden />Active</Badge>;
  }
  if (status === "exited") {
    return <Badge variant="secondary" className={className}><LogOut className="size-3" aria-hidden />Exited</Badge>;
  }
  return <Badge variant="destructive" className={className}><UserX className="size-3" aria-hidden />
    {status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}

/** Avatar that morphs between the employee list and the profile header (shared-element transition). */
export function EmployeeAvatar({ employee, size, className }: {
  employee: Pick<Employee, "id" | "full_name" | "photo_url">; size: number; className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div layoutId={reduce ? undefined : `emp-avatar-${employee.id}`} transition={spring}
      className={cn("shrink-0 rounded-full", className)} style={{ borderRadius: 9999, width: size, height: size }}>
      <PersonAvatar name={employee.full_name} src={employee.photo_url} size={size} />
    </motion.div>
  );
}

export interface ManagerOption { id: number; code: string; full_name: string }

export function useManagers(enabled = true) {
  return useQuery({
    queryKey: ["managers"], staleTime: 5 * 60_000, enabled,
    queryFn: async () => (await unwrap(client.GET("/api/meta/managers"))) as unknown as ManagerOption[],
  });
}

/* ------------------------------------------------------------------ profile payload */
export interface ProfileSummary {
  employee_id: number; cycle_id: number;
  cycle_days: number | string; eligible_days: number | string; present_days: number | string;
  half_days: number | string; absent_days: number | string; leave_days: number | string;
  weekly_offs: number | string; holidays: number | string; unmarked_days: number | string;
  pending_days: number | string; paid_leave_used: string; comp_off_used: string; lop_days: string;
  payable_days: string; opening_usable: string; accrued: string; closing_usable: string; closing_locked: string;
  remarks: string[]; warnings: string[]; on_probation: boolean;
  days: { date: string; status: string | null; paid_leave: string; lop: string; comp_off_used: string;
    comp_off_earned: string; note: string | null }[];
}

export interface Profile {
  employee: Employee;
  manager: ManagerOption | null;
  function_manager: ManagerOption | null;
  balances: { usable: string; locked: string; comp_off: string; lop?: string | null };
  current_cycle: { id: number; label: string };
  summary: ProfileSummary;
  heatmap: { date: string; status: string | null }[];
}

export const profileKey = (id: number) => ["profile", id] as const;
export const ledgerKey = (id: number) => ["ledger", id] as const;
export const compOffKey = (id: number) => ["comp-offs", id] as const;
