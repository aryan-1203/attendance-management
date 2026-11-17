import * as React from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { ArrowLeft, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { client, errorMessage, unwrap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { LogoMark } from "@/components/layout/logo";
import { homeFor } from "@/components/layout/nav";
import { passwordSchema } from "@/components/layout/change-password";
import { InlineAlert } from "@/components/shared/page";
import { CycleRing } from "@/components/shared/rings";
import { STATUS } from "@/lib/status";

function AuthLayout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  React.useEffect(() => { document.title = `${title} · ProsParity`; }, [title]);
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden border-r bg-[hsl(226_45%_10%)] text-white lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div aria-hidden className="absolute inset-0 opacity-90"
          style={{ background: "radial-gradient(800px 500px at 10% 0%, hsl(226 80% 45% / .55), transparent 60%), radial-gradient(600px 400px at 100% 100%, hsl(36 95% 55% / .25), transparent 60%)" }} />
        <div className="relative flex items-center gap-2.5">
          <LogoMark />
          <span className="text-lg font-semibold tracking-tight">ProsParity</span>
        </div>
        <div className="relative">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mb-10 flex items-center gap-8">
            <div className="rounded-3xl bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur [&_*]:!text-white">
              <CycleRing day={29} days={31} size={150} label="demo" />
            </div>
            <div className="grid gap-2">
              {(["P", "A", "HD", "L", "H"] as const).map((c, i) => {
                const m = STATUS[c];
                const Icon = m.icon;
                return (
                  <motion.div key={c} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + i * 0.07 }}
                    className="flex items-center gap-2 rounded-full bg-white/8 px-3 py-1 text-sm ring-1 ring-white/10">
                    <Icon className="size-4" style={{ color: m.color }} aria-hidden /> <b>{c}</b>
                    <span className="text-white/70">{m.label}</span>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-balance">
            Attendance, leave and pay-days — calculated right, every cycle.
          </h2>
          <p className="mt-3 max-w-md text-white/65">
            One immutable leave ledger, probation-aware accruals, and an Accounts-ready pay-days report with a click.
          </p>
        </div>
        <p className="relative text-xs text-white/45">© {new Date().getFullYear()} ProsParity</p>
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden"><LogoMark /><span className="font-semibold">ProsParity</span></div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </motion.div>
      </div>
    </div>
  );
}

const loginSchema = z.object({ email: z.string().email("Enter a valid email"), password: z.string().min(1, "Enter your password") });

export function LoginPage() {
  const { login, user, role, expiredReason } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), mode: "onSubmit", reValidateMode: "onChange" });
  if (user) return <Navigate to={(loc.state as { from?: string })?.from ?? homeFor(role)} replace />;
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const me = await login(v.email, v.password);
      nav((loc.state as { from?: string })?.from ?? homeFor(me.role_name as never), { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });
  const e = form.formState.errors;
  return (
    <AuthLayout title="Welcome back" subtitle="HR sign-in for ProsParity attendance & pay-days.">
      {expiredReason && <InlineAlert tone="info" className="mb-4">{expiredReason}</InlineAlert>}
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Work email" htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!e.email}
            aria-describedby={e.email ? "email-error" : undefined} {...form.register("email")} />
        </Field>
        <Field label="Password" htmlFor="password" error={e.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!e.password}
            {...form.register("password")} />
        </Field>
        <div className="-mt-1 flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">Forgot password?</Link>
        </div>
        {error && <InlineAlert tone="destructive">{error}</InlineAlert>}
        <Button type="submit" size="lg" loading={form.formState.isSubmitting}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = React.useState<string | null>(null);
  const [devToken, setDevToken] = React.useState<string | null>(null);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().email("Enter a valid email") })) });
  const submit = form.handleSubmit(async (v) => {
    try {
      const r = await unwrap(client.POST("/api/auth/forgot-password", { body: v }));
      setSent(v.email);
      setDevToken((r.data as { dev_token?: string } | null)?.dev_token ?? null);
    } catch (e) { toast.error(errorMessage(e)); }
  });
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a secure link that's valid for 30 minutes.">
      {sent ? (
        <div className="grid gap-4">
          <InlineAlert tone="success" icon={<MailCheck className="size-4" />} title="Check your inbox">
            If {sent} is registered, a reset link is on its way.
          </InlineAlert>
          {devToken && (
            <InlineAlert tone="info" title="Development mode">
              Emails are logged instead of sent. <Link className="font-medium text-primary underline" to={`/reset-password?token=${devToken}`}>Open reset link</Link>
            </InlineAlert>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label="Work email" htmlFor="fp-email" error={form.formState.errors.email?.message}>
            <Input id="fp-email" type="email" autoComplete="username" autoFocus {...form.register("email")} />
          </Field>
          <Button type="submit" size="lg" loading={form.formState.isSubmitting}>Send reset link</Button>
        </form>
      )}
      <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />Back to sign in
      </Link>
    </AuthLayout>
  );
}

const resetSchema = z.object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get("token") ?? "";
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), mode: "onTouched" });
  const [error, setError] = React.useState<string | null>(null);
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await unwrap(client.POST("/api/auth/reset-password", { body: { token, new_password: v.password } }));
      toast.success("Password updated. Sign in with your new password.");
      nav("/login");
    } catch (e) { setError(errorMessage(e)); }
  });
  const e = form.formState.errors;
  return (
    <AuthLayout title="Choose a new password" subtitle="8+ characters with an uppercase, lowercase, number and symbol.">
      {!token ? <InlineAlert tone="destructive">This link is missing its token. Request a new one.</InlineAlert> : (
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label="New password" htmlFor="rp-pw" error={e.password?.message}>
            <Input id="rp-pw" type="password" autoComplete="new-password" autoFocus aria-invalid={!!e.password} {...form.register("password")} />
          </Field>
          <Field label="Confirm password" htmlFor="rp-confirm" error={e.confirm?.message}>
            <Input id="rp-confirm" type="password" autoComplete="new-password" aria-invalid={!!e.confirm} {...form.register("confirm")} />
          </Field>
          {error && <InlineAlert tone="destructive">{error}</InlineAlert>}
          <Button type="submit" size="lg" loading={form.formState.isSubmitting}>Update password</Button>
        </form>
      )}
      <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />Back to sign in
      </Link>
    </AuthLayout>
  );
}
