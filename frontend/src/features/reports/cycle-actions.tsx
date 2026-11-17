import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info, LockOpen, Mail, Send } from "lucide-react";
import { client, unwrap } from "@/lib/api";
import type { Cycle } from "@/lib/types";
import { qk, useSettingValue } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/shared/page";
import type { EmailResult } from "./types";

export function UnlockCycleDialog({ cycle, open, onOpenChange }: { cycle: Cycle; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => { if (open) { setReason(""); setTouched(false); } }, [open]);
  const error = reason.trim().length < 5 ? "Give a reason of at least 5 characters — it's recorded in the audit log" : undefined;
  const m = useMutation({
    mutationFn: () => unwrap(client.POST("/api/cycles/{cycle_id}/unlock", { params: { path: { cycle_id: cycle.id } },
      body: { reason: reason.trim() } })),
    onSuccess: () => {
      toast.success(`${cycle.label} unlocked`, { description: "Figures are live again. Lock it once corrections are done." });
      qc.invalidateQueries({ queryKey: qk.cycles });
      qc.invalidateQueries({ queryKey: ["pay-days", cycle.id] });
      qc.invalidateQueries({ queryKey: ["close-checks", cycle.id] });
      qc.invalidateQueries({ queryKey: ["grid"] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(v) => !m.isPending && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unlock {cycle.label}?</DialogTitle>
          <DialogDescription>
            The frozen snapshot is discarded and attendance/leave become editable again. Accounts lose access to this cycle's reports until it is re-locked.
          </DialogDescription>
        </DialogHeader>
        <form id="unlock-form" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!error) m.mutate(); }}>
          <Field label="Reason for unlocking" htmlFor="unlock-reason" required error={touched ? error : undefined}
            hint="e.g. “Late leave approval for E1042 changes LOP”">
            <Textarea id="unlock-reason" rows={3} maxLength={500} value={reason} autoFocus
              onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)}
              aria-invalid={(touched && !!error) || undefined} aria-describedby={touched && error ? "unlock-reason-error" : undefined} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
          <Button type="submit" form="unlock-form" variant="destructive" loading={m.isPending}><LockOpen />Unlock cycle</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailAccountsDialog({ cycle, open, onOpenChange }: { cycle: Cycle; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const fallback = useSettingValue<string>("accounts_email");
  const [to, setTo] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => { if (open) { setTo(""); setTouched(false); } }, [open]);
  const list = to.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const bad = list.filter((x) => !EMAIL_RE.test(x));
  const error = bad.length ? `Not a valid email: ${bad.join(", ")}` : !list.length && !fallback ? "Add a recipient, or set the Accounts email in Settings" : undefined;
  const m = useMutation({
    mutationFn: async () => (await unwrap(client.POST("/api/reports/email-accounts", {
      params: { query: { cycle_id: cycle.id } }, body: { to: list.length ? list : null } }))) as unknown as EmailResult,
    onSuccess: (r) => {
      if (r.mode === "logged") {
        toast.info("Email logged, not sent", {
          description: `Dev mode: no SMTP host is configured, so the message to ${r.sent_to.join(", ")} was saved to the server outbox. Set SMTP in Settings to send for real.`,
          duration: 9000,
        });
      } else {
        toast.success(`Pay-days report emailed to ${r.sent_to.join(", ")}`);
      }
      qc.invalidateQueries({ queryKey: ["report-runs"] });
      onOpenChange(false);
    },
  });
  const provisional = cycle.status !== "locked";
  return (
    <Dialog open={open} onOpenChange={(v) => !m.isPending && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="size-5 text-primary" aria-hidden />Email pay-days to Accounts</DialogTitle>
          <DialogDescription>Sends the {cycle.label} pay-days report as Excel + PDF attachments, with a totals summary in the body.</DialogDescription>
        </DialogHeader>
        {provisional && (
          <InlineAlert tone="warning" title="This cycle isn't locked yet">
            The email will be marked PROVISIONAL. Lock the cycle first if these are final numbers.
          </InlineAlert>
        )}
        <form id="email-form" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!error) m.mutate(); }}>
          <Field label="Recipients" htmlFor="email-to" error={touched ? error : undefined}
            hint={fallback ? `Leave empty to send to ${fallback} (from Settings). Separate several with commas.` : "Separate several addresses with commas."}>
            <Input id="email-to" type="text" inputMode="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)}
              onBlur={() => setTouched(true)} placeholder={fallback || "accounts@company.com"}
              aria-invalid={(touched && !!error) || undefined} />
          </Field>
        </form>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />Each email is recorded under “Recent report runs” and in the audit log.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
          <Button type="submit" form="email-form" loading={m.isPending} disabled={touched && !!error}><Send />Send report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
