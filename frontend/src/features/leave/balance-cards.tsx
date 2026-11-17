import { motion } from "framer-motion";
import { ArrowLeftRight, Lock, Palmtree } from "lucide-react";
import { cn, fmtDays, num } from "@/lib/utils";
import { Ring } from "@/components/shared/rings";
import { CountUp, stagger } from "@/components/shared/motion";
import { Skeleton } from "@/components/ui/misc";
import type { Balances } from "./api";

const fmt1 = (n: number) => fmtDays(Math.round(n * 2) / 2);

/** Usable / locked (probation) / comp-off balance cards with rings. */
export function BalanceCards({ balances, onProbation, loading, className }: {
  balances: Balances | undefined; onProbation?: boolean; loading?: boolean; className?: string;
}) {
  if (loading || !balances) {
    return (
      <div className={cn("grid gap-3 sm:grid-cols-3", className)} aria-busy="true" aria-label="Loading balances">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-xl" />)}
      </div>
    );
  }
  const usable = num(balances.usable), locked = num(balances.locked), comp = num(balances.comp_off);
  const cards = [
    {
      key: "usable", label: "Usable leave", value: usable, icon: Palmtree, color: "hsl(var(--st-l))",
      max: Math.max(18, usable), ringLabel: `${fmtDays(usable)} usable days of an 18-day yearly accrual`,
      tone: usable < 0 ? "text-destructive" : "",
      sub: onProbation ? "0.5 day becomes usable each cycle while on probation." : "Accrues 1.5 days every salary cycle (20th → 19th).",
    },
    {
      key: "locked", label: "Locked · probation", value: locked, icon: Lock, color: "hsl(var(--st-wo))",
      max: Math.max(6, locked), ringLabel: `${fmtDays(locked)} locked days`, tone: "",
      sub: onProbation
        ? "1.0 day per cycle is locked during probation and released to usable when you're confirmed."
        : locked > 0 ? "Will be released to usable on confirmation." : "Nothing locked — your leave is fully usable.",
    },
    {
      key: "comp", label: "Comp-off", value: comp, icon: ArrowLeftRight, color: "hsl(var(--st-co))",
      max: Math.max(5, comp), ringLabel: `${fmtDays(comp)} comp-off days`, tone: "",
      sub: "Earned by working on a weekly off or holiday. Lots expire if unused.",
    },
  ];
  return (
    <motion.ul variants={stagger.container} initial="hidden" animate="show"
      className={cn("grid gap-3 sm:grid-cols-3", className)} aria-label="Leave balances">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <motion.li key={c.key} variants={stagger.item}
            className="relative flex gap-4 overflow-hidden rounded-xl border bg-card p-4 shadow-e1">
            <Ring value={Math.max(0, c.value)} max={c.max} size={68} stroke={7} color={c.color} label={c.ringLabel}>
              <Icon className="size-5" style={{ color: c.color }} aria-hidden />
            </Ring>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
              <p className={cn("mt-0.5 text-3xl font-semibold leading-none tracking-tight", c.tone)}>
                <CountUp value={c.value} format={fmt1} />
                <span className="ml-1 text-sm font-medium text-muted-foreground">{Math.abs(c.value) === 1 ? "day" : "days"}</span>
              </p>
              <p className="mt-1.5 text-2xs leading-snug text-muted-foreground text-pretty">{c.sub}</p>
            </div>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
