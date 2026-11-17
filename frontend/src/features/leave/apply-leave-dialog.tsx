import * as React from "react";
import type { Employee } from "@/lib/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { ApplyLeaveForm } from "./apply-leave-form";
import { EmployeePicker } from "./employee-picker";

/** Sheet with the shared apply form. `onBehalf` adds an employee picker + "approve immediately" (HR). */
export function ApplyLeaveDialog({ open, onOpenChange, onBehalf = false, allowAutoApprove = false, defaultStart,
  defaultEnd }: {
  open: boolean; onOpenChange: (v: boolean) => void; onBehalf?: boolean; allowAutoApprove?: boolean;
  defaultStart?: string; defaultEnd?: string;
}) {
  const [emp, setEmp] = React.useState<Employee | null>(null);
  React.useEffect(() => { if (!open) setEmp(null); }, [open]);
  const pickerId = React.useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" className="max-w-lg content-start">
        <DialogHeader>
          <DialogTitle>{onBehalf ? "Record leave" : "Apply for leave"}</DialogTitle>
          <DialogDescription>
            {onBehalf
              ? "Record leave for an employee. The preview uses their balance and the same deduction rules."
              : "Leave is taken from your usable balance first, then comp-off if you choose it; anything beyond becomes loss of pay."}
          </DialogDescription>
        </DialogHeader>
        {onBehalf && (
          <Field label="Employee" htmlFor={pickerId} required>
            <EmployeePicker id={pickerId} value={emp} onChange={setEmp} status="active" />
          </Field>
        )}
        {/* key: remount the form (fresh preview) when the target employee changes */}
        <ApplyLeaveForm key={emp?.id ?? "self"} employeeId={onBehalf ? emp?.id : undefined}
          employeeName={onBehalf ? emp?.full_name : undefined} disabled={onBehalf && !emp}
          allowAutoApprove={onBehalf && allowAutoApprove} defaultStart={defaultStart} defaultEnd={defaultEnd}
          onCancel={() => onOpenChange(false)} onSuccess={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
