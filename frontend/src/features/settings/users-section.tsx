import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { toast } from "sonner";
import { Check, Eye, EyeOff, KeyRound, Search, Sparkles, UserPlus, X } from "lucide-react";
import { ApiError, client, errorMessage, unwrap } from "@/lib/api";
import { ROLE_LABEL, useAuth } from "@/lib/auth";
import type { Employee, Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersonAvatar, Skeleton, Switch, Tooltip } from "@/components/ui/misc";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/page";
import { EmployeeCombobox } from "@/features/reports/downloads";

interface UserRow {
  id: number; email: string; full_name: string; role_name: string; employee_id: number | null; is_active: boolean;
  last_login_at: string | null;
}
// HR-only version: only HR accounts can be created. Other roles exist in the backend for a later rollout:
// const ROLES: Role[] = ["hr_admin", "manager", "employee", "accounts"];
const ROLES: Role[] = ["hr_admin"];
const ROLE_HINT: Record<Role, string> = {
  hr_admin: "Full access, settings and cycle close", manager: "Marks and approves for their team",
  employee: "Self-service: own attendance and leave", accounts: "Read-only reports for locked cycles",
};

const POLICY = [
  { test: (p: string) => p.length >= 8, label: "8+ characters" },
  { test: (p: string) => /[A-Z]/.test(p), label: "Uppercase letter" },
  { test: (p: string) => /[a-z]/.test(p), label: "Lowercase letter" },
  { test: (p: string) => /\d/.test(p), label: "Number" },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: "Symbol" },
];
const strong = (p: string) => POLICY.every((r) => r.test(p));

function generatePassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%&*?"];
  const all = sets.join("");
  const rand = (n: number) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const chars = sets.map((s) => s[rand(s.length)]);
  while (chars.length < 14) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = rand(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

export const usersKey = ["users"] as const;

export function UsersSection() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [resetFor, setResetFor] = React.useState<UserRow | null>(null);
  const users = useQuery({
    queryKey: usersKey,
    queryFn: async () => (await unwrap(client.GET("/api/users"))) as unknown as UserRow[],
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { role?: string; is_active?: boolean } }) =>
      unwrap(client.PATCH("/api/users/{user_id}", { params: { path: { user_id: id } }, body })),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: usersKey });
      const prev = qc.getQueryData<UserRow[]>(usersKey);
      qc.setQueryData<UserRow[]>(usersKey, (old) => old?.map((u) => (u.id === id ? {
        ...u, ...(body.role ? { role_name: body.role } : {}), ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
      } : u)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(usersKey, ctx.prev); },
    onSuccess: (u, { body }) => {
      toast.success(body.role ? `${u.full_name} is now ${ROLE_LABEL[u.role_name as Role] ?? u.role_name}`
        : `${u.full_name} ${u.is_active ? "can sign in again" : "was deactivated and signed out"}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: usersKey }),
  });

  const q = search.trim().toLowerCase();
  const list = (users.data ?? []).filter((u) => !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users" aria-label="Search users" className="pl-9" />
        </div>
        <Button className="sm:ml-auto" onClick={() => setCreating(true)}><UserPlus />New user</Button>
      </div>
      {users.isLoading ? (
        <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : users.isError ? <ErrorState error={users.error} onRetry={() => users.refetch()} /> : !list.length ? (
        <EmptyState art={q ? "search" : "people"} compact={!!q} title={q ? "No users match" : "No users yet"} />
      ) : (
        <ul className="divide-y rounded-xl border" aria-label="Users">
          {list.map((u) => {
            const self = u.id === me?.id;
            return (
              <li key={u.id} className={cn("grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_180px_auto_auto] sm:items-center", !u.is_active && "bg-muted/30")}>
                <div className="flex min-w-0 items-center gap-3">
                  <PersonAvatar name={u.full_name} size={36} className={cn(!u.is_active && "opacity-50 grayscale")} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">{u.full_name}
                      {self && <span className="rounded-full bg-primary/10 px-1.5 text-2xs font-semibold text-primary">You</span>}
                      {!u.is_active && <span className="rounded-full bg-muted px-1.5 text-2xs font-semibold text-muted-foreground">Inactive</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}
                      <span className="hidden sm:inline"> · {u.last_login_at ? `last seen ${formatDistanceToNowStrict(parseISO(u.last_login_at), { addSuffix: true })}` : "never signed in"}</span>
                    </p>
                  </div>
                </div>
                <Select value={u.role_name} disabled={self} onValueChange={(v) => patch.mutate({ id: u.id, body: { role: v } })}>
                  <SelectTrigger aria-label={`Role for ${u.full_name}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Tooltip content={self ? "You can't deactivate your own account" : u.is_active ? "Deactivate (signs them out)" : "Reactivate"}>
                    <span className="inline-flex items-center gap-2">
                      <Switch checked={u.is_active} disabled={self} aria-label={`${u.full_name} active`}
                        onCheckedChange={(v) => patch.mutate({ id: u.id, body: { is_active: v } })} />
                      <span className="text-xs text-muted-foreground sm:hidden">{u.is_active ? "Active" : "Inactive"}</span>
                    </span>
                  </Tooltip>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setResetFor(u)} aria-label={`Set a new password for ${u.full_name}`}>
                  <KeyRound />Password
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <ResetPasswordDialog user={resetFor} onOpenChange={(v) => !v && setResetFor(null)} />
    </div>
  );
}

function PasswordInput({ id, value, onChange, invalid, describedBy }: {
  id: string; value: string; onChange: (v: string) => void; invalid?: boolean; describedBy?: string;
}) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Input id={id} type={show ? "text" : "password"} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid || undefined} aria-describedby={describedBy} className="pr-10 font-mono" />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
            className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button type="button" variant="outline" onClick={() => { onChange(generatePassword()); setShow(true); }}><Sparkles />Generate</Button>
      </div>
      <ul id={describedBy} className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Password requirements">
        {POLICY.map((r) => {
          const ok = r.test(value);
          return (
            <li key={r.label} className={cn("inline-flex items-center gap-1 text-xs transition-colors", ok ? "text-success" : "text-muted-foreground")}>
              {ok ? <Check className="size-3" aria-hidden /> : <X className="size-3 opacity-50" aria-hidden />}
              {r.label}<span className="sr-only">{ok ? " — met" : " — not met"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const createSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email address"),
  role: z.enum(["hr_admin", "manager", "employee", "accounts"]),
  password: z.string().refine(strong, "Password doesn't meet the policy yet"),
});
type CreateValues = z.infer<typeof createSchema>;

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [emp, setEmp] = React.useState<Employee | null>(null);
  const { register, handleSubmit, control, reset, setValue, getValues, setError, formState: { errors } } = useForm<CreateValues>({
    resolver: zodResolver(createSchema), defaultValues: { full_name: "", email: "", role: "hr_admin", password: "" }, mode: "onTouched",
  });
  React.useEffect(() => { if (open) { reset(); setEmp(null); } }, [open, reset]);
  const m = useMutation({
    meta: { silent: true },
    mutationFn: (v: CreateValues) => unwrap(client.POST("/api/users", { body: { ...v, employee_id: emp?.id ?? null } })),
    onSuccess: (u) => {
      toast.success(`Account created for ${u.full_name}`, { description: "Share the password securely — they can change it after signing in." });
      qc.invalidateQueries({ queryKey: usersKey });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setError("email", { message: e.message });
      else if (e instanceof ApiError && e.code === "weak_password") setError("password", { message: e.message });
      else toast.error(errorMessage(e));
    },
  });
  const pickEmployee = (e: Employee | null) => {
    setEmp(e);
    if (e) {
      if (!getValues("full_name")) setValue("full_name", e.full_name, { shouldValidate: true });
      if (!getValues("email") && e.email) setValue("email", e.email, { shouldValidate: true });
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !m.isPending && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>Give another HR team member sign-in access. Optionally link their employee record.</DialogDescription>
        </DialogHeader>
        <form id="create-user" className="grid gap-4" noValidate onSubmit={handleSubmit((v) => m.mutate(v))}>
          <div className="grid gap-1.5">
            <span id="link-emp-label" className="text-sm font-medium">Linked employee</span>
            <EmployeeCombobox value={emp} onChange={pickEmployee} labelledBy="link-emp-label" />
            <p className="text-xs text-muted-foreground">Optional for HR and Accounts users.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="nu-name" error={errors.full_name?.message} required>
              <Input id="nu-name" autoComplete="off" aria-invalid={!!errors.full_name || undefined} {...register("full_name")} />
            </Field>
            <Field label="Email" htmlFor="nu-email" error={errors.email?.message} required>
              <Input id="nu-email" type="email" autoComplete="off" aria-invalid={!!errors.email || undefined} {...register("email")} />
            </Field>
          </div>
          <Controller control={control} name="role" render={({ field }) => (
            <Field label="Role" htmlFor="nu-role" hint={ROLE_HINT[field.value]}>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="nu-role"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )} />
          <Controller control={control} name="password" render={({ field }) => (
            <Field label="Temporary password" htmlFor="nu-password" error={errors.password?.message} required>
              <PasswordInput id="nu-password" value={field.value} onChange={(v) => field.onChange(v)} invalid={!!errors.password}
                describedBy="nu-password-policy" />
            </Field>
          )} />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
          <Button type="submit" form="create-user" loading={m.isPending}><UserPlus />Create user</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onOpenChange }: { user: UserRow | null; onOpenChange: (v: boolean) => void }) {
  const [pw, setPw] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => { setPw(""); setTouched(false); }, [user]);
  const m = useMutation({
    mutationFn: () => unwrap(client.PATCH("/api/users/{user_id}", { params: { path: { user_id: user!.id } }, body: { password: pw } })),
    onSuccess: (u) => { toast.success(`Password updated for ${u.full_name}`, { description: "Their existing sessions were signed out." }); onOpenChange(false); },
  });
  return (
    <Dialog open={!!user} onOpenChange={(v) => !m.isPending && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set a new password</DialogTitle>
          <DialogDescription>{user?.full_name} ({user?.email}) will be signed out everywhere.</DialogDescription>
        </DialogHeader>
        <form id="reset-pw" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (strong(pw)) m.mutate(); }}>
          <Field label="New password" htmlFor="rp-password" error={touched && !strong(pw) ? "Password doesn't meet the policy yet" : undefined} required>
            <PasswordInput id="rp-password" value={pw} onChange={setPw} invalid={touched && !strong(pw)} describedBy="rp-password-policy" />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
          <Button type="submit" form="reset-pw" loading={m.isPending}><KeyRound />Update password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
