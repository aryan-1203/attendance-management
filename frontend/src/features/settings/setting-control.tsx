import * as React from "react";
import { Eye, EyeOff, RefreshCcw, RotateCcw } from "lucide-react";
import type { Setting } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch, Tooltip } from "@/components/ui/misc";

/** Keys whose change triggers a recalculation of all open cycles (mirrors backend policy_service.CALC_KEYS). */
export const CALC_KEYS = new Set([
  "accrual_per_cycle", "accrual_timing", "prorata_rounding", "probation_usable_per_cycle", "probation_usable_cumulative",
  "sandwich_rule", "late_mark_enabled", "late_marks_per_half_day", "negative_balance_allowed",
  "negative_balance_limit", "comp_off_enabled", "comp_off_expiry_days", "comp_off_auto_apply", "unmarked_policy",
]);

export const SECRET_MASK = "••••••••";

const CHOICE_LABELS: Record<string, string> = {
  present: "Treat as present", absent: "Treat as absent",
  start: "At cycle start", end: "At cycle end", daily: "Daily (pro-rata)",
  nearest_half: "Nearest half-day", floor_half: "Round down to half", ceil_half: "Round up to half", none: "No rounding",
};
export const choiceLabel = (c: string) => CHOICE_LABELS[c] ?? c.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase());

/** Draft values are kept as strings for inputs, booleans for switches. */
export type Draft = string | boolean | null;

export function toDraft(s: Setting): Draft {
  if (s.type === "bool") return !!s.value;
  if (s.type === "secret") return "";
  if (s.value === null || s.value === undefined) return "";
  return String(s.value);
}

export function validate(s: Setting, v: Draft): string | undefined {
  if (s.type === "bool" || s.type === "secret" || s.type === "choice") return undefined;
  const str = String(v ?? "").trim();
  if (s.type === "int" || s.type === "decimal") {
    if (str === "") return s.key === "carry_forward_cap" ? undefined : `${s.label} is required`;
    const re = s.type === "int" ? /^\d+$/ : /^\d+(\.\d{1,2})?$/;
    if (!re.test(str)) return s.type === "int" ? "Enter a whole number (0 or more)" : "Enter a number like 1.5 (0 or more)";
    const n = Number(str);
    if (s.key === "cycle_start_day" && (n < 1 || n > 28)) return "Pick a day between 1 and 28";
    if (s.key === "leave_year_start_month" && (n < 1 || n > 12)) return "Use a month number from 1 to 12";
    if (s.key === "smtp_port" && (n < 1 || n > 65535)) return "Ports range from 1 to 65535";
    return undefined;
  }
  if (s.key === "company_name" && !str) return "Company name is required";
  if ((s.key === "accounts_email" || s.key === "smtp_from") && str) {
    const bad = str.split(",").map((x) => x.trim()).filter((x) => x && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    if (bad.length) return `Not a valid email: ${bad.join(", ")}`;
  }
  if (s.key === "company_logo_url" && str && !/^https?:\/\/\S+$/i.test(str)) return "Enter a full URL starting with https://";
  return undefined;
}

/** Convert a draft into the value the API expects. */
export function toApi(s: Setting, v: Draft): unknown {
  if (s.type === "bool") return !!v;
  const str = String(v ?? "").trim();
  if (s.type === "int") return Number(str);
  if (s.type === "decimal") return str === "" ? null : str;
  return str;
}

export function isChanged(s: Setting, v: Draft): boolean {
  if (s.type === "secret") return String(v ?? "") !== "";
  if (s.type === "bool") return !!v !== !!s.value;
  const orig = s.value === null || s.value === undefined ? "" : String(s.value);
  if (s.type === "decimal" && orig !== "" && String(v ?? "") !== "") return Number(orig) !== Number(v);
  return String(v ?? "") !== orig;
}

/** One row: label + description on the left, typed control on the right (stacks on mobile). */
export function SettingRow({ setting: s, value, onChange, onReset, error, disabled, children }: {
  setting: Setting; value: Draft; onChange: (v: Draft) => void; onReset: () => void; error?: string; disabled?: boolean;
  children?: React.ReactNode;
}) {
  const id = `set-${s.key}`;
  const changed = isChanged(s, value);
  const descId = s.description ? `${id}-desc` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,300px)] sm:items-start sm:gap-6",
      disabled && "opacity-60")}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor={id} className="text-sm font-medium">{s.label}</label>
          {CALC_KEYS.has(s.key) && (
            <Tooltip content="Changing this recalculates all open cycles">
              <span tabIndex={0} className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0 text-2xs font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <RefreshCcw className="size-2.5" aria-hidden />Recalc
              </span>
            </Tooltip>
          )}
          {changed && (
            <span className="inline-flex items-center gap-1 text-2xs font-medium text-warning">
              <span className="size-1.5 rounded-full bg-warning" aria-hidden />Unsaved
            </span>
          )}
        </div>
        {s.description && <p id={descId} className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>}
        {children}
      </div>
      <div className="grid gap-1">
        <div className="flex items-center gap-1.5">
          <div className={cn("min-w-0 flex-1", s.type === "bool" && "flex sm:justify-end")}>
            <Control s={s} id={id} value={value} onChange={onChange} invalid={!!error} describedBy={describedBy} disabled={disabled} />
          </div>
          {changed && s.type !== "bool" && (
            <button type="button" onClick={onReset} aria-label={`Undo change to ${s.label}`}
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <RotateCcw className="size-3.5" />
            </button>
          )}
        </div>
        {error && <p id={errId} role="alert" className="text-xs font-medium text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function Control({ s, id, value, onChange, invalid, describedBy, disabled }: {
  s: Setting; id: string; value: Draft; onChange: (v: Draft) => void; invalid: boolean; describedBy?: string; disabled?: boolean;
}) {
  const [reveal, setReveal] = React.useState(false);
  const common = { id, "aria-invalid": invalid || undefined, "aria-describedby": describedBy, disabled };
  if (s.type === "bool") {
    return <Switch {...common} checked={!!value} onCheckedChange={(v) => onChange(v)} aria-label={s.label} />;
  }
  if (s.type === "choice") {
    return (
      <Select value={String(value ?? "")} onValueChange={(v) => onChange(v)} disabled={disabled}>
        <SelectTrigger id={id} aria-describedby={describedBy} aria-label={s.label}><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>
          {(s.choices ?? []).map((c) => <SelectItem key={c} value={c}>{choiceLabel(c)}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  if (s.type === "secret") {
    const isSet = s.value === SECRET_MASK || (typeof s.value === "string" && s.value.length > 0);
    return (
      <div className="relative">
        <Input {...common} type={reveal ? "text" : "password"} autoComplete="new-password" value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)} placeholder={isSet ? "Saved — type to replace" : "Not set"} className="pr-10" />
        <button type="button" onClick={() => setReveal((r) => !r)} aria-label={reveal ? "Hide password" : "Show password"} aria-pressed={reveal}
          className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    );
  }
  if (s.type === "int" || s.type === "decimal") {
    return (
      <Input {...common} type="text" inputMode={s.type === "int" ? "numeric" : "decimal"} className="tnum"
        value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}
        placeholder={s.key === "carry_forward_cap" ? "No cap" : undefined} />
    );
  }
  const isEmail = /email|smtp_from/.test(s.key);
  return <Input {...common} type={s.key.endsWith("_url") ? "url" : "text"} inputMode={isEmail ? "email" : s.key.endsWith("_url") ? "url" : undefined}
    value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} autoComplete="off" />;
}
