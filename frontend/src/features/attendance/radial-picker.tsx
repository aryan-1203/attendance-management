import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Eraser } from "lucide-react";
import { STATUS, type StatusCode } from "@/lib/status";
import { cn } from "@/lib/utils";

const RING: StatusCode[] = ["P", "A", "HD", "L", "WFH", "OD", "CO", "WO", "H"];
const SIZE = 196;
const R = 70;

/** Radial status picker: statuses orbit the clear button; letter keys work too. */
export function RadialPicker({ current, allowed, onPick, onClose }: {
  current: string | null; allowed: (code: StatusCode) => boolean; onPick: (code: StatusCode | null) => void;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const first = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { first.current?.focus(); }, []);
  return (
    <div role="menu" aria-label="Set attendance status" className="relative" style={{ width: SIZE, height: SIZE }}
      onKeyDown={(e) => {
        const code = Object.values(STATUS).find((s) => s.key === e.key.toLowerCase())?.code;
        if (code && allowed(code)) { e.preventDefault(); onPick(code); }
        if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); onPick(null); }
        if (e.key === "Escape") onClose();
      }}>
      <div aria-hidden className="absolute inset-3 rounded-full glass border shadow-e3" />
      {RING.map((code, i) => {
        const m = STATUS[code];
        const Icon = m.icon;
        const a = (i / RING.length) * Math.PI * 2 - Math.PI / 2;
        const x = SIZE / 2 + Math.cos(a) * R - 22;
        const y = SIZE / 2 + Math.sin(a) * R - 22;
        const ok = allowed(code);
        return (
          <motion.button key={code} ref={i === 0 ? first : undefined} role="menuitem" type="button" disabled={!ok}
            aria-label={`${m.label}${m.key ? ` (${m.key.toUpperCase()})` : ""}`}
            title={`${m.label}${m.key ? ` · ${m.key.toUpperCase()}` : ""}`}
            initial={reduce ? false : { x: SIZE / 2 - 22, y: SIZE / 2 - 22, scale: 0.4, opacity: 0 }}
            animate={{ x, y, scale: 1, opacity: ok ? 1 : 0.35 }}
            transition={{ type: "spring", stiffness: 520, damping: 30, delay: reduce ? 0 : i * 0.015 }}
            whileHover={ok ? { scale: 1.12 } : undefined} whileTap={ok ? { scale: 0.92 } : undefined}
            onClick={() => onPick(code)}
            className={cn("absolute left-0 top-0 flex size-11 cursor-pointer flex-col items-center justify-center rounded-full text-[10px] font-bold leading-none shadow-e2 touch-manipulation select-none",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed",
              m.soft, "bg-card", current === code && "ring-2 ring-offset-2 ring-offset-card ring-primary")}>
            <span className={cn("absolute inset-0 rounded-full", m.soft)} aria-hidden />
            <Icon className="relative size-4" aria-hidden />
            <span className="relative mt-0.5">{code}</span>
          </motion.button>
        );
      })}
      <motion.button type="button" role="menuitem" aria-label="Clear mark (Delete)" title="Clear · Del"
        initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={() => onPick(null)}
        className="absolute left-1/2 top-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center justify-center rounded-full border bg-surface text-[10px] font-medium text-muted-foreground shadow-e1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <Eraser className="size-4" aria-hidden />Clear
      </motion.button>
    </div>
  );
}
