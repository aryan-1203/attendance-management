import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Banknote, CheckCircle2 } from "lucide-react";
import { client, unwrap } from "@/lib/api";
import type { Employee } from "@/lib/types";
import { fmtDate, isoDate } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { InlineAlert } from "@/components/shared/page";

function useInvalidate(id: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["profile", id] });
    qc.invalidateQueries({ queryKey: ["ledger", id] });
    qc.invalidateQueries({ queryKey: ["employees"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
  };
}

export function ConfirmProbationDialog({ employee, open, onOpenChange }: {
  employee: Employee; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const invalidate = useInvalidate(employee.id);
  const [date, setDate] = React.useState("");
  React.useEffect(() => {
    if (open) {
      const t = isoDate(new Date());
      const pe = employee.probation_end_date;
      setDate(pe && pe <= t ? pe : t);
    }
  }, [open, employee.probation_end_date]);
  const error = !date ? "Pick a confirmation date" : date < employee.date_of_joining ? "Can't be before the date of joining" : undefined;
  const m = useMutation({
    mutationFn: () => unwrap(client.POST("/api/employees/{emp_id}/confirm", {
      params: { path: { emp_id: employee.id } }, body: { confirmation_date: date },
    })),
    onSuccess: () => {
      toast.success(`${employee.full_name} confirmed`, { description: "Locked probation balance is released from the confirmation date." });
      invalidate();
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(v) => !m.isPending && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm probation</DialogTitle>
          <DialogDescription>
            {employee.full_name} becomes a permanent employee. Leave locked during probation moves to the usable balance.
          </DialogDescription>
        </DialogHeader>
        <form id="confirm-form" onSubmit={(e) => { e.preventDefault(); if (!error) m.mutate(); }} className="grid gap-3">
          <Field label="Confirmation date" htmlFor="confirm-date" error={date ? error : undefined} required
            hint={employee.probation_end_date ? `Probation ends ${fmtDate(employee.probation_end_date)}` : undefined}>
            <Input id="confirm-date" type="date" value={date} min={employee.date_of_joining} onChange={(e) => setDate(e.target.value)}
              aria-invalid={!!(date && error) || undefined} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
          <Button type="submit" form="confirm-form" loading={m.isPending} disabled={!!error}><CheckCircle2 />Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RecordExitDialog({ employee, open, onOpenChange }: {
  employee: Employee; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const invalidate = useInvalidate(employee.id);
  const [date, setDate] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [done, setDone] = React.useState<Employee | null>(null);
  React.useEffect(() => {
    if (open) { setDate(isoDate(new Date())); setReason(""); setTouched(false); setDone(null); }
  }, [open]);
  const error = !date ? "Pick the last working day" : date < employee.date_of_joining ? "Can't be before the date of joining" : undefined;
  const m = useMutation({
    mutationFn: () => unwrap(client.POST("/api/employees/{emp_id}/exit", {
      params: { path: { emp_id: employee.id } }, body: { exit_date: date, reason: reason.trim() || null },
    })),
    onSuccess: (e) => {
      toast.success(`Exit recorded for ${employee.full_name}`);
      invalidate();
      setDone(e);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(v) => !m.isPending && onOpenChange(v)}>
      <DialogContent>
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-success" />Exit recorded</DialogTitle>
              <DialogDescription>
                {employee.full_name}'s last working day is {fmtDate(done.exit_date)}. Days after it show as Exited, and
                the final cycle is pro-rated.
              </DialogDescription>
            </DialogHeader>
            <InlineAlert tone="info" icon={<Banknote className="size-4" />} title="Next: settle leave encashment">
              Review the remaining usable balance and post the encashment before the cycle is locked.
            </InlineAlert>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Done</Button>
              <Link to={`/leave?tab=encashment&employee=${employee.id}`} className={buttonVariants()}>
                Preview encashment<ArrowRight />
              </Link>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Record exit</DialogTitle>
              <DialogDescription>Set the last working day. Attendance after this date becomes “Exited”.</DialogDescription>
            </DialogHeader>
            <form id="exit-form" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!error) m.mutate(); }}>
              <Field label="Last working day" htmlFor="exit-date" error={touched || date ? error : undefined} required>
                <Input id="exit-date" type="date" value={date} min={employee.date_of_joining} onChange={(e) => setDate(e.target.value)}
                  aria-invalid={!!error || undefined} />
              </Field>
              <Field label="Reason" htmlFor="exit-reason" hint="Optional — visible in the audit log.">
                <Textarea id="exit-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Resignation, end of contract, …" />
              </Field>
            </form>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
              <Button type="submit" form="exit-form" variant="destructive" loading={m.isPending} disabled={!!error}>Record exit</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DeleteEmployeeDialog({ employee, open, onOpenChange }: {
  employee: Employee; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => unwrap(client.DELETE("/api/employees/{emp_id}", { params: { path: { emp_id: employee.id } } })),
    onSuccess: () => {
      toast.success(`${employee.full_name} removed`, { description: "The record is archived and kept in the audit log." });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.removeQueries({ queryKey: ["profile", employee.id] });
      onOpenChange(false);
      navigate("/employees", { replace: true });
    },
  });
  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange} destructive loading={m.isPending}
      title={`Delete ${employee.full_name}?`} confirmLabel={m.isPending ? "Deleting…" : "Delete employee"}
      description="The employee is hidden from lists, grids and reports. History stays in the audit log. Use “Record exit” instead if they are leaving."
      onConfirm={() => m.mutate()} />
  );
}
