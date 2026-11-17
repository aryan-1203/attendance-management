import * as React from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

export const spring = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;
export const easeOut = [0.16, 1, 0.3, 1] as const;

/** Animated count-up for KPIs (tabular numbers, respects reduced motion). */
export function CountUp({ value, decimals = 0, format, className, duration = 0.9 }: {
  value: number; decimals?: number; format?: (n: number) => string; className?: string; duration?: number;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => (format ? format(v) : v.toFixed(decimals)));
  React.useEffect(() => {
    if (reduce) { mv.set(value); return; }
    const c = animate(mv, value, { duration, ease: easeOut });
    return () => c.stop();
  }, [value, reduce, mv, duration]);
  return <motion.span className={cn("tnum", className)} aria-label={format ? format(value) : value.toFixed(decimals)}>{text}</motion.span>;
}

export function FadeIn({ children, delay = 0, className, y = 8 }: {
  children: React.ReactNode; delay?: number; className?: string; y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay, ease: easeOut }}>
      {children}
    </motion.div>
  );
}

export const stagger = {
  container: { hidden: {}, show: { transition: { staggerChildren: 0.05 } } },
  item: { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: easeOut } } },
};
