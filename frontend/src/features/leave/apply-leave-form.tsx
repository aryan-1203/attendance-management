import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle, ArrowLeftRight, CalendarDays, CheckCircle2, Info, Loader2, Palmtree, Paperclip, Send, X,
} from "lucide-react";
import { toast } from "sonner";
import { client, errorMessage, unwrap, upload } from "@/lib/api";
import type { LeavePreview, LeaveRequest } from "@/lib/types";
import { cn, fmtDate, fmtDays, num } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Skeleton, Switch } from "@/components/ui/misc"; // Checkbox: used by the (disabled) approve-immediately toggle
import { InlineAlert } from "@/components/shared/page";
import { easeOut } from "@/components/shared/motion";
import { invalidateLeaveData } from "./api";
import { useDebounced } from "./employee-picker";
import { PayBar, dayWord } from "./format";

const schema = z.object({
  start_date: z.string().min(1, "Pick a start date"),
  end_date: z.string().min(1, "Pick an end date"),
  is_half_day: z.boolean(),
  leave_type: z.enum(["paid", "comp_off"]),
  reason: z.string().trim().min(3, "Add a short reason for your approver (3+ characters)").max(2000, "Keep it under 2000 characters"),
  auto_approve: z.boolean(),
}).refine((v) => !v.start_date || !v.end_date || v.end_date >= v.start_date, {
  path: ["end_date"], message: "End date can't be before the start date",
}).refine((v) => !v.is_half_day || v.start_date === v.end_date, {
  path: ["is_half_day"], message: "Half-day applies to a single date",
});
type FormValues = z.infer<typeof schema>;

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";

export interface ApplyLeaveFormProps {
  /** Target employee; omit to apply for the signed-in user. */
  employeeId?: number;
  /** Shown in copy when applying on someone's behalf. */
  employeeName?: string;
  /** HR only: offer "approve immediately". */
  allowAutoApprove?: boolean;
  defaultStart?: string;
  defaultEnd?: string;
  onSuccess?: (req: LeaveRequest) => void;
  onCancel?: () => void;
  className?: string;
  /** Disable everything (e.g. no employee chosen yet). */
  disabled?: boolean;
}

/** Reusable apply-leave form with a live paid/LOP preview from the engine. */
export function ApplyLeaveForm({ employeeId, employeeName, allowAutoApprove, defaultStart = "", defaultEnd,
  onSuccess, onCancel, className, disabled }: ApplyLeaveFormProps) {
  const qc = useQueryClient();
  const uid = React.useId();
  const [attachment, setAttachment] = React.useState<{ path: string; filename: string } | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { start_date: defaultStart, end_date: defaultEnd ?? defaultStart, is_half_day: false,
      leave_type: "paid", reason: "", auto_approve: true },
  });
  const { register, control, watch, setValue, handleSubmit, formState: { errors } } = form;
  const [start, end, half, type, reason] = watch(["start_date", "end_date", "is_half_day", "leave_type", "reason"]);
  const singleDay = !!start && start === end;

  // keep the range sane while typing
  React.useEffect(() => {
    if (start && (!end || end < start)) setValue("end_date", start, { shouldValidate: !!end });
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!singleDay && half) setValue("is_half_day", false);
  }, [singleDay, half, setValue]);

  const params = useDebounced({ start, end, half, type, employeeId }, 350);
  const validRange = !!params.start && !!params.end && params.end >= params.start;
  const preview = useQuery({
    queryKey: ["leave-preview", params],
    enabled: validRange && !disabled,
    retry: false,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    queryFn: () => unwrap(client.POST("/api/leave/preview", {
      body: { start_date: params.start, end_date: params.end, is_half_day: params.half && params.start === params.end,
        leave_type: params.type, employee_id: params.employeeId },
    })),
  });
  const stale = preview.isFetching || params.start !== start || params.end !== end || params.half !== half ||
    params.type !== type;

  const apply = useMutation({
    meta: { silent: true },
    mutationFn: (v: FormValues) => unwrap(client.POST("/api/leave/requests", {
      body: { start_date: v.start_date, end_date: v.end_date, is_half_day: v.is_half_day && v.start_date === v.end_date,
        leave_type: v.leave_type, reason: v.reason.trim(), attachment_path: attachment?.path ?? null,
        employee_id: employeeId, auto_approve: !!allowAutoApprove && v.auto_approve },
    })),
    onSuccess: (req) => {
      const approved = req.status === "approved";
      toast.success(approved ? "Leave recorded and approved" : "Leave request sent", {
        description: `${dayWord(num(req.days))} · ${fmtDate(req.start_date, "d MMM")}${req.end_date !== req.start_date ?
          ` – ${fmtDate(req.end_date, "d MMM")}` : ""}${approved ? "" : " — your approver has been notified."}`,
      });
      invalidateLeaveData(qc);
      form.reset();
      setAttachment(null);
      setSubmitError(null);
      onSuccess?.(req);
    },
    onError: (e) => setSubmitError(errorMessage(e)),
  });

  const onFile = async (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) { setFileError("Attachment must be under 5 MB"); return; }
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(f.name)) { setFileError("Attach a PDF or an image (PNG, JPG, WEBP)"); return; }
    setUploading(true);
    try {
      const r = await upload<{ path: string; filename?: string }>("/api/leave/attachments", f);
      setAttachment({ path: r.path, filename: r.filename ?? f.name });
    } catch (e) {
      setFileError(errorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const pv = preview.data;
  const noDays = !!pv && num(pv.days) === 0 && !stale;
  const ids = { start: `${uid}-start`, end: `${uid}-end`, half: `${uid}-half`, reason: `${uid}-reason`, file: `${uid}-file`,
    auto: `${uid}-auto` };

  return (
    <form noValidate onSubmit={handleSubmit((v) => { setSubmitError(null); apply.mutate(v); })}
      className={cn("grid gap-5", className)} aria-label={employeeName ? `Apply leave for ${employeeName}` : "Apply for leave"}>
      <fieldset disabled={disabled || apply.isPending} className="grid gap-5 disabled:opacity-60">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor={ids.start} error={errors.start_date?.message} required>
            <Input id={ids.start} type="date" {...register("start_date")} aria-invalid={!!errors.start_date}
              aria-describedby={errors.start_date ? `${ids.start}-error` : undefined} className="tnum" />
          </Field>
          <Field label="To" htmlFor={ids.end} error={errors.end_date?.message} required>
            <Input id={ids.end} type="date" min={start || undefined} {...register("end_date")} aria-invalid={!!errors.end_date}
              aria-describedby={errors.end_date ? `${ids.end}-error` : undefined} className="tnum" />
          </Field>
        </div>

        <div className={cn("flex items-center justify-between gap-4 rounded-lg border bg-surface-sunken/60 px-3 py-2.5",
          !singleDay && "opacity-60")}>
          <div className="min-w-0">
            <Label htmlFor={ids.half}>Half-day</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {singleDay ? "Counts as 0.5 day." : "Available when From and To are the same date."}
            </p>
          </div>
          <Controller control={control} name="is_half_day" render={({ field }) => (
            <Switch id={ids.half} checked={field.value} disabled={!singleDay} onCheckedChange={field.onChange}
              aria-describedby={errors.is_half_day ? `${ids.half}-error` : undefined} />
          )} />
        </div>

        <Controller control={control} name="leave_type" render={({ field }) => (
          <div className="grid gap-1.5">
            <span className="text-sm font-medium" id={`${uid}-type`}>Leave type</span>
            <div role="radiogroup" aria-labelledby={`${uid}-type`} className="grid grid-cols-2 gap-2"
              onKeyDown={(e) => {
                if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                  e.preventDefault();
                  field.onChange(field.value === "paid" ? "comp_off" : "paid");
                  const next = e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${field.value === "paid" ? "comp_off" : "paid"}"]`);
                  next?.focus();
                }
              }}>
              {([["paid", "Paid leave", Palmtree, pv?.balance.usable], ["comp_off", "Comp-off", ArrowLeftRight, pv?.balance.comp_off]] as const)
                .map(([value, label, Icon, bal]) => {
                  const on = field.value === value;
                  return (
                    <button key={value} type="button" role="radio" aria-checked={on} data-value={value}
                      tabIndex={on ? 0 : -1} onClick={() => field.onChange(value)}
                      className={cn("flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left " +
                        "transition-[background-color,border-color,box-shadow] duration-base focus-visible:outline-none " +
                        "focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "border-primary/50 bg-primary/10 shadow-e1 ring-1 ring-primary/30" : "bg-surface hover:bg-muted/60")}>
                      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md",
                        value === "paid" ? "bg-status-l/10 text-status-l-fg" : "bg-status-co/10 text-status-co-fg")}>
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{label}</span>
                        <span className="block text-2xs text-muted-foreground tnum">
                          {bal !== undefined ? `${fmtDays(bal)} available` : "—"}
                        </span>
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        )} />

        <PreviewPanel preview={pv} loading={preview.isLoading && validRange} stale={stale && !!pv}
          error={preview.isError && !stale ? errorMessage(preview.error) : null} hasRange={validRange}
          leaveType={type} onBehalf={!!employeeName} />

        <Field label="Reason" htmlFor={ids.reason} error={errors.reason?.message} required
          hint={`${reason.trim().length}/2000 · visible to your approver`}>
          <Textarea id={ids.reason} rows={3} placeholder="e.g. Family function in Pune"
            {...register("reason")} aria-invalid={!!errors.reason}
            aria-describedby={errors.reason ? `${ids.reason}-error` : undefined} />
        </Field>

        <div className="grid gap-1.5">
          <Label htmlFor={ids.file}>Attachment <span className="font-normal text-muted-foreground">(optional)</span></Label>
          {attachment ? (
            <div className="flex items-center gap-2 rounded-lg border bg-surface px-3 py-2 text-sm shadow-e1">
              <Paperclip className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${attachment.filename}`}
                onClick={() => setAttachment(null)}><X /></Button>
            </div>
          ) : (
            <label htmlFor={ids.file}
              className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-dashed bg-surface-sunken/50 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 focus-within:ring-2 focus-within:ring-ring">
              {uploading ? <Loader2 className="size-4 animate-spin text-primary" aria-hidden /> : <Paperclip className="size-4" aria-hidden />}
              <span>{uploading ? "Uploading…" : "Add a medical certificate or document"}</span>
              <span className="ml-auto text-2xs">PDF or image · max 5 MB</span>
              <input ref={fileRef} id={ids.file} type="file" accept={ACCEPT} className="sr-only" disabled={uploading}
                onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
          )}
          {fileError && <p role="alert" className="text-xs font-medium text-destructive">{fileError}</p>}
        </div>

        {/* HR-only version: leave recorded by HR is always applied immediately (auto_approve defaults to true).
            Re-enable this toggle when approval workflows are rolled out.
        {allowAutoApprove && (
          <Controller control={control} name="auto_approve" render={({ field }) => (
            ...Approve immediately checkbox...
          )} />
        )} */}
      </fieldset>

      {submitError && <InlineAlert tone="destructive" title="Couldn't submit">{submitError}</InlineAlert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={apply.isPending}>Cancel</Button>}
        <Button type="submit" loading={apply.isPending} disabled={disabled || uploading || noDays}>
          {!apply.isPending && <Send />}
          {allowAutoApprove && watch("auto_approve") ? "Record leave" : "Send request"}
        </Button>
      </div>
    </form>
  );
}

function PreviewPanel({ preview, loading, stale, error, hasRange, leaveType, onBehalf }: {
  preview: LeavePreview | undefined; loading: boolean; stale: boolean; error: string | null; hasRange: boolean;
  leaveType: "paid" | "comp_off"; onBehalf: boolean;
}) {
  const reduce = useReducedMotion();
  const [showAll, setShowAll] = React.useState(false);
  const who = onBehalf ? "their" : "your";

  if (!hasRange) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed bg-surface-sunken/40 px-4 py-4 text-sm text-muted-foreground">
        <CalendarDays className="size-5 shrink-0 text-primary/70" aria-hidden />
        Pick dates to see exactly how much is paid and whether any of it becomes loss of pay.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="grid gap-3 rounded-xl border bg-card p-4" aria-busy="true" aria-label="Calculating preview">
        <Skeleton className="h-4 w-40" /><Skeleton className="h-2.5 w-full" /><Skeleton className="h-4 w-64" />
      </div>
    );
  }
  if (error) return <InlineAlert tone="destructive" title="These dates can't be used">{error}</InlineAlert>;
  if (!preview) return null;

  const days = num(preview.days), paid = num(preview.paid_days), co = num(preview.comp_off_days), lop = num(preview.lop_days);
  const usable = num(preview.balance.usable), locked = num(preview.balance.locked), compBal = num(preview.balance.comp_off);
  const dates = preview.working_dates;
  const shown = showAll ? dates : dates.slice(0, 10);
  const order = leaveType === "comp_off" ? "comp-off first, then usable balance" : "usable balance first";

  return (
    <motion.section aria-live="polite" aria-label="Leave preview" initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: stale ? 0.6 : 1, y: 0 }} transition={{ duration: 0.25, ease: easeOut }}
      className={cn("grid gap-3 rounded-xl border p-4 shadow-e1",
        preview.has_lop ? "border-destructive/30 bg-destructive/[0.04]" : days ? "border-success/25 bg-success/[0.04]" : "bg-card")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Preview</p>
          <p className="mt-0.5 text-lg font-semibold tracking-tight tnum">
            {days ? dayWord(days) : "No working days"}
            {stale && <Loader2 className="ml-2 inline size-4 animate-spin text-muted-foreground" aria-label="Updating" />}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>Balance before</p>
          <p className="tnum text-sm font-semibold text-foreground">
            {fmtDays(usable)} <span className="font-normal text-muted-foreground">usable</span>
            {compBal > 0 && <> · {fmtDays(compBal)} <span className="font-normal text-muted-foreground">comp-off</span></>}
          </p>
        </div>
      </div>

      {days > 0 && (
        <>
          <PayBar paid={paid} compOff={co} lop={lop} />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <li className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-success" aria-hidden />
              <b className="tnum font-semibold">{fmtDays(paid)}</b> paid</li>
            {co > 0 && <li className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-status-co" aria-hidden />
              <b className="tnum font-semibold">{fmtDays(co)}</b> comp-off</li>}
            <li className={cn("inline-flex items-center gap-1.5", lop > 0 && "text-destructive")}>
              <span className="size-2 rounded-full bg-destructive" aria-hidden /><b className="tnum font-semibold">{fmtDays(lop)}</b> LOP</li>
          </ul>
        </>
      )}

      <AnimatePresence initial={false} mode="wait">
        {preview.has_lop ? (
          <motion.div key="lop" initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
            <InlineAlert tone="destructive" title={preview.message} icon={<AlertTriangle className="size-4" />}>
              {who === "your" ? "You don't" : "They don't"} have enough balance for the whole range, so {dayWord(lop)} will be
              deducted from pay as loss of pay (LOP). Leave is taken from {order}; anything beyond becomes LOP.
            </InlineAlert>
          </motion.div>
        ) : days > 0 ? (
          <motion.p key="ok" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" aria-hidden />{preview.message} — fully covered by {who} balance.
          </motion.p>
        ) : null}
      </AnimatePresence>

      {dates.length > 0 && (
        <div className="grid gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">Working days counted</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Working days counted">
            {shown.map((d) => (
              <li key={d} className="rounded-md bg-surface px-1.5 py-0.5 text-2xs font-medium shadow-e1 ring-1 ring-inset ring-border tnum">
                {fmtDate(d, "EEE d MMM")}
              </li>
            ))}
            {dates.length > 10 && (
              <li>
                <button type="button" onClick={() => setShowAll((v) => !v)}
                  className="cursor-pointer rounded-md px-1.5 py-0.5 text-2xs font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {showAll ? "Show less" : `+${dates.length - 10} more`}
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
      <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
        <Info className="mt-px size-3 shrink-0" aria-hidden />
        <span>
          Sundays, weekly offs and holidays in the range are paid and not counted. Leave accrues 1.5 days per salary cycle
          (20th → 19th), so ranges in later cycles can use leave accrued by then.
          {locked > 0 && <> {fmtDays(locked)} locked probation day{locked === 1 ? " is" : "s are"} not usable until confirmation.</>}
        </span>
      </p>
    </motion.section>
  );
}
