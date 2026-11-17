import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Send } from "lucide-react";
import { toast } from "sonner";
import { client, errorMessage, unwrap } from "@/lib/api";
import { SETTABLE, STATUS } from "@/lib/status";
import { fmtDate, isoDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineAlert } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { invalidateLeaveData } from "@/features/leave/api";

const today = () => isoDate(new Date());
const schema = z.object({
  date: z.string().min(1, "Pick the date to correct").refine((d) => d <= today(), "You can only correct past or current dates"),
  requested_status: z.string().min(1, "Choose what the day should be"),
  reason: z.string().trim().min(5, "Explain the correction (at least 5 characters)").max(2000),
});
type V = z.infer<typeof schema>;

/** Employee "request correction" (regularization) dialog. */
export function RegularizationDialog({ open, onOpenChange, date, currentStatus }: {
  open: boolean; onOpenChange: (v: boolean) => void; date?: string; currentStatus?: string | null;
}) {
  const qc = useQueryClient();
  const uid = React.useId();
  const [err, setErr] = React.useState<string | null>(null);
  const { register, control, handleSubmit, reset, watch, formState: { errors } } = useForm<V>({
    resolver: zodResolver(schema), mode: "onTouched",
    defaultValues: { date: date ?? today(), requested_status: "", reason: "" },
  });
  React.useEffect(() => {
    if (open) { reset({ date: date ?? today(), requested_status: "", reason: "" }); setErr(null); }
  }, [open, date, reset]);
  const requested = watch("requested_status");
  const chosenDate = watch("date");
  const showCurrent = !!date && chosenDate === date && currentStatus && currentStatus !== "-";

  const m = useMutation({
    meta: { silent: true },
    mutationFn: (v: V) => unwrap(client.POST("/api/regularizations", {
      body: { date: v.date, requested_status: v.requested_status, reason: v.reason.trim() },
    })),
    onSuccess: (r) => {
      toast.success("Correction requested", {
        description: `${fmtDate(r.date, "EEE d MMM")}: ${r.current_status ?? "unmarked"} → ${r.requested_status}. Your approver has been notified.`,
      });
      invalidateLeaveData(qc);
      onOpenChange(false);
    },
    onError: (e) => setErr(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a correction</DialogTitle>
          <DialogDescription>
            Something wrong on your attendance? Ask your manager to fix a day. Once approved, pay days and balances recalculate automatically.
          </DialogDescription>
        </DialogHeader>
        <form noValidate className="grid gap-4" onSubmit={handleSubmit((v) => { setErr(null); m.mutate(v); })}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor={`${uid}-date`} error={errors.date?.message} required>
              <Input id={`${uid}-date`} type="date" max={today()} className="tnum" {...register("date")}
                aria-invalid={!!errors.date} aria-describedby={errors.date ? `${uid}-date-error` : undefined} />
            </Field>
            <Field label="Should be" htmlFor={`${uid}-status`} error={errors.requested_status?.message} required>
              <Controller control={control} name="requested_status" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`${uid}-status`} aria-invalid={!!errors.requested_status} onBlur={field.onBlur}>
                    <SelectValue placeholder="Choose status" />
                  </SelectTrigger>
                  <SelectContent>
                    {SETTABLE.filter((c) => c !== currentStatus || !showCurrent).map((c) => (
                      <SelectItem key={c} value={c}>
                        <span className="inline-flex items-center gap-2"><StatusBadge code={c} size="xs" />{STATUS[c].label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </Field>
          </div>
          {showCurrent && (
            <div className="flex items-center gap-2 rounded-lg bg-surface-sunken/70 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Currently</span>
              <StatusBadge code={currentStatus} showLabel />
              <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
              {requested ? <StatusBadge code={requested} showLabel /> : <span className="text-muted-foreground">…</span>}
            </div>
          )}
          <Field label="Reason" htmlFor={`${uid}-reason`} error={errors.reason?.message} required
            hint="e.g. I was at the client site all day (on duty)">
            <Textarea id={`${uid}-reason`} rows={3} {...register("reason")} aria-invalid={!!errors.reason}
              aria-describedby={errors.reason ? `${uid}-reason-error` : undefined} />
          </Field>
          {err && <InlineAlert tone="destructive" title="Couldn't send">{err}</InlineAlert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={m.isPending}>{!m.isPending && <Send />}Send request</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
