import {
  ArrowLeftRight, Ban, Banknote, BadgeMinus, CheckCircle2, Clock3, Hourglass, Lock, Palmtree, Repeat2,
  SlidersHorizontal, Sprout, Undo2, Unlock, XCircle, type LucideIcon,
} from "lucide-react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { cn, fmtDate, fmtDays, num } from "@/lib/utils";

/* ------------------------------------------------------------------ request status */
const REQ: Record<string, { label: string; icon: LucideIcon; variant: "warning" | "success" | "destructive" | "secondary" }> = {
  pending: { label: "Pending", icon: Clock3, variant: "warning" },
  approved: { label: "Approved", icon: CheckCircle2, variant: "success" },
  rejected: { label: "Rejected", icon: XCircle, variant: "destructive" },
  cancelled: { label: "Cancelled", icon: Ban, variant: "secondary" },
};

export function RequestStatusBadge({ status, className }: { status: string; className?: string }) {
  const m = REQ[status] ?? { label: status, icon: Clock3, variant: "secondary" as const };
  const Icon = m.icon;
  return (
    <Badge variant={m.variant} className={className}>
      <Icon className="size-3" aria-hidden />{m.label}
    </Badge>
  );
}

export const REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

/* ------------------------------------------------------------------ pay breakdown */
export function dayWord(n: number) {
  return `${fmtDays(n)} ${n === 1 ? "day" : "days"}`;
}

/** "2 days paid, 1 day LOP" from the stored estimate (comp-off = remainder for comp-off requests). */
export function payParts(days: string | number, paid: string | number, lop: string | number) {
  const d = num(days), p = num(paid), l = num(lop);
  const co = Math.max(0, Math.round((d - p - l) * 100) / 100);
  return { days: d, paid: p, lop: l, compOff: co };
}

export function payBreakdownText(days: string | number, paid: string | number, lop: string | number) {
  const b = payParts(days, paid, lop);
  const parts: string[] = [];
  if (b.paid) parts.push(`${dayWord(b.paid)} paid`);
  if (b.compOff) parts.push(`${dayWord(b.compOff)} comp-off`);
  if (b.lop) parts.push(`${dayWord(b.lop)} LOP`);
  return parts.join(", ") || "No working days";
}

export function PayBreakdown({ days, paid, lop, className }: {
  days: string | number; paid: string | number; lop: string | number; className?: string;
}) {
  const b = payParts(days, paid, lop);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {b.paid > 0 && <Badge variant="success" className="tnum">{dayWord(b.paid)} paid</Badge>}
      {b.compOff > 0 && <Badge className="tnum bg-status-co/10 text-status-co-fg ring-status-co/25">{dayWord(b.compOff)} comp-off</Badge>}
      {b.lop > 0 && <Badge variant="destructive" className="tnum">{dayWord(b.lop)} LOP</Badge>}
      {!b.paid && !b.compOff && !b.lop && <Badge variant="secondary">No working days</Badge>}
    </span>
  );
}

/** Segmented bar: paid | comp-off | LOP, proportional. */
export function PayBar({ paid, compOff, lop, className }: { paid: number; compOff: number; lop: number; className?: string }) {
  const total = paid + compOff + lop;
  if (!total) return null;
  const seg = (v: number) => `${(v / total) * 100}%`;
  return (
    <div className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      {paid > 0 && <span className="h-full bg-success transition-[width] duration-slow ease-out-expo" style={{ width: seg(paid) }} />}
      {compOff > 0 && <span className="h-full bg-status-co transition-[width] duration-slow ease-out-expo" style={{ width: seg(compOff) }} />}
      {lop > 0 && <span className="h-full bg-destructive transition-[width] duration-slow ease-out-expo" style={{ width: seg(lop) }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ dates */
export function fmtRange(start: string, end: string, halfDay?: boolean) {
  if (start === end) return `${fmtDate(start, "EEE d MMM yyyy")}${halfDay ? " · half-day" : ""}`;
  const s = parseISO(start), e = parseISO(end);
  const sameYear = s.getFullYear() === e.getFullYear();
  return `${fmtDate(start, sameYear ? "EEE d MMM" : "d MMM yyyy")} – ${fmtDate(end, "EEE d MMM yyyy")}`;
}

export function daysFromToday(d: string) {
  return differenceInCalendarDays(parseISO(d), new Date());
}

/** API timestamps are naive UTC ("2026-11-17T07:13:26") — parse them as UTC, not local time. */
export function parseUtc(s: string): Date {
  return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
}

export const LEAVE_TYPE_LABEL: Record<string, string> = { paid: "Paid leave", comp_off: "Comp-off" };

/* ------------------------------------------------------------------ ledger */
export const BUCKET_LABEL: Record<string, string> = {
  usable: "Usable", locked: "Locked", comp_off: "Comp-off", lop: "LOP",
};

const ENTRY: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  ACCRUAL: { label: "Accrual", icon: Sprout, cls: "bg-success/10 text-success ring-success/25" },
  PROBATION_LOCK: { label: "Probation lock", icon: Lock, cls: "bg-muted text-muted-foreground ring-border" },
  PROBATION_RELEASE: { label: "Probation release", icon: Unlock, cls: "bg-success/10 text-success ring-success/25" },
  LEAVE_USED: { label: "Leave used", icon: Palmtree, cls: "bg-status-l/10 text-status-l-fg ring-status-l/25" },
  LOP: { label: "Loss of pay", icon: BadgeMinus, cls: "bg-destructive/10 text-destructive ring-destructive/25" },
  COMP_OFF_EARNED: { label: "Comp-off earned", icon: ArrowLeftRight, cls: "bg-status-co/10 text-status-co-fg ring-status-co/25" },
  COMP_OFF_EXPIRED: { label: "Comp-off expired", icon: Hourglass, cls: "bg-warning/10 text-warning ring-warning/25" },
  ADJUSTMENT: { label: "Adjustment", icon: SlidersHorizontal, cls: "bg-primary/10 text-primary ring-primary/20" },
  CARRY_FORWARD: { label: "Carry forward", icon: Repeat2, cls: "bg-primary/10 text-primary ring-primary/20" },
  ENCASHMENT: { label: "Encashment", icon: Banknote, cls: "bg-accent/10 text-accent ring-accent/25" },
};

export function entryMeta(type: string) {
  return ENTRY[type] ?? { label: type.replace(/_/g, " ").toLowerCase(), icon: SlidersHorizontal,
    cls: "bg-muted text-muted-foreground ring-border" };
}

export function EntryTypeBadge({ type, reversal }: { type: string; reversal?: boolean }) {
  const m = entryMeta(type);
  const Icon = reversal ? Undo2 : m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", m.cls)}>
      <Icon className="size-3" aria-hidden />{reversal ? `Reversal · ${m.label}` : m.label}
    </span>
  );
}

/** Signed, coloured amount. For the LOP bucket a positive number is a deduction from pay. */
export function Amount({ value, bucket, className, struck }: {
  value: string | number; bucket?: string; className?: string; struck?: boolean;
}) {
  const n = num(value);
  const bad = bucket === "lop" ? n > 0 : n < 0;
  const good = bucket === "lop" ? n < 0 : n > 0;
  const text = n > 0 ? `+${fmtDays(n)}` : n < 0 ? `−${fmtDays(-n)}` : "0";
  return (
    <span className={cn("tnum font-semibold", good && "text-success", bad && "text-destructive",
      struck && "line-through opacity-60", className)}
      aria-label={`${n > 0 ? "plus" : n < 0 ? "minus" : ""} ${fmtDays(Math.abs(n))} ${Math.abs(n) === 1 ? "day" : "days"}`}>
      {text}
    </span>
  );
}
