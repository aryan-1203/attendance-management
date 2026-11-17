import { EmptyState } from "@/components/shared/empty-state";

/** Shown on self-service pages when the signed-in account has no employee record. */
export function NotLinked() {
  return (
    <div className="rounded-xl border bg-card shadow-e1">
      <EmptyState art="people" title="Your account isn't linked to an employee"
        description="Self-service needs an employee record (attendance, leave balance, pay days). Ask HR to link your login to your employee profile in Settings → Users." />
    </div>
  );
}
