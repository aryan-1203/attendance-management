import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { easeOut } from "./motion";

/** Animated progress ring (Apple Activity-style). */
export function Ring({ value, max = 100, size = 64, stroke = 7, color = "hsl(var(--primary))", track,
  children, className, label }: {
  value: number; max?: number; size?: number; stroke?: number; color?: string; track?: string;
  children?: React.ReactNode; className?: string; label?: string;
}) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}
      role="img" aria-label={label ?? `${Math.round(pct * 100)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track ?? "hsl(var(--muted))"} strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c * (1 - pct) : c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: reduce ? 0 : 1.1, ease: easeOut }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** The pay-cycle ring: day X of N with ticks for each day of the cycle. */
export function CycleRing({ day, days, size = 168, label }: { day: number; days: number; size?: number; label: string }) {
  const reduce = useReducedMotion();
  const center = size / 2;
  const rOuter = size / 2 - 6;
  return (
    <div className="relative" style={{ width: size, height: size }} role="img"
      aria-label={`Day ${day} of ${days} in cycle ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="cycle-grad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--accent))" />
          </linearGradient>
        </defs>
        {Array.from({ length: days }).map((_, i) => {
          const a = (i / days) * Math.PI * 2 - Math.PI / 2;
          const done = i < day;
          const isToday = i === day - 1;
          const r1 = rOuter - (isToday ? 14 : 10);
          return (
            <motion.line key={i}
              x1={center + Math.cos(a) * r1} y1={center + Math.sin(a) * r1}
              x2={center + Math.cos(a) * rOuter} y2={center + Math.sin(a) * rOuter}
              stroke={done ? "url(#cycle-grad)" : "hsl(var(--border))"} strokeWidth={isToday ? 3.5 : 2.5}
              strokeLinecap="round"
              initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ delay: reduce ? 0 : i * 0.018, duration: 0.25 }} />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Day</span>
        <span className="tnum text-4xl font-semibold leading-none">{day}</span>
        <span className="tnum text-xs text-muted-foreground">of {days}</span>
      </div>
    </div>
  );
}
