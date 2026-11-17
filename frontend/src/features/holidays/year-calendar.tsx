import * as React from "react";
import { addDays, format, getDaysInMonth, isSameDay } from "date-fns";
import { motion, useReducedMotion } from "framer-motion";
import type { Holiday } from "@/lib/types";
import { cn, isoDate } from "@/lib/utils";
import { Tooltip } from "@/components/ui/misc";
import { stagger } from "@/components/shared/motion";
import { HOLIDAY_KINDS, KIND_META, kindMeta } from "./kinds";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function HolidayLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground", className)} aria-label="Calendar legend">
      {HOLIDAY_KINDS.map((k) => {
        const m = KIND_META[k];
        const Icon = m.icon;
        return (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block size-4 rounded-md border-2", m.swatch)} aria-hidden />
            <Icon className="size-3" aria-hidden />
            <span className="font-medium text-foreground">{m.label}</span>
          </li>
        );
      })}
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-flex size-4 items-center justify-center rounded-md text-2xs text-muted-foreground/60" aria-hidden>7</span>
        Sunday
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block size-4 rounded-md ring-2 ring-primary" aria-hidden />Today
      </li>
    </ul>
  );
}

export function YearCalendar({ year, holidays, canEdit, onAdd, onEdit }: {
  year: number; holidays: Holiday[]; canEdit: boolean; onAdd: (date: string) => void; onEdit: (h: Holiday) => void;
}) {
  const reduce = useReducedMotion();
  const byDate = React.useMemo(() => {
    const m = new Map<string, Holiday[]>();
    holidays.forEach((h) => m.set(h.date, [...(m.get(h.date) ?? []), h]));
    return m;
  }, [holidays]);
  return (
    <motion.div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      variants={stagger.container} initial={reduce ? false : "hidden"} animate="show" key={year}>
      {Array.from({ length: 12 }).map((_, m) => (
        <motion.div key={m} variants={stagger.item}>
          <MonthGrid year={year} month={m} byDate={byDate} canEdit={canEdit} onAdd={onAdd} onEdit={onEdit} />
        </motion.div>
      ))}
    </motion.div>
  );
}

function MonthGrid({ year, month, byDate, canEdit, onAdd, onEdit }: {
  year: number; month: number; byDate: Map<string, Holiday[]>; canEdit: boolean;
  onAdd: (date: string) => void; onEdit: (h: Holiday) => void;
}) {
  const first = new Date(year, month, 1);
  const days = getDaysInMonth(first);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const today = new Date();
  const monthHolidays = React.useMemo(() => {
    const out: Holiday[] = [];
    for (let d = 1; d <= days; d++) out.push(...(byDate.get(isoDate(new Date(year, month, d))) ?? []));
    return out;
  }, [byDate, year, month, days]);

  // roving tabindex: one tab stop per month, arrows move between days
  const initial = monthHolidays[0] ? Number(monthHolidays[0].date.slice(8, 10)) :
    today.getFullYear() === year && today.getMonth() === month ? today.getDate() : 1;
  const [focusDay, setFocusDay] = React.useState(initial);
  React.useEffect(() => setFocusDay(initial), [initial]);
  const refs = React.useRef<(HTMLElement | null)[]>([]);
  const interactive = (d: number) => canEdit || byDate.has(isoDate(new Date(year, month, d)));
  const move = (from: number, delta: number) => {
    let n = from + delta;
    n = Math.max(1, Math.min(days, n));
    if (!canEdit) {
      // only holiday days are focusable for viewers: jump to next/prev holiday day
      const list = monthHolidays.map((h) => Number(h.date.slice(8, 10)));
      const target = delta > 0 ? list.find((x) => x > from) : [...list].reverse().find((x) => x < from);
      if (!target) return;
      n = target;
    }
    setFocusDay(n);
    refs.current[n]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, d: number) => {
    const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
    if (map[e.key] !== undefined) { e.preventDefault(); move(d, map[e.key]); }
    else if (e.key === "Home") { e.preventDefault(); move(d, -days); }
    else if (e.key === "End") { e.preventDefault(); move(d, days); }
  };
  const tabDay = interactive(focusDay) ? focusDay : monthHolidays[0] ? Number(monthHolidays[0].date.slice(8, 10)) : -1;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-e1" aria-labelledby={`m-${year}-${month}`}>
      <header className="mb-3 flex items-baseline justify-between">
        <h3 id={`m-${year}-${month}`} className="text-sm font-semibold">{format(first, "MMMM")}</h3>
        <span className="text-2xs text-muted-foreground tnum">
          {monthHolidays.length ? `${monthHolidays.length} holiday${monthHolidays.length > 1 ? "s" : ""}` : "—"}
        </span>
      </header>
      <div role="group" aria-labelledby={`m-${year}-${month}`} className="grid grid-cols-7 gap-1 text-center">
        <div aria-hidden className="contents">
          {WEEKDAYS.map((w, i) => (
            <div key={i} title={format(addDays(new Date(2024, 0, 1), i), "EEEE")}
              className={cn("pb-1 text-2xs font-medium", i === 6 ? "text-muted-foreground/50" : "text-muted-foreground")}>{w}</div>
          ))}
        </div>
        <div className="contents">
          {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} aria-hidden />)}
          {Array.from({ length: days }).map((_, i) => {
            const d = i + 1;
            const date = new Date(year, month, d);
            const iso = isoDate(date);
            const hs = byDate.get(iso);
            const h = hs?.[0];
            const sun = date.getDay() === 0;
            const isToday = isSameDay(date, today);
            const meta = h ? kindMeta(h.kind) : null;
            const label = `${format(date, "EEEE d MMMM yyyy")}${hs ? `: ${hs.map((x) => `${x.name} (${kindMeta(x.kind).short.toLowerCase()})`).join(", ")}` : ""}${isToday ? ", today" : ""}${!hs && sun ? ", Sunday" : ""}`;
            const cls = cn("relative flex aspect-square w-full items-center justify-center rounded-md border-2 text-xs tnum transition-[transform,background-color] duration-fast",
              meta ? meta.cell : cn("border-transparent", sun ? "text-muted-foreground/50" : "text-foreground/80"),
              isToday && "ring-2 ring-primary ring-offset-1 ring-offset-card",
              (canEdit || h) && "cursor-pointer hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              canEdit && !h && "hover:bg-muted");
            const content = <>{d}{hs && hs.length > 1 && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-foreground ring-2 ring-card" aria-hidden />}</>;
            if (!interactive(d)) {
              return <div key={d} aria-hidden title={label} className={cls}>{content}</div>;
            }
            const btn = (
              <button type="button" ref={(el) => { refs.current[d] = el; }} tabIndex={d === tabDay ? 0 : -1}
                aria-label={canEdit ? `${label}. ${h ? "Edit" : "Add holiday"}` : label}
                onFocus={() => setFocusDay(d)} onKeyDown={(e) => onKey(e, d)}
                onClick={() => (h ? canEdit && onEdit(h) : canEdit && onAdd(iso))} className={cls}>
                {content}
              </button>
            );
            return (
              <div key={d}>
                {hs ? (
                  <Tooltip content={
                    <div className="grid gap-1">
                      <p className="text-2xs opacity-70">{format(date, "EEE, d MMM")}</p>
                      {hs.map((x) => <p key={x.id}><b>{x.name}</b> · {kindMeta(x.kind).label}</p>)}
                    </div>
                  }>{btn}</Tooltip>
                ) : btn}
              </div>
            );
          })}
        </div>
      </div>
      {monthHolidays.length > 0 && (
        <ul className="mt-3 grid gap-1 border-t pt-3">
          {monthHolidays.map((h) => {
            const m = kindMeta(h.kind);
            return (
              <li key={h.id} className="flex items-center gap-2 text-xs">
                <span className={cn("size-1.5 shrink-0 rounded-full", m.dot)} aria-hidden />
                <span className="w-6 shrink-0 font-semibold tnum">{Number(h.date.slice(8, 10))}</span>
                <span className="min-w-0 flex-1 truncate">{h.name}</span>
                <span className="shrink-0 text-2xs text-muted-foreground">{m.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
