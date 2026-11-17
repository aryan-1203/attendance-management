import type { PayDaysRow } from "@/lib/types";

export interface PayDaysTotals {
  eligible_days: string; lop_days: string; payable_days: string; paid_leave_used: string; comp_off_used: string; employees: number;
}

export interface PayDaysResponse {
  cycle: { id: number; label: string; status: string; start_date: string; end_date: string };
  rows: PayDaysRow[];
  totals: PayDaysTotals;
}

export interface CheckItem {
  employee_id?: number; id?: number; code?: string; full_name?: string; count?: number; dates?: string[]; issue?: string;
}

export interface CloseCheck {
  key: "cycle_ended" | "unmarked" | "pending_leave" | "pending_regularization" | "anomalies" | string;
  label: string; status: "ok" | "warning" | string; count: number; items: CheckItem[];
}

export interface CloseChecks {
  cycle_id: number; status: string; checks: CloseCheck[]; totals: PayDaysTotals; ready: boolean;
}

export interface LockResult { cycle_id: number; status: string; employees: number; totals: PayDaysTotals }

export interface EmailResult { sent_to: string[]; mode: "logged" | string; report_run_id: number }

export const reportKeys = {
  payDays: (cycleId: number | undefined) => ["pay-days", cycleId] as const,
  checks: (cycleId: number | undefined) => ["close-checks", cycleId] as const,
  runs: (cycleId: number | undefined) => ["report-runs", cycleId] as const,
};

/** Sum decimal strings without float drift (cents arithmetic). */
export function sumDec(values: (string | number | null | undefined)[]): number {
  let cents = 0;
  for (const v of values) cents += Math.round(Number(v ?? 0) * 100);
  return cents / 100;
}
