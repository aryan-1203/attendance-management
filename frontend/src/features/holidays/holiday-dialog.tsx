import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, client, errorMessage, unwrap } from "@/lib/api";
import type { Holiday } from "@/lib/types";
import { cn, fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { HOLIDAY_KINDS, KIND_META, type HolidayKind } from "./kinds";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  name: z.string().trim().min(1, "Give the holiday a name").max(150, "Keep it under 150 characters"),
  kind: z.enum(["public", "optional", "restricted"]),
  description: z.string().trim().max(500, "Keep it under 500 characters"),
});
type Values = z.infer<typeof schema>;

/** Friendly handling shared by holiday mutations: 423 (locked cycle) gets its own toast. */
export function toastHolidayError(e: unknown) {
  if (e instanceof ApiError && e.status === 423) {
    toast.error("That date is in a locked cycle", { description: e.message });
  } else {
    toast.error(errorMessage(e));
  }
}

export function HolidayDialog({ open, onOpenChange, holiday, defaultDate, onSaved, onDelete }: {
  open: boolean; onOpenChange: (v: boolean) => void; holiday?: Holiday | null; defaultDate?: string;
  onSaved: () => void; onDelete?: (h: Holiday) => void;
}) {
  const editing = !!holiday;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { date: "", name: "", kind: "public", description: "" },
  });
  const { register, handleSubmit, control, reset, setError, formState: { errors } } = form;

  React.useEffect(() => {
    if (!open) return;
    reset(holiday
      ? { date: holiday.date, name: holiday.name, kind: (holiday.kind as HolidayKind) ?? "public", description: holiday.description ?? "" }
      : { date: defaultDate ?? "", name: "", kind: "public", description: "" });
  }, [open, holiday, defaultDate, reset]);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (v: Values) => holiday
      ? unwrap(client.PATCH("/api/holidays/{holiday_id}", { params: { path: { holiday_id: holiday.id } }, body: v }))
      : unwrap(client.POST("/api/holidays", { body: v })),
    onSuccess: (h) => {
      toast.success(editing ? "Holiday updated" : "Holiday added", {
        description: `${h.name} · ${fmtDate(h.date, "EEE d MMM yyyy")}. Open cycles recalculated.`,
      });
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setError("name", { message: e.message });
      else if (e instanceof ApiError && e.status === 423) setError("date", { message: "This date is in a locked cycle" });
      toastHolidayError(e);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="holiday-dialog-desc">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit holiday" : "Add holiday"}</DialogTitle>
          <DialogDescription id="holiday-dialog-desc">
            Saving recalculates attendance and leave for every open cycle from this date on.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
          <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
            <Field label="Date" htmlFor="h-date" error={errors.date?.message} required>
              <Input id="h-date" type="date" className="tnum" aria-invalid={!!errors.date || undefined}
                aria-describedby={errors.date ? "h-date-error" : undefined} {...register("date")} />
            </Field>
            <Field label="Name" htmlFor="h-name" error={errors.name?.message} required>
              <Input id="h-name" placeholder="e.g. Diwali" autoComplete="off" aria-invalid={!!errors.name || undefined}
                aria-describedby={errors.name ? "h-name-error" : undefined} {...register("name")} />
            </Field>
          </div>
          <fieldset className="grid gap-1.5">
            <Label asChild><legend>Type</legend></Label>
            <Controller control={control} name="kind" render={({ field }) => (
              <KindPicker value={field.value} onChange={field.onChange} />
            )} />
          </fieldset>
          <Field label="Description" htmlFor="h-desc" error={errors.description?.message} hint="Optional — shown to employees">
            <Textarea id="h-desc" rows={3} aria-invalid={!!errors.description || undefined} {...register("description")} />
          </Field>
          <DialogFooter className="sm:justify-between">
            {editing && onDelete ? (
              <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10"
                onClick={() => holiday && onDelete(holiday)}>
                <Trash2 aria-hidden />Delete
              </Button>
            ) : <span />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" loading={save.isPending}>{editing ? "Save changes" : "Add holiday"}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KindPicker({ value, onChange }: { value: HolidayKind; onChange: (v: HolidayKind) => void }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="radiogroup" aria-label="Holiday type" className="grid gap-2 sm:grid-cols-3">
      {HOLIDAY_KINDS.map((k, i) => {
        const m = KIND_META[k];
        const Icon = m.icon;
        const on = value === k;
        return (
          <button key={k} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
            ref={(el) => { refs.current[i] = el; }}
            onClick={() => onChange(k)}
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const n = (i + d + HOLIDAY_KINDS.length) % HOLIDAY_KINDS.length;
              onChange(HOLIDAY_KINDS[n]);
              refs.current[n]?.focus();
            }}
            className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border bg-surface p-3 text-left transition-[border-color,box-shadow,background-color] duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary shadow-e1 ring-1 ring-primary" : "hover:bg-muted/60")}>
            <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2", m.swatch, k === "public" && "text-white", k === "optional" && "text-status-l-fg", k === "restricted" && "text-accent")} aria-hidden>
              <Icon className="size-3" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{m.label}</span>
              <span className="block text-2xs leading-snug text-muted-foreground">{m.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
