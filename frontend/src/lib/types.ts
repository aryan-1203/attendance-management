import type { components } from "@/api/schema";

type S = components["schemas"];
export type Employee = S["EmployeeOut"];
export type Cycle = S["CycleOut"];
export type Holiday = S["HolidayOut"];
export type Grid = S["GridOut"];
export type GridRow = S["GridRow"];
export type GridDay = S["GridDay"];
export type Cell = S["Cell"];
export type CycleSummary = S["CycleSummaryOut"];
export type LeaveRequest = S["LeaveRequestOut"];
export type LeavePreview = S["LeavePreviewOut"];
export type Regularization = S["RegularizationOut"];
export type LedgerEntry = S["LedgerEntryOut"];
export type Notification = S["NotificationOut"];
export type AuditEntry = S["AuditOut"];
export type Setting = S["SettingOut"];
export type Me = S["MeOut"];
export type ImportBatch = S["ImportBatchOut"];
export type InspectOut = S["InspectOut"];
export type ImportSummary = S["ImportSummaryOut"];
export type CompOff = S["CompOffOut"];
export type Department = S["DepartmentOut"];
export type Role = "hr_admin" | "manager" | "employee" | "accounts";

export interface PayDaysRow {
  employee_id: number; code: string; full_name: string; department: string; date_of_joining: string;
  employment_type: string; cycle_days: number; eligible_days: string; weekly_offs: string; holidays: string;
  present_days: string; half_days: string; paid_leave_used: string; comp_off_used: string; lop_days: string;
  payable_days: string;
  opening_usable: string; accrued: string; used: string; closing_usable: string; closing_locked: string;
  comp_off_balance: string; remarks: string; exited_in_cycle: boolean; joined_in_cycle: boolean;
}
