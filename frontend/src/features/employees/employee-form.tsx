import * as React from "react";
import { useForm, Controller, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BriefcaseBusiness, CalendarDays, Contact, IdCard, Wallet } from "lucide-react";
import { ApiError, client, errorMessage, unwrap } from "@/lib/api";
import type { Employee } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDepartments, useDesignations, useSettingValue } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersonAvatar } from "@/components/ui/misc";
import { InlineAlert } from "@/components/shared/page";
import { EMPLOYMENT_TYPES, WEEKDAYS, parseWeeklyOff, useManagers } from "./shared";

const NONE = "none";
const optionalDate = z.string();

const schema = z.object({
  code: z.string().trim().min(1, "Employee code is required").max(30, "Use at most 30 characters"),
  full_name: z.string().trim().min(1, "Full name is required").max(150, "Use at most 150 characters"),
  photo_url: z.string().trim().max(500).refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v),
    "Enter a full image URL starting with https://"),
  department_id: z.string(),
  designation_id: z.string(),
  manager_id: z.string(),
  date_of_joining: z.string().min(1, "Date of joining is required"),
  probation_end_date: optionalDate,
  confirmation_date: optionalDate,
  exit_date: optionalDate,
  exit_reason: z.string().max(500, "Use at most 500 characters"),
  employment_type: z.enum(["probation", "permanent", "contract", "intern"]),
  weekly_off: z.array(z.number().int().min(0).max(6)),
  email: z.string().trim().refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email address"),
  phone: z.string().trim().max(30, "Use at most 30 characters").regex(/^[+\d\s().-]*$/, "Use digits, spaces and + ( ) - only"),
  date_of_birth: optionalDate,
}).superRefine((v, ctx) => {
  const doj = v.date_of_joining;
  if (!doj) return;
  const after: [keyof typeof v, string][] = [
    ["probation_end_date", "Probation end"], ["confirmation_date", "Confirmation"], ["exit_date", "Exit date"],
  ];
  after.forEach(([k, label]) => {
    const val = v[k] as string;
    if (val && val < doj) ctx.addIssue({ code: "custom", path: [k], message: `${label} can't be before the date of joining` });
  });
  if (v.date_of_birth && v.date_of_birth >= doj) {
    ctx.addIssue({ code: "custom", path: ["date_of_birth"], message: "Date of birth must be before the date of joining" });
  }
});

export type EmployeeFormValues = z.infer<typeof schema>;

function toValues(e?: Employee): EmployeeFormValues {
  return {
    code: e?.code ?? "", full_name: e?.full_name ?? "", photo_url: e?.photo_url ?? "",
    department_id: e?.department_id ? String(e.department_id) : NONE,
    designation_id: e?.designation_id ? String(e.designation_id) : NONE,
    manager_id: e?.manager_id ? String(e.manager_id) : NONE,
    date_of_joining: e?.date_of_joining ?? "", probation_end_date: e?.probation_end_date ?? "",
    confirmation_date: e?.confirmation_date ?? "", exit_date: e?.exit_date ?? "", exit_reason: e?.exit_reason ?? "",
    employment_type: (EMPLOYMENT_TYPES.some((t) => t.value === e?.employment_type) ? e!.employment_type : "probation") as
      EmployeeFormValues["employment_type"],
    weekly_off: e ? parseWeeklyOff(e.weekly_off) : [6],
    email: e?.email ?? "", phone: e?.phone ?? "", date_of_birth: e?.date_of_birth ?? "",
  };
}

function toPayload(v: EmployeeFormValues) {
  const id = (s: string) => (s === NONE || s === "" ? null : Number(s));
  const opt = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    code: v.code.trim(), full_name: v.full_name.trim(), photo_url: opt(v.photo_url),
    department_id: id(v.department_id), designation_id: id(v.designation_id), manager_id: id(v.manager_id),
    date_of_joining: v.date_of_joining, probation_end_date: opt(v.probation_end_date),
    confirmation_date: opt(v.confirmation_date), exit_date: opt(v.exit_date), exit_reason: opt(v.exit_reason),
    employment_type: v.employment_type,
    weekly_off: [...v.weekly_off].sort((a, b) => a - b).join(","),
    email: opt(v.email), phone: opt(v.phone), date_of_birth: opt(v.date_of_birth),
  };
}

type Payload = ReturnType<typeof toPayload>;

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 rounded-xl border bg-card p-4 shadow-e1">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center gap-2 text-sm font-semibold" aria-hidden>
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">{icon}</span>
        {title}
      </div>
      {children}
    </fieldset>
  );
}

/** Create / edit employee sheet (HR). Same form for both; edit sends only changed fields. */
export function EmployeeFormSheet({ open, onOpenChange, employee, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; employee?: Employee; onSaved?: (e: Employee) => void;
}) {
  const isEdit = !!employee;
  const qc = useQueryClient();
  const depts = useDepartments();
  const desigs = useDesignations();
  const managers = useManagers(open);
  const probationMonths = useSettingValue<number>("probation_months");
  const form = useForm<EmployeeFormValues>({ resolver: zodResolver(schema), defaultValues: toValues(employee), mode: "onTouched" });
  const { register, control, handleSubmit, formState: { errors, dirtyFields, isDirty }, reset, watch, setError, setFocus } = form;

  React.useEffect(() => { if (open) reset(toValues(employee)); }, [open, employee, reset]);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: async (body: Partial<Payload>) => {
      if (employee) {
        return unwrap(client.PATCH("/api/employees/{emp_id}", { params: { path: { emp_id: employee.id } }, body }));
      }
      return unwrap(client.POST("/api/employees", { body: body as Payload }));
    },
    onSuccess: (emp) => {
      toast.success(isEdit ? `Saved changes to ${emp.full_name}` : `${emp.full_name} added`, {
        description: isEdit ? "Balances and open cycles were recalculated where needed." : `Employee code ${emp.code}`,
      });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["profile", emp.id] });
      qc.invalidateQueries({ queryKey: ["ledger", emp.id] });
      qc.invalidateQueries({ queryKey: ["managers"] });
      onSaved?.(emp);
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.code === "duplicate_code" || e.status === 409)) {
        setError("code", { message: e.message });
        setFocus("code");
        return;
      }
      toast.error(errorMessage(e));
    },
  });

  const onSubmit = (v: EmployeeFormValues) => {
    const full = toPayload(v);
    if (!employee) return save.mutate(full);
    const changed: Partial<Payload> = {};
    (Object.keys(dirtyFields) as (keyof EmployeeFormValues)[]).forEach((k) => {
      (changed as Record<string, unknown>)[k] = full[k as keyof Payload];
    });
    if (!Object.keys(changed).length) { onOpenChange(false); return; }
    save.mutate(changed);
  };
  const onInvalid = (errs: FieldErrors<EmployeeFormValues>) => {
    const first = Object.keys(errs)[0] as keyof EmployeeFormValues | undefined;
    if (first && first !== "weekly_off") setFocus(first);
  };

  const photo = watch("photo_url");
  const name = watch("full_name");
  const exitDate = watch("exit_date");
  const type = watch("employment_type");
  const mgrs = (managers.data ?? []).filter((m) => m.id !== employee?.id);
  const err = (k: keyof EmployeeFormValues) => errors[k]?.message as string | undefined;
  const aria = (k: keyof EmployeeFormValues) => ({
    "aria-invalid": !!errors[k] || undefined, "aria-describedby": errors[k] ? `emp-${k}-error` : undefined,
  });

  const selectField = (k: "department_id" | "designation_id" | "manager_id", label: string,
    options: { value: string; label: string }[], loading: boolean) => (
    <Field label={label} htmlFor={`emp-${k}`} error={err(k)}>
      <Controller control={control} name={k} render={({ field }) => (
        <Select value={field.value} onValueChange={field.onChange} disabled={loading}>
          <SelectTrigger id={`emp-${k}`} onBlur={field.onBlur} aria-label={label}>
            <SelectValue placeholder={loading ? "Loading…" : "Not set"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not set</SelectItem>
            {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )} />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }}>
      <DialogContent side="right" className="flex max-w-xl flex-col gap-0 p-0" aria-describedby="emp-form-desc">
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle>{isEdit ? `Edit ${employee.full_name}` : "Add employee"}</DialogTitle>
          <DialogDescription id="emp-form-desc">
            {isEdit ? "Changes to dates, type or weekly offs recalculate balances and open cycles."
              : "Create an employee master record. Fields marked * are required."}
          </DialogDescription>
        </DialogHeader>
        <form id="employee-form" onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate
          className="grid flex-1 gap-4 overflow-y-auto bg-surface-sunken/40 px-6 py-5 scrollbar-thin">
          <Section icon={<IdCard />} title="Identity">
            <div className="flex items-center gap-3">
              <PersonAvatar name={name || "New employee"} src={photo && /^https?:\/\//.test(photo) ? photo : null} size={52} />
              <p className="text-xs text-muted-foreground">Photo preview updates as you type a URL. Initials are used when there is no photo.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
              <Field label="Employee code" htmlFor="emp-code" error={err("code")} required>
                <Input id="emp-code" autoComplete="off" placeholder="E1042" className="font-mono uppercase" {...aria("code")}
                  {...register("code")} />
              </Field>
              <Field label="Full name" htmlFor="emp-full_name" error={err("full_name")} required>
                <Input id="emp-full_name" autoComplete="off" placeholder="e.g. Shraddha Rajeshirke" {...aria("full_name")} {...register("full_name")} />
              </Field>
            </div>
            <Field label="Photo URL" htmlFor="emp-photo_url" error={err("photo_url")}>
              <Input id="emp-photo_url" type="url" inputMode="url" placeholder="https://…" {...aria("photo_url")} {...register("photo_url")} />
            </Field>
          </Section>

          <Section icon={<BriefcaseBusiness />} title="Role">
            <div className="grid gap-4 sm:grid-cols-2">
              {selectField("department_id", "Department",
                (depts.data ?? []).map((d) => ({ value: String(d.id), label: d.name })), depts.isLoading)}
              {selectField("designation_id", "Designation",
                (desigs.data ?? []).map((d) => ({ value: String(d.id), label: d.name })), desigs.isLoading)}
              {selectField("manager_id", "Reporting manager",
                mgrs.map((m) => ({ value: String(m.id), label: `${m.full_name} · ${m.code}` })), managers.isLoading)}
              <Field label="Employment type" htmlFor="emp-employment_type" error={err("employment_type")} required>
                <Controller control={control} name="employment_type" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="emp-employment_type" aria-label="Employment type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </Field>
            </div>
          </Section>

          <Section icon={<CalendarDays />} title="Key dates">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date of joining" htmlFor="emp-date_of_joining" error={err("date_of_joining")} required>
                <Input id="emp-date_of_joining" type="date" {...aria("date_of_joining")} {...register("date_of_joining")} />
              </Field>
              <Field label="Probation end" htmlFor="emp-probation_end_date" error={err("probation_end_date")}
                hint={!isEdit && type === "probation" ? `Blank = DOJ + ${probationMonths ?? 6} months` : undefined}>
                <Input id="emp-probation_end_date" type="date" {...aria("probation_end_date")} {...register("probation_end_date")} />
              </Field>
              <Field label="Confirmation date" htmlFor="emp-confirmation_date" error={err("confirmation_date")}>
                <Input id="emp-confirmation_date" type="date" {...aria("confirmation_date")} {...register("confirmation_date")} />
              </Field>
              <Field label="Exit date" htmlFor="emp-exit_date" error={err("exit_date")}>
                <Input id="emp-exit_date" type="date" {...aria("exit_date")} {...register("exit_date")} />
              </Field>
              <Field label="Date of birth" htmlFor="emp-date_of_birth" error={err("date_of_birth")}>
                <Input id="emp-date_of_birth" type="date" {...aria("date_of_birth")} {...register("date_of_birth")} />
              </Field>
            </div>
            {exitDate && (
              <Field label="Exit reason" htmlFor="emp-exit_reason" error={err("exit_reason")}>
                <Textarea id="emp-exit_reason" rows={2} placeholder="Resignation, end of contract…" {...register("exit_reason")} />
              </Field>
            )}
          </Section>

          <Section icon={<Wallet />} title="Schedule">
            <Controller control={control} name="weekly_off" render={({ field }) => (
              <div className="grid gap-1.5">
                <span id="emp-weekly-off-label" className="text-sm font-medium">Weekly off</span>
                <div role="group" aria-labelledby="emp-weekly-off-label" className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((d) => {
                    const on = field.value.includes(d.value);
                    return (
                      <button key={d.value} type="button" aria-pressed={on} aria-label={d.long}
                        onClick={() => field.onChange(on ? field.value.filter((x) => x !== d.value)
                          : [...field.value, d.value].sort((a, b) => a - b))}
                        className={cn("h-9 min-w-11 cursor-pointer rounded-lg border px-2.5 text-sm font-medium transition-colors duration-fast",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                          on ? "border-primary bg-primary text-primary-foreground shadow-e1" : "bg-surface hover:bg-muted")}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {field.value.length ? `Off every ${field.value.map((x) => WEEKDAYS[x].long).join(" & ")}.` : "No weekly off — every day is a working day."}
                </p>
              </div>
            )} />
          </Section>

          <Section icon={<Contact />} title="Contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Work email" htmlFor="emp-email" error={err("email")}>
                <Input id="emp-email" type="email" autoComplete="off" placeholder="name@company.com" {...aria("email")} {...register("email")} />
              </Field>
              <Field label="Phone" htmlFor="emp-phone" error={err("phone")}>
                <Input id="emp-phone" type="tel" inputMode="tel" placeholder="+91 98765 43210" {...aria("phone")} {...register("phone")} />
              </Field>
            </div>
          </Section>
          {Object.keys(errors).length > 1 && (
            <InlineAlert tone="destructive" title="Please fix the highlighted fields">
              {Object.keys(errors).length} fields need attention.
            </InlineAlert>
          )}
        </form>
        <div className="glass sticky bottom-0 flex flex-col-reverse gap-2 border-t px-6 py-3 sm:flex-row sm:items-center sm:justify-end safe-bottom">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="employee-form" loading={save.isPending} disabled={isEdit && !isDirty}>
            {isEdit ? "Save changes" : "Add employee"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
