import * as React from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { queryClient } from "@/lib/query";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { CycleProvider } from "@/lib/cycle";
import type { Role } from "@/lib/types";
import { TooltipProvider } from "@/components/ui/misc";
import { AppShell } from "@/components/layout/app-shell";
import { homeFor } from "@/components/layout/nav";
import { Skeleton } from "@/components/ui/misc";
import { LoginPage, ForgotPasswordPage, ResetPasswordPage } from "@/pages/auth";

const DashboardPage = React.lazy(() => import("@/pages/dashboard"));
const AttendancePage = React.lazy(() => import("@/pages/attendance"));
const ImportPage = React.lazy(() => import("@/pages/import"));
const EmployeesPage = React.lazy(() => import("@/pages/employees"));
const EmployeeProfilePage = React.lazy(() => import("@/pages/employee-profile"));
const LeavePage = React.lazy(() => import("@/pages/leave"));
const HolidaysPage = React.lazy(() => import("@/pages/holidays"));
const ReportsPage = React.lazy(() => import("@/pages/reports"));
const AuditPage = React.lazy(() => import("@/pages/audit"));
const SettingsPage = React.lazy(() => import("@/pages/settings"));
const NotificationsPage = React.lazy(() => import("@/pages/notifications"));
// HR-only version: self-service pages are not routed. Re-enable together with the "Me" nav section.
// const MeOverviewPage = React.lazy(() => import("@/pages/me-overview"));
// const MeAttendancePage = React.lazy(() => import("@/pages/me-attendance"));
// const MeLeavePage = React.lazy(() => import("@/pages/me-leave"));

function PageFallback() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

function Guard({ roles, children }: { roles?: Role[]; children: React.ReactNode }) {
  const { user, role, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="p-8"><PageFallback /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (roles && role && !roles.includes(role)) return <Navigate to={homeFor(role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { role } = useAuth();
  if (role === "employee" || role === "accounts") return <Navigate to={homeFor(role)} replace />;
  return <DashboardPage />;
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="bottom-right" richColors closeButton
    toastOptions={{ classNames: { toast: "!rounded-xl !shadow-e3 !font-sans" } }} />;
}

const HR: Role[] = ["hr_admin"];
const STAFF: Role[] = ["hr_admin", "manager"];
// const WITH_SELF: Role[] = ["hr_admin", "manager", "employee"]; // self-service routes (disabled)

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={250}>
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route element={<Guard><CycleProvider><AppShell /></CycleProvider></Guard>}>
                  <Route path="/" element={<S><Home /></S>} />
                  <Route path="/attendance" element={<S roles={STAFF}><AttendancePage /></S>} />
                  <Route path="/import" element={<S roles={HR}><ImportPage /></S>} />
                  <Route path="/employees" element={<S roles={["hr_admin", "manager", "accounts"]}><EmployeesPage /></S>} />
                  <Route path="/employees/:id" element={<S><EmployeeProfilePage /></S>} />
                  <Route path="/leave" element={<S roles={STAFF}><LeavePage /></S>} />
                  <Route path="/holidays" element={<S><HolidaysPage /></S>} />
                  <Route path="/reports" element={<S roles={["hr_admin", "accounts"]}><ReportsPage /></S>} />
                  <Route path="/audit" element={<S roles={HR}><AuditPage /></S>} />
                  <Route path="/settings" element={<S roles={HR}><SettingsPage /></S>} />
                  <Route path="/notifications" element={<S><NotificationsPage /></S>} />
                  {/* HR-only version — self-service routes disabled:
                  <Route path="/me" element={<S roles={WITH_SELF}><MeOverviewPage /></S>} />
                  <Route path="/me/attendance" element={<S roles={WITH_SELF}><MeAttendancePage /></S>} />
                  <Route path="/me/leave" element={<S roles={WITH_SELF}><MeLeavePage /></S>} /> */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
              <ThemedToaster />
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function S({ roles, children }: { roles?: Role[]; children: React.ReactNode }) {
  return <Guard roles={roles}><React.Suspense fallback={<PageFallback />}>{children}</React.Suspense></Guard>;
}
