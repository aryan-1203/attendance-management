import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ArrowRight, Lock, Minus, Palmtree, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { client, errorMessage, unwrap } from "@/lib/api";
import type { Employee } from "@/lib/types";
import { cn, fmtDays, isoDate, num } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { InlineAlert } from "@/components/shared/page";
import { invalidateLeaveData, useBalances, useLedger } from "./api";
import { EmployeePicker } from "./employee-picker";
import { BUCKET_LABEL } from "./format";
import { LedgerTimeline } from "./ledger";

export type Bucket = "usable" | "locked" | "comp_off";

const schema = z.object({
  bucket: z.enum(["usable", "locked", "comp_off"]),
  amount: z.string().trim().min(1, "Enter the number of days")
    .refine((v) => !Number.isNaN(Number(v)), "Enter a number, e.g. 1.5 or -0.5")
    .refine((v) => Number(v) !== 0, "Amount can't be zero")
    .refine((v) => Number.isInteger(Number(v) * 2), "Use steps of 0.5 day")
    .refine((v) => Math.abs(Number(v)) <= 365, "That's more than a year — check the amount"),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required (it's kept in the audit log)").max(500),
  entry_date: z.string().optional(),
});
type V = z.infer<typeof schema>;

const BUCKETS: { value: Bucket; label: string; icon: typeof Palmtree; hint: string; cls: string }[] = [
  { value: "usable", label: "Usable", icon: Palmtree, hint: "Regular paid-leave balance", cls: "bg-status-l/10 text-status-l-fg" },
  { value: "locked", label: "Locked", icon: Lock, hint: "Probation — released on confirmation", cls: "bg-status-wo/10 text-status-wo-fg" },
  { value: "comp_off", label: "Comp-off", icon: ArrowLeftRight, hint: "Credits get an expiry date", cls: "bg-status-co/10 text-status-co-fg" },
];

/** HR: manual ledger adjustment. */
export function AdjustmentsPanel({ employee, onEmployee, preset }: {
  employee: Employee | null; onEmployee: (e: Employee | null) => void;
  /** bump `n` to re-apply (e.g. "Grant comp-off" from the comp-off tab) */
  preset?: { bucket: Bucket; n: number };
}) {
  const qc = useQueryClient();
  const uid = React.useId();
  const balances = useBalances(employee?.id);
  const ledger = useLedger(employee?.id, 10);
  const [confirm, setConfirm] = React.useState<V | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const { register, control, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<V>({
    resolver: zodResolver(schema), mode: "onTouched",
    defaultValues: { bucket: preset?.bucket ?? "usable", amount: "", reason: "", entry_date: "" },
  });
  React.useEffect(() => { if (preset) setValue("bucket", preset.bucket); }, [preset, setValue]);
  const [bucket, amountRaw] = watch(["bucket", "amount"]);
  const amount = Number(amountRaw);
  const validAmount = amountRaw !== "" && !Number.isNaN(amount) && amount !== 0;
  const current = balances.data ? num(balances.data[bucket]) : undefined;
  const after = current !== undefined && validAmount ? current + amount : undefined;

  const step = (d: number) => {
    const n = Number.isNaN(amount) ? 0 : amount;
    const v = Math.round((n + d) * 2) / 2;
    setValue("amount", v === 0 ? "" : String(v), { shouldValidate: true, shouldTouch: true });
  };

  const post = useMutation({
    meta: { silent: true },
    mutationFn: (v: V) => unwrap(client.POST("/api/leave/adjustments", {
      body: { employee_id: employee!.id, bucket: v.bucket, amount: v.amount.trim(), reason: v.reason.trim(),
        entry_date: v.entry_date || null },
    })),
    onSuccess: (row) => {
      toast.success("Adjustment posted", {
        description: `${num(row.amount) > 0 ? "+" : "−"}${fmtDays(Math.abs(num(row.amount)))} ${BUCKET_LABEL[row.bucket]} for ${employee?.full_name}`,
      });
      invalidateLeaveData(qc);
      reset({ bucket: v0(row.bucket), amount: "", reason: "", entry_date: "" });
      setConfirm(null);
      setErr(null);
    },
    onError: (e) => { setErr(errorMessage(e)); setConfirm(null); },
  });

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Manual ledger adjustment</CardTitle>
          <CardDescription>Credit or debit a balance bucket. Entries are immutable and audited — to undo, post the opposite amount.</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate className="grid gap-5" onSubmit={handleSubmit((v) => { setErr(null); setConfirm(v); })}>
            <Field label="Employee" htmlFor={`${uid}-emp`} required hint={employee ? undefined : "Search by name or employee code"}>
              <EmployeePicker id={`${uid}-emp`} value={employee} onChange={onEmployee} />
            </Field>

            {employee && (
              <div className="grid grid-cols-3 gap-2" aria-label="Current balance">
                {BUCKETS.map((b) => (
                  <div key={b.value} className={cn("rounded-lg border px-3 py-2", bucket === b.value && "border-primary/40 bg-primary/5")}>
                    <p className="text-2xs text-muted-foreground">{b.label}</p>
                    {balances.isLoading ? <Skeleton className="mt-1 h-5 w-10" /> :
                      <p className="text-lg font-semibold tnum">{fmtDays(balances.data?.[b.value])}</p>}
                  </div>
                ))}
              </div>
            )}

            <Controller control={control} name="bucket" render={({ field }) => (
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-sm font-medium">Bucket</legend>
                <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
                  {BUCKETS.map((b) => {
                    const on = field.value === b.value;
                    const Icon = b.icon;
                    return (
                      <button key={b.value} type="button" role="radio" aria-checked={on} onClick={() => field.onChange(b.value)}
                        className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-[background-color,border-color] duration-base " +
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          on ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30" : "bg-surface hover:bg-muted/60")}>
                        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", b.cls)}><Icon className="size-4" aria-hidden /></span>
                        <span className="min-w-0"><span className="block text-sm font-medium">{b.label}</span>
                          <span className="block truncate text-2xs text-muted-foreground">{b.hint}</span></span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Days (signed)" htmlFor={`${uid}-amt`} required error={errors.amount?.message}
                hint="Positive credits, negative debits · steps of 0.5">
                <div className="flex items-center gap-1.5">
                  <Button type="button" variant="outline" size="icon" onClick={() => step(-0.5)} aria-label="Decrease by half a day"><Minus /></Button>
                  <Input id={`${uid}-amt`} inputMode="decimal" placeholder="e.g. 1.5 or -0.5" className="text-center tnum"
                    {...register("amount")} aria-invalid={!!errors.amount}
                    aria-describedby={errors.amount ? `${uid}-amt-error` : undefined} />
                  <Button type="button" variant="outline" size="icon" onClick={() => step(0.5)} aria-label="Increase by half a day"><Plus /></Button>
                </div>
              </Field>
              <Field label="Effective date" htmlFor={`${uid}-date`} hint="Optional · defaults to today (must be in an open cycle)">
                <Input id={`${uid}-date`} type="date" max={isoDate(new Date())} className="tnum" {...register("entry_date")} />
              </Field>
            </div>

            {employee && current !== undefined && after !== undefined && (
              <div className={cn("flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset",
                after < 0 ? "bg-destructive/10 ring-destructive/25" : "bg-primary/5 ring-primary/15")} aria-live="polite">
                <span className="text-muted-foreground">{BUCKET_LABEL[bucket]}</span>
                <span className="font-semibold tnum">{fmtDays(current)}</span>
                <ArrowRight className="size-4 text-muted-foreground" aria-label="becomes" />
                <span className={cn("font-semibold tnum", after < 0 ? "text-destructive" : amount > 0 ? "text-success" : "")}>{fmtDays(after)}</span>
                {after < 0 && <span className="text-xs text-destructive">— negative balances are rejected unless allowed in Settings.</span>}
              </div>
            )}

            <Field label="Reason" htmlFor={`${uid}-reason`} required error={errors.reason?.message}
              hint="Shown in the employee's ledger and the audit trail">
              <Textarea id={`${uid}-reason`} rows={2} placeholder="e.g. Credit for extra shift during year-end close"
                {...register("reason")} aria-invalid={!!errors.reason}
                aria-describedby={errors.reason ? `${uid}-reason-error` : undefined} />
            </Field>

            {err && <InlineAlert tone="destructive" title="Couldn't post adjustment">{err}</InlineAlert>}
            <div className="flex justify-end">
              <Button type="submit" disabled={!employee}>Review adjustment</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Recent ledger</CardTitle>
          <CardDescription>{employee ? employee.full_name : "Pick an employee to see their latest entries."}</CardDescription>
        </CardHeader>
        <CardContent>
          {!employee ? <EmptyState compact title="No employee selected" /> :
            <LedgerTimeline entries={ledger.data} loading={ledger.isLoading} limit={10} />}
        </CardContent>
      </Card>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title="Post this adjustment?"
        confirmLabel="Post to ledger" loading={post.isPending} destructive={!!confirm && Number(confirm.amount) < 0}
        description={confirm && employee ? `${Number(confirm.amount) > 0 ? "Credit" : "Debit"} ${fmtDays(Math.abs(Number(confirm.amount)))} day(s) ${
          Number(confirm.amount) > 0 ? "to" : "from"} ${employee.full_name}'s ${BUCKET_LABEL[confirm.bucket].toLowerCase()} balance.` : undefined}
        onConfirm={() => confirm && post.mutate(confirm)}>
        <InlineAlert tone="warning" icon={<ShieldAlert className="size-4" />} title="Ledger entries are permanent">
          This can't be edited or deleted. Open cycles from the effective date are recalculated automatically.
        </InlineAlert>
      </ConfirmDialog>
    </div>
  );
}

function v0(b: string): Bucket {
  return b === "locked" || b === "comp_off" ? b : "usable";
}
