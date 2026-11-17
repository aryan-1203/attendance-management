import * as React from "react";
import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";
import { BadgeMinus, CalendarClock, Lock, Palmtree, Wrench } from "lucide-react";
import { statusMeta } from "@/lib/status";
import type { Cycle } from "@/lib/types";
import { cn, fmtDays, isoDate, num } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/shared/status-badge";
import type { DayDetail } from "@/features/leave/api";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Tint per status (literal classes so Tailwind generates them; the shared soft classes use /12 which isn't in the opacity scale). */
const CELL_BG: Record<string, string> = {
  P: "bg-status-p/10", A: "bg-status-a/15", HD: "bg-status-hd/15", L: "bg-status-l/15", WO: "bg-status-wo/10",
  H: "bg-status-h/15", CO: "bg-status-co/15", WFH: "bg-status-wfh/10", OD: "bg-status-od/10", LOP: "bg-status-lop/15",
  NJ: "bg-status-nj/10", EX: "bg-status-ex/10",
};

type Slot = { date: string; inCycle: boolean; detail?: DayDetail };

/** Month-style calendar of one salary cycle (20th → 19th), Monday-first, with per-day popovers. */
export function CycleCalendar({ cycle, days, onRequestCorrection }: {
  cycle: Cycle; days: DayDetail[]; onRequestCorrection: (date: string, status: string | null) => void;
}) {
  const today = isoDate(new Date());
  const byDate = React.useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const slots = React.useMemo<Slot[]>(() => {
    const start = parseISO(cycle.start_date), end = parseISO(cycle.end_date);
    const first = startOfWeek(start, { weekStartsOn: 1 });
    const total = Math.ceil((differenceInCalendarDays(end, first) + 1) / 7) * 7;
    return Array.from({ length: total }, (_, i) => {
      const d = isoDate(addDays(first, i));
      return { date: d, inCycle: d >= cycle.start_date && d <= cycle.end_date, detail: byDate.get(d) };
    });
  }, [cycle.start_date, cycle.end_date, byDate]);
  const weeks = React.useMemo(() => Array.from({ length: slots.length / 7 }, (_, w) => slots.slice(w * 7, w * 7 + 7)), [slots]);

  const initialFocus = React.useMemo(() => {
    const t = slots.findIndex((s) => s.date === today && s.inCycle);
    return t >= 0 ? t : slots.findIndex((s) => s.inCycle);
  }, [slots, today]);
  const [focus, setFocus] = React.useState(initialFocus);
  React.useEffect(() => setFocus(initialFocus), [initialFocus]);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const move = (to: number) => {
    let i = Math.max(0, Math.min(slots.length - 1, to));
    // skip out-of-cycle padding
    while (i >= 0 && i < slots.length && !slots[i].inCycle) i += to > focus ? 1 : -1;
    if (i < 0 || i >= slots.length) return;
    setFocus(i);
    refs.current[i]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
    if (e.key in map) { e.preventDefault(); move(focus + map[e.key]); }
    else if (e.key === "Home") { e.preventDefault(); move(slots.findIndex((s) => s.inCycle)); }
    else if (e.key === "End") { e.preventDefault(); let i = slots.length - 1; while (i > 0 && !slots[i].inCycle) i--; move(i); }
  };

  const locked = cycle.status === "locked";

  return (
    <div role="grid" aria-label={`Attendance calendar for cycle ${cycle.label}`} onKeyDown={onKeyDown} className="grid gap-1.5">
      <div role="row" className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} role="columnheader" className="pb-1 text-center text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="sm:hidden">{w[0]}</span><span className="hidden sm:inline">{w}</span>
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div role="row" key={wi} className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {week.map((s, di) => {
            const idx = wi * 7 + di;
            if (!s.inCycle) return <div key={s.date} role="gridcell" aria-hidden className="min-h-[58px] sm:min-h-[76px]" />;
            return (
              <DayCell key={s.date} slot={s} today={today} locked={locked} tabIndex={idx === focus ? 0 : -1}
                ref={(el) => { refs.current[idx] = el; }} onFocus={() => setFocus(idx)}
                onRequestCorrection={onRequestCorrection} />
            );
          })}
        </div>
      ))}
    </div>
  );
}

const DayCell = React.forwardRef<HTMLButtonElement, {
  slot: Slot; today: string; locked: boolean; tabIndex: number; onFocus: () => void;
  onRequestCorrection: (date: string, status: string | null) => void;
}>(({ slot, today, locked, tabIndex, onFocus, onRequestCorrection }, ref) => {
  const [open, setOpen] = React.useState(false);
  const d = slot.detail;
  const code = d && d.status !== "-" ? d.status : null;
  const meta = statusMeta(code);
  const Icon = meta?.icon;
  const isToday = slot.date === today;
  const future = slot.date > today;
  const paid = num(d?.paid_leave), lop = num(d?.lop), coUsed = num(d?.comp_off_used), coEarned = num(d?.comp_off_earned);
  const dt = parseISO(slot.date);
  const showMonth = dt.getDate() === 1 || dt.getDate() === 20;
  const label = `${format(dt, "EEEE d MMMM")}: ${meta?.label ?? (future ? "Upcoming" : "Not marked")}` +
    `${lop ? `, ${fmtDays(lop)} LOP` : ""}${paid ? `, ${fmtDays(paid)} paid leave` : ""}${isToday ? ", today" : ""}`;
  const canCorrect = !future && !locked && code !== "NJ" && code !== "EX";

  return (
    <div role="gridcell" className="min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button ref={ref} type="button" tabIndex={tabIndex} onFocus={onFocus} aria-label={label}
            className={cn("relative flex h-full min-h-[58px] w-full cursor-pointer flex-col items-start justify-between rounded-lg p-1.5 text-left " +
              "transition-[transform,box-shadow,background-color] duration-base ease-out-expo hover:-translate-y-px hover:shadow-e2 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
              "active:scale-[.97] motion-reduce:transform-none sm:min-h-[76px] sm:p-2",
              meta ? cn(meta.soft, CELL_BG[meta.code]) : future ? "border border-dashed bg-surface/60" : "bg-muted/60 ring-1 ring-inset ring-border",
              isToday && "ring-2 ring-primary ring-offset-1 ring-offset-background",
              open && "shadow-e2")}>
            <span className={cn("text-xs font-semibold leading-none tnum sm:text-sm", !meta && "text-muted-foreground",
              isToday && "text-primary")}>
              {dt.getDate()}
              {showMonth && <span className="ml-0.5 hidden text-2xs font-medium opacity-70 sm:inline">{format(dt, "MMM")}</span>}
            </span>
            {meta && Icon ? (
              <span className="flex w-full items-center gap-0.5 text-[10px] font-bold leading-none sm:text-2xs">
                <Icon className="size-3 shrink-0 sm:size-3.5" aria-hidden /><span className="truncate">{meta.code}</span>
              </span>
            ) : (
              <span className="text-[10px] leading-none text-muted-foreground sm:text-2xs">{future ? "" : "—"}</span>
            )}
            {(lop > 0 || paid > 0) && (
              <span className="absolute right-1 top-1 flex gap-0.5 sm:right-1.5 sm:top-1.5" aria-hidden>
                {paid > 0 && <span className="size-1.5 rounded-full bg-status-l" />}
                {lop > 0 && <span className="size-1.5 rounded-full bg-destructive" />}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64" align="center">
          <div className="grid gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{format(dt, "EEEE")}</p>
                <p className="text-xs text-muted-foreground tnum">{format(dt, "d MMMM yyyy")}{isToday ? " · today" : ""}</p>
              </div>
              {meta ? <StatusBadge code={code} showLabel /> : (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <CalendarClock className="size-3.5" aria-hidden />{future ? "Upcoming" : "Not marked"}
                </span>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Paid leave" value={paid} icon={<Palmtree className="size-3 text-status-l-fg" aria-hidden />} />
              <Stat label="Loss of pay" value={lop} danger icon={<BadgeMinus className="size-3 text-destructive" aria-hidden />} />
              {(coUsed > 0 || coEarned > 0) && <>
                <Stat label="Comp-off used" value={coUsed} />
                <Stat label="Comp-off earned" value={coEarned} />
              </>}
            </dl>
            {d?.note && <p className="rounded-md bg-surface-sunken/70 px-2 py-1.5 text-xs text-muted-foreground">{d.note}</p>}
            {(code === "WO" || code === "H") && <p className="text-2xs text-muted-foreground">Weekly offs and holidays are paid.</p>}
            {canCorrect ? (
              <Button size="sm" variant="soft" onClick={() => { setOpen(false); onRequestCorrection(slot.date, code); }}>
                <Wrench />Request correction
              </Button>
            ) : locked && !future ? (
              <p className="flex items-center gap-1.5 text-2xs text-muted-foreground"><Lock className="size-3" aria-hidden />
                This cycle is locked — contact HR for changes.</p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
});
DayCell.displayName = "DayCell";

function Stat({ label, value, icon, danger }: { label: string; value: number; icon?: React.ReactNode; danger?: boolean }) {
  return (
    <div className="rounded-md border bg-surface px-2 py-1.5">
      <dt className="flex items-center gap-1 text-2xs text-muted-foreground">{icon}{label}</dt>
      <dd className={cn("text-sm font-semibold tnum", danger && value > 0 && "text-destructive")}>{fmtDays(value)}</dd>
    </div>
  );
}
