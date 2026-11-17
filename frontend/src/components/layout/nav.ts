import {
  CalendarCheck2, CalendarDays, FileSpreadsheet, History, LayoutDashboard, Settings, Upload, Users,
  ClipboardCheck, type LucideIcon,
} from "lucide-react";
// Self-service icons (disabled in the HR-only version): BarChart3, UserRound, Palmtree
import type { Role } from "@/lib/types";

export interface NavItem { to: string; label: string; icon: LucideIcon; roles: Role[]; badge?: "approvals" }

export const NAV: { section: string; items: NavItem[] }[] = [
  { section: "Workspace", items: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["hr_admin", "manager", "accounts"] },
    { to: "/attendance", label: "Attendance", icon: CalendarCheck2, roles: ["hr_admin", "manager"] },
    { to: "/leave", label: "Leave management", icon: ClipboardCheck, roles: ["hr_admin", "manager"] },
    { to: "/employees", label: "Employees", icon: Users, roles: ["hr_admin", "manager", "accounts"] },
  ] },
  { section: "Payroll", items: [
    { to: "/reports", label: "Cycle close & reports", icon: FileSpreadsheet, roles: ["hr_admin", "accounts"] },
    { to: "/import", label: "Excel import", icon: Upload, roles: ["hr_admin"] },
    { to: "/holidays", label: "Holiday calendar", icon: CalendarDays, roles: ["hr_admin", "manager", "employee", "accounts"] },
  ] },
  // HR-only version: HR marks attendance and records leave for everyone, so there is no self-service
  // ("Me") section. Re-enable these entries (and the /me routes in App.tsx) when employees get logins.
  // { section: "Me", items: [
  //   { to: "/me", label: "My overview", icon: UserRound, roles: ["hr_admin", "manager", "employee"] },
  //   { to: "/me/attendance", label: "My attendance", icon: BarChart3, roles: ["hr_admin", "manager", "employee"] },
  //   { to: "/me/leave", label: "My leave", icon: Palmtree, roles: ["hr_admin", "manager", "employee"] },
  // ] },
  { section: "Admin", items: [
    { to: "/audit", label: "Audit log", icon: History, roles: ["hr_admin"] },
    { to: "/settings", label: "Settings", icon: Settings, roles: ["hr_admin"] },
  ] },
];

export function homeFor(role: Role | null): string {
  // HR-only version: there is no self-service home ("/me"); employees have no login.
  if (role === "employee") return "/holidays";
  if (role === "accounts") return "/reports";
  return "/";
}
