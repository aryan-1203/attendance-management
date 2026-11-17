import * as React from "react";
import { format, parseISO } from "date-fns";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeftRight, BadgeMinus, Banknote, CalendarMinus, CalendarPlus, Hourglass, Lock, LockOpen, Redo2, SlidersHorizontal,
  Sparkles, Undo2, type LucideIcon,
} from "lucide-react";
import type { LedgerEntry } from "@/lib/types";
import { cn, fmtDate, fmtDays, num } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/misc";
import { EmptyState } from "@/components/shared/empty-state";
import { easeOut } from "@/components/shared/motion";

const TYPES: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  ACCRUAL: { label: "Accrual", icon: CalendarPlus, tone: "bg-success/10 text-success" },
  PROBATION_LOCK: { label: "Locked for probation", icon: Lock, tone: "bg-warning/10 text-warning" },
  PROBATION_RELEASE: { label: "Released on confirmation", icon: LockOpen, tone: "bg-success/10 text-success" },
  LEAVE_USED: { label: "Leave used", icon: CalendarMinus, tone: "bg-status-l/10 text-status-l-fg" },
  LOP: { label: "Loss of pay", icon: BadgeMinus, tone: "bg-status-lop/10 text-status-lop-fg" },
  ADJUSTMENT: { label: "Manual adjustment", icon: SlidersHorizontal, tone: "bg-primary/10 text-primary" },
  CARRY_FORWARD: { label: "Carry-forward", icon: Redo2, tone: "bg-primary/10 text-primary" },
  COMP_OFF_EARNED: { label: "Comp-off earned", icon: Sparkles, tone: "bg-status-co/10 text-status-co-fg" },
  COMP_OFF_EXPIRED: { label: "Comp-off expired", icon: Hourglass, tone: "bg-muted text-muted-foreground" },
  ENCASHMENT: { label: "Encashment", icon: Banknote, tone: "bg-accent/10 text-accent" },
};

export const BUCKET_LABEL: Record<string, string> = {
  usable: "Usable", locked: "Locked", comp_off: "Comp-off", lop: "LOP",
};
const BUCKET_CLS: Record<string, string> = {
  usable: "bg-success/10 text-success ring-success/20",
  locked: "bg-warning/10 text-warning ring-warning/20",
  comp_off: "bg-status-co/10 text-status-co-fg ring-status-co/20",
  lop: "bg-status-lop/10 text-status-lop-fg ring-status-lop/20",
};

export function BucketChip({ bucket }: { bucket: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-1.5 py-0 text-2xs font-semibold ring-1 ring-inset",
      BUCKET_CLS[bucket] ?? "bg-muted text-muted-foreground ring-border")}>
      {BUCKET_LABEL[bucket] ?? bucket}
    </span>
  );
}

/** Vertical, month-grouped leave-ledger timeline. Reversed entries are struck through; reversals are tagged. */
export function LedgerTimeline({ entries, className }: { entries: LedgerEntry[]; className?: string }) {
  const reduce = useReducedMotion();
  const [bucket, setBucket] = React.useState<string>("all");
  const [showReversed, setShowReversed] = React.useState(true);
  const buckets = React.useMemo(() => Array.from(new Set(entries.map((e) => e.bucket))), [entries]);
  const visible = entries.filter((e) => (bucket === "all" || e.bucket === bucket) &&
    (showReversed || (!e.is_reversed && !e.reversal_of_id)));
  const groups = React.useMemo(() => {
    const m = new Map<string, LedgerEntry[]>();
    visible.forEach((e) => {
      const k = e.entry_date.slice(0, 7);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    });
    return Array.from(m.entries());
  }, [visible]);
  const hasReversals = entries.some((e) => e.is_reversed || e.reversal_of_id);

  if (!entries.length) {
    return <EmptyState art="inbox" compact title="No ledger entries yet"
      description="Accruals, leave usage and adjustments will appear here." className={className} />;
  }
  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter ledger by bucket">
        {["all", ...buckets].map((b) => (
          <button key={b} type="button" aria-pressed={bucket === b} onClick={() => setBucket(b)}
            className={cn("h-8 cursor-pointer rounded-full border px-3 text-xs font-medium transition-colors duration-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              bucket === b ? "border-primary bg-primary/10 text-primary" : "bg-surface text-muted-foreground hover:text-foreground")}>
            {b === "all" ? "All" : BUCKET_LABEL[b] ?? b}
          </button>
        ))}
        {hasReversals && (
          <button type="button" aria-pressed={!showReversed} onClick={() => setShowReversed((v) => !v)}
            className="ml-auto h-8 cursor-pointer rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {showReversed ? "Hide reversals" : "Show reversals"}
          </button>
        )}
      </div>
      {!visible.length && <EmptyState compact title="Nothing in this bucket" />}
      <ol className="grid gap-5" aria-label="Leave ledger">
        {groups.map(([month, items], gi) => {
          const net = items.filter((e) => !e.is_reversed).reduce((s, e) => s + Math.round(num(e.amount) * 100), 0) / 100;
          return (
            <li key={month}>
              <div className="glass sticky top-0 z-10 -mx-1 mb-2 flex items-center justify-between rounded-md px-1 py-1">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {format(parseISO(`${month}-01`), "MMMM yyyy")}
                </h4>
                <span className={cn("text-xs font-medium tnum", net > 0 ? "text-success" : net < 0 ? "text-destructive" : "text-muted-foreground")}>
                  Net {fmtDays(net, { signed: true })}
                </span>
              </div>
              <ol className="relative grid gap-1 border-l border-border pl-5 ml-3.5">
                {items.map((e, i) => {
                  const t = TYPES[e.entry_type] ?? { label: e.entry_type.replace(/_/g, " ").toLowerCase(), icon: ArrowLeftRight,
                    tone: "bg-muted text-muted-foreground" };
                  const Icon = e.reversal_of_id ? Undo2 : t.icon;
                  const amt = num(e.amount);
                  return (
                    <motion.li key={e.id} initial={reduce ? false : { opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, ease: easeOut, delay: reduce ? 0 : Math.min(0.3, (gi * 3 + i) * 0.02) }}
                      className={cn("relative rounded-lg px-2 py-2 transition-colors hover:bg-muted/50", e.is_reversed && "opacity-60")}>
                      <span className={cn("absolute -left-[34px] top-2 flex size-7 items-center justify-center rounded-full ring-4 ring-card",
                        t.tone)} aria-hidden>
                        <Icon className="size-3.5" />
                      </span>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={cn("text-sm font-medium first-letter:uppercase", e.is_reversed && "line-through decoration-muted-foreground")}>
                              {t.label}
                            </span>
                            <BucketChip bucket={e.bucket} />
                            {e.reversal_of_id && <Badge variant="outline" className="text-muted-foreground">reversal</Badge>}
                            {e.is_reversed && <Badge variant="secondary">reversed</Badge>}
                            {!e.is_system && <Tooltip content="Posted manually by HR"><Badge variant="default">manual</Badge></Tooltip>}
                          </div>
                          {(e.note || e.reference) && (
                            <p className={cn("mt-0.5 line-clamp-2 text-xs text-muted-foreground", e.is_reversed && "line-through")}>
                              {e.note || e.reference}
                            </p>
                          )}
                          <time dateTime={e.entry_date} className="mt-0.5 block text-2xs text-muted-foreground tnum">
                            {fmtDate(e.entry_date, "EEE, d MMM yyyy")}
                          </time>
                        </div>
                        <span className={cn("shrink-0 text-sm font-semibold tnum",
                          e.is_reversed ? "text-muted-foreground line-through" : amt > 0 ? "text-success" : amt < 0 ? "text-destructive" : "text-muted-foreground")}
                          aria-label={`${amt > 0 ? "plus" : amt < 0 ? "minus" : ""} ${fmtDays(Math.abs(amt))} days`}>
                          {fmtDays(amt, { signed: true })}
                        </span>
                      </div>
                    </motion.li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
