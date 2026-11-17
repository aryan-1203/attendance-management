import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  Building2, CalendarRange, ImageOff, Info, Mail, RefreshCcw, Save, ShieldCheck, Palmtree, Undo2,
} from "lucide-react";
import { client, errorMessage, unwrap } from "@/lib/api";
import type { Setting } from "@/lib/types";
import { cn, pluralize } from "@/lib/utils";
import { qk, useSettings } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Kbd, Separator, Skeleton } from "@/components/ui/misc";
import { ErrorState, InlineAlert, PageHeader } from "@/components/shared/page";
import { easeOut, spring } from "@/components/shared/motion";
import {
  CALC_KEYS, SettingRow, isChanged, toApi, toDraft, validate, type Draft,
} from "@/features/settings/setting-control";
import { UsersSection } from "@/features/settings/users-section";

const SECTIONS = [
  { id: "company", title: "Company profile", description: "Shown on reports, statements and the sidebar.", icon: Building2 },
  { id: "cycle", title: "Salary cycle", description: "How the pay period is defined and how unmarked days are treated.", icon: CalendarRange },
  { id: "leave", title: "Leave policy", description: "Accrual, probation and special rules used by the leave engine.", icon: Palmtree },
  { id: "email", title: "Email & SMTP", description: "Where reports go and how email is delivered.", icon: Mail },
  { id: "users", title: "Users & roles", description: "Who can sign in and what they can do.", icon: ShieldCheck },
] as const;

const LEAVE_GROUPS: { title: string; keys: string[] }[] = [
  { title: "Accrual", keys: ["accrual_per_cycle", "accrual_timing", "prorata_rounding", "leave_year_start_month"] },
  { title: "Probation", keys: ["probation_months", "probation_usable_per_cycle", "probation_usable_cumulative"] },
  { title: "Sandwich & late marks", keys: ["sandwich_rule", "late_mark_enabled", "late_marks_per_half_day"] },
  { title: "Negative balance", keys: ["negative_balance_allowed", "negative_balance_limit"] },
  { title: "Comp-off", keys: ["comp_off_enabled", "comp_off_expiry_days", "comp_off_auto_apply"] },
  { title: "Carry-forward", keys: ["carry_forward_cap"] },
];

/** field → the toggle that must be on for it to matter */
const DEPENDS: Record<string, string> = {
  late_marks_per_half_day: "late_mark_enabled", negative_balance_limit: "negative_balance_allowed",
  comp_off_expiry_days: "comp_off_enabled", comp_off_auto_apply: "comp_off_enabled",
};

export default function SettingsPage() {
  const settings = useSettings();
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [edits, setEdits] = React.useState<Record<string, Draft>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const all = React.useMemo(() => settings.data ?? [], [settings.data]);
  const byKey = React.useMemo(() => new Map(all.map((s) => [s.key, s])), [all]);

  const valueOf = (s: Setting): Draft => (s.key in edits ? edits[s.key] : toDraft(s));
  const dirty = all.filter((s) => s.key in edits && isChanged(s, edits[s.key]));
  const errors = Object.fromEntries(dirty.map((s) => [s.key, validate(s, edits[s.key])]).filter(([, e]) => !!e)) as Record<string, string>;
  const hasErrors = Object.keys(errors).length > 0;
  const calcDirty = dirty.some((s) => CALC_KEYS.has(s.key));

  const set = (key: string, v: Draft) => { setServerError(null); setEdits((e) => ({ ...e, [key]: v })); };
  const resetKey = (key: string) => setEdits((e) => { const n = { ...e }; delete n[key]; return n; });
  const discard = () => { setEdits({}); setServerError(null); };

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => unwrap(client.PUT("/api/settings", {
      // generated type is Record<string, never>; values are JSON scalars
      body: { values: Object.fromEntries(dirty.map((s) => [s.key, toApi(s, edits[s.key])])) as unknown as Record<string, never> },
    })),
    onSuccess: (fresh) => {
      qc.setQueryData(qk.settings, fresh);
      toast.success(`Saved ${pluralize(dirty.length, "setting")}`, {
        description: calcDirty ? "All open cycles were recalculated with the new policy." : undefined,
      });
      setEdits({});
      if (calcDirty) {
        ["pay-days", "close-checks", "grid", "summary", "profile", "ledger", "employees"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        qc.invalidateQueries({ queryKey: qk.dashboard });
      }
      qc.invalidateQueries({ queryKey: ["settings-public"] });
    },
    onError: (e) => { setServerError(errorMessage(e)); toast.error(errorMessage(e)); },
  });
  const trySave = React.useCallback(() => {
    if (!dirty.length || hasErrors || save.isPending) return;
    save.mutate();
  }, [dirty.length, hasErrors, save]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && dirty.length) { e.preventDefault(); trySave(); }
    };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty.length) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("beforeunload", onUnload); };
  }, [dirty.length, trySave]);

  const row = (s: Setting, children?: React.ReactNode) => {
    const dep = DEPENDS[s.key];
    const depSetting = dep ? byKey.get(dep) : undefined;
    const disabled = depSetting ? !valueOf(depSetting) : false;
    return (
      <SettingRow key={s.key} setting={s} value={valueOf(s)} onChange={(v) => set(s.key, v)} onReset={() => resetKey(s.key)}
        error={errors[s.key]} disabled={disabled}>
        {children}
      </SettingRow>
    );
  };
  const rows = (cat: string) => all.filter((s) => s.category === cat);

  const extras = (s: Setting): React.ReactNode => {
    if (s.key === "company_logo_url") return <LogoPreview url={String(valueOf(s) ?? "")} />;
    if (s.key === "smtp_host" && !String(valueOf(s) ?? "").trim()) {
      return <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-2xs font-medium text-warning">Dev mode — emails are logged, not sent</p>;
    }
    return null;
  };

  const leave = rows("leave");
  const grouped = LEAVE_GROUPS.map((g) => ({ ...g, items: g.keys.map((k) => leave.find((s) => s.key === k)).filter(Boolean) as Setting[] }));
  const known = new Set(LEAVE_GROUPS.flatMap((g) => g.keys));
  const otherLeave = leave.filter((s) => !known.has(s.key));
  const dirtyBy = (cat: string) => dirty.filter((s) => s.category === cat).length;

  return (
    <div className="relative">
      <PageHeader title="Settings" description="Company profile, salary cycle, leave policy, email and user access." />

      {settings.isError ? <ErrorState error={settings.error} onRetry={() => settings.refetch()} /> : (
        <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="hidden lg:block">
            <ul className="sticky top-20 grid gap-0.5">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <s.icon className="size-4" aria-hidden /><span className="flex-1">{s.title}</span>
                    {s.id !== "users" && dirtyBy(s.id) > 0 && <span className="size-1.5 rounded-full bg-warning" aria-label="has unsaved changes" />}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="grid min-w-0 gap-6">
            <InlineAlert tone="info" icon={<RefreshCcw className="size-4" />} title="Calculation settings are applied retroactively to open cycles">
              Saving a setting marked <b className="font-semibold">Recalc</b> recalculates balances, LOP and pay-days for every open cycle. Locked cycles keep their snapshot.
            </InlineAlert>

            {SECTIONS.filter((s) => s.id !== "users").map((sec) => (
              <Card key={sec.id} id={sec.id} className="scroll-mt-24">
                <SectionHeader icon={<sec.icon />} title={sec.title} description={sec.description} />
                <CardContent className="pb-2">
                  {settings.isLoading ? <RowsSkeleton /> : sec.id === "leave" ? (
                    <div className="grid gap-2">
                      {grouped.filter((g) => g.items.length).map((g, i) => (
                        <div key={g.title}>
                          {i > 0 && <Separator className="mb-2" />}
                          <h4 className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</h4>
                          <div className="divide-y">{g.items.map((s) => row(s, extras(s)))}</div>
                        </div>
                      ))}
                      {otherLeave.length > 0 && (
                        <div>
                          <Separator className="mb-2" />
                          <h4 className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Other</h4>
                          <div className="divide-y">{otherLeave.map((s) => row(s, extras(s)))}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="divide-y">{rows(sec.id).map((s) => row(s, extras(s)))}</div>
                  )}
                  {sec.id === "email" && !settings.isLoading && (
                    <p className="flex items-start gap-1.5 border-t py-3 text-xs text-muted-foreground">
                      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />The SMTP password is never shown again after saving. Leave it empty to keep the current one.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}

            <Card id="users" className="scroll-mt-24">
              <SectionHeader icon={<ShieldCheck />} title="Users & roles" description="Changes here save instantly. Deactivating a user signs them out everywhere." />
              <CardContent><UsersSection /></CardContent>
            </Card>
            <div className="h-20" aria-hidden />
          </div>
        </div>
      )}

      <AnimatePresence>
        {dirty.length > 0 && (
          <motion.div role="region" aria-label="Unsaved changes"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }} transition={reduce ? { duration: 0.15 } : spring}
            className="glass sticky bottom-4 z-40 mx-auto mt-4 flex w-full max-w-3xl flex-col gap-3 rounded-2xl border p-3 shadow-e3 sm:flex-row sm:items-center sm:pl-4 safe-bottom">
            <div className="min-w-0 flex-1" aria-live="polite">
              <p className="text-sm font-medium">
                <span className="tnum">{pluralize(dirty.length, "unsaved change")}</span>
                {hasErrors && <span className="text-destructive"> · {pluralize(Object.keys(errors).length, "error")} to fix</span>}
              </p>
              {serverError ? <p className="text-xs text-destructive">{serverError}</p> : calcDirty ? (
                <p className="flex items-center gap-1 text-xs text-muted-foreground"><RefreshCcw className="size-3" aria-hidden />Saving will recalculate all open cycles.</p>
              ) : <p className="hidden text-xs text-muted-foreground sm:block">Press <Kbd>⌘</Kbd> <Kbd>S</Kbd> to save</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1 sm:flex-none" onClick={discard} disabled={save.isPending}><Undo2 />Discard</Button>
              <Button className="flex-1 sm:flex-none" onClick={trySave} loading={save.isPending} disabled={hasErrors}><Save />Save changes</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionHeader({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <CardHeader className="flex-row items-center gap-3 space-y-0 border-b pb-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-4" aria-hidden>{icon}</span>
      <div>
        <h2 className="text-[0.95rem] font-semibold leading-tight tracking-tight">{title}</h2>
        <CardDescription>{description}</CardDescription>
      </div>
    </CardHeader>
  );
}

function RowsSkeleton() {
  return (
    <div className="grid gap-4 py-4" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_300px] sm:gap-6">
          <div className="grid gap-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64" /></div>
          <Skeleton className="h-9" />
        </div>
      ))}
    </div>
  );
}

function LogoPreview({ url }: { url: string }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [url]);
  const valid = /^https?:\/\/\S+$/i.test(url.trim());
  return (
    <div className="mt-2 flex items-center gap-3">
      <div className={cn("flex h-14 w-28 items-center justify-center overflow-hidden rounded-lg border bg-surface p-1.5",
        !valid && "hatched")}>
        {valid && !failed ? (
          <motion.img key={url} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, ease: easeOut }}
            src={url} alt="Company logo preview" className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
        ) : <ImageOff className="size-5 text-muted-foreground" aria-hidden />}
      </div>
      <p className="text-xs text-muted-foreground">{!url ? "No logo set — initials are used." : failed ? "Couldn't load this image." : valid ? "Preview" : "Enter a full image URL"}</p>
    </div>
  );
}
