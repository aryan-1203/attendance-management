import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format, parseISO } from "date-fns";
import { Lock } from "lucide-react";
import { PersonAvatar } from "@/components/ui/misc";
import { KEY_TO_STATUS, STATUS, type StatusCode, statusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Grid, GridDay, GridRow, Cell } from "@/lib/types";
import type { Change } from "./use-attendance";
import { PickerOverlay } from "./picker-overlay";
import { RadialPicker } from "./radial-picker";

const ROW_H = 44;
const CELL_W = 42;
const NAME_W = 232;
const FUTURE_OK = new Set<StatusCode>(["L", "CO", "WFH", "OD", "WO", "H"]);

interface Pos { r: number; c: number }
interface Range { r0: number; r1: number; c0: number; c1: number }

/** Stable function identity that always calls the latest closure (keeps memoized rows from re-rendering). */
function useStable<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = React.useRef(fn);
  ref.current = fn;
  return React.useCallback(((...args) => ref.current(...args)) as T, []);
}

function norm(a: Pos, b: Pos): Range {
  return { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) };
}

export function AttendanceGrid({ grid, editable, onSave, onSelectEmployee, onOpenSummary, selectedEmployeeId }: {
  grid: Grid; editable: boolean; onSave: (changes: Change[]) => void; onSelectEmployee: (row: GridRow) => void;
  /** Open the employee cycle summary (e.g. mobile sheet). Defaults to onSelectEmployee. */
  onOpenSummary?: (row: GridRow) => void;
  selectedEmployeeId: number | null;
}) {
  const rows = grid.employees;
  const days = grid.days;
  const todayIdx = days.findIndex((d) => d.is_today);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = React.useState<Pos | null>(null);
  const [focus, setFocus] = React.useState<Pos | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerAnchor, setPickerAnchor] = React.useState<DOMRect | null>(null);
  const [flash, setFlash] = React.useState<Set<string>>(new Set());
  const closePicker = React.useCallback(() => setPickerOpen(false), []);

  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H,
    overscan: 10 });
  const range = anchor && focus ? norm(anchor, focus) : null;

  // on load, bring today's column into view (horizontally)
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || todayIdx < 0) return;
    const target = NAME_W + todayIdx * CELL_W - el.clientWidth / 2 + CELL_W / 2;
    el.scrollLeft = Math.max(0, target);
  }, [todayIdx, grid.cycle.id]);

  const canEditCell = React.useCallback((cell: Cell, day: GridDay, code?: StatusCode | null) => {
    if (!editable || cell.s === "NJ" || cell.s === "EX") return false;
    if (code && day.is_future && !FUTURE_OK.has(code)) return false;
    return true;
  }, [editable]);

  // keep focused cell scrolled into view + DOM-focused (roving tabindex)
  const focusCell = React.useCallback((p: Pos) => {
    virt.scrollToIndex(p.r, { align: "auto" });
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${p.r}:${p.c}"]`);
      if (el) {
        el.focus({ preventScroll: false });
        const box = scrollRef.current!.getBoundingClientRect();
        const left = el.offsetLeft;
        if (left - scrollRef.current!.scrollLeft < NAME_W) scrollRef.current!.scrollLeft = left - NAME_W - 8;
        else if (left + CELL_W - scrollRef.current!.scrollLeft > box.width) scrollRef.current!.scrollLeft = left + CELL_W - box.width + 8;
      }
    });
  }, [virt]);

  const apply = React.useCallback((code: StatusCode | null, rng: Range | null = range) => {
    if (!rng) return;
    const multi = rng.r1 > rng.r0 || rng.c1 > rng.c0;
    const changes: Change[] = [];
    const keys: string[] = [];
    for (let r = rng.r0; r <= rng.r1; r++) {
      const row = rows[r];
      for (let c = rng.c0; c <= rng.c1; c++) {
        const cell = row.cells[c];
        const day = days[c];
        if (!canEditCell(cell, day, code)) continue;
        // in a range, never touch auto weekly-offs/holidays (avoids accidental comp-offs)
        if (multi && cell.auto && (cell.s === "WO" || cell.s === "H")) continue;
        if (code === null && cell.auto) continue;
        if (!cell.auto && cell.s === code) continue;
        if (cell.auto && cell.s === code) continue;
        changes.push({ employee_id: row.id, date: day.date, status: code });
        keys.push(`${r}:${c}`);
      }
    }
    if (changes.length) {
      onSave(changes);
      setFlash(new Set(keys));
      window.setTimeout(() => setFlash(new Set()), 450);
    }
  }, [range, rows, days, canEditCell, onSave]);

  const openPicker = (p: Pos) => {
    const el = scrollRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${p.r}:${p.c}"]`);
    if (!el) return;
    // Scroll the cell into view first so the overlay can anchor on-screen.
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    requestAnimationFrame(() => {
      setPickerAnchor(el.getBoundingClientRect());
      setPickerOpen(true);
    });
  };

  // Dismiss the picker if the grid scrolls underneath it.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pickerOpen) return;
    const onScroll = () => setPickerOpen(false);
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pickerOpen]);

  const onCellFocus = useStable((p: Pos) => {
    if (!focus || focus.r !== p.r || focus.c !== p.c) {
      setFocus(p);
      if (!anchor) setAnchor(p);
    }
  });

  const onCellClick = useStable((e: React.MouseEvent, p: Pos) => {
    if (e.shiftKey && anchor) {
      setFocus(p);
      return;
    }
    setAnchor(p);
    setFocus(p);
    onSelectEmployee(rows[p.r]);
    const cell = rows[p.r].cells[p.c];
    if (canEditCell(cell, days[p.c])) openPicker(p);
  });
  const onNameClick = useStable((r: number) => {
    const row = rows[r];
    (onOpenSummary ?? onSelectEmployee)(row);
  });
  const entry: Pos = { r: 0, c: Math.max(0, todayIdx) };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!focus) return;
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      const next = { r: Math.max(0, Math.min(rows.length - 1, focus.r + dr)), c: Math.max(0, Math.min(days.length - 1, focus.c + dc)) };
      setFocus(next);
      if (!e.shiftKey) setAnchor(next);
      onSelectEmployee(rows[next.r]);
      focusCell(next);
    };
    switch (e.key) {
      case "ArrowUp": return move(-1, 0);
      case "ArrowDown": return move(1, 0);
      case "ArrowLeft": return move(0, -1);
      case "ArrowRight": return move(0, 1);
      case "Home": return move(0, -focus.c);
      case "End": return move(0, days.length - 1 - focus.c);
      case "Enter":
      case " ":
        e.preventDefault();
        if (canEditCell(rows[focus.r].cells[focus.c], days[focus.c])) openPicker(focus);
        return;
      case "Escape":
        setAnchor(focus);
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        apply(null);
        return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const code = KEY_TO_STATUS[e.key.toLowerCase()];
    if (code) {
      e.preventDefault();
      apply(code);
      if (range && range.r0 === range.r1 && range.c0 === range.c1) move(0, 1);
    }
  };

  // per-day present counts for the footer
  const dayCounts = React.useMemo(() => days.map((day, c) => {
    if (day.is_future) return { present: 0, expected: 0 };
    let present = 0;
    let expected = 0;
    rows.forEach((r) => {
      const s = r.cells[c].s;
      if (s === "NJ" || s === "EX" || s === "WO" || s === "H") return;
      expected += 1;
      if (s === "P" || s === "WFH" || s === "OD") present += 1;
      else if (s === "HD") present += 0.5;
    });
    return { present, expected };
  }), [rows, days]);

  const totalW = NAME_W + days.length * CELL_W;
  const items = virt.getVirtualItems();
  const pickerCell = focus ? rows[focus.r]?.cells[focus.c] : null;
  const pickerDay = focus ? days[focus.c] : null;

  return (
    <div className="relative overflow-hidden rounded-xl border bg-card shadow-e1">
      <div ref={scrollRef} onKeyDown={onKeyDown}
        role="grid" aria-label={`Attendance for ${grid.cycle.label}`} aria-rowcount={rows.length + 1}
        aria-colcount={days.length + 1} aria-readonly={!editable}
        className="relative max-h-[calc(100dvh-17rem)] min-h-[320px] overflow-auto overscroll-contain scrollbar-thin">
        <div style={{ width: totalW, height: virt.getTotalSize() + ROW_H * 2 }} className="relative">
          {/* header */}
          <div role="row" className="glass sticky top-0 z-30 flex border-b" style={{ height: ROW_H + 8, width: totalW }}>
            <div role="columnheader" className="sticky left-0 z-40 flex items-end border-r bg-card px-3 pb-2 text-xs font-semibold text-muted-foreground"
              style={{ width: NAME_W, minWidth: NAME_W }}>
              Employee <span className="ml-auto font-normal tnum">{rows.length}</span>
            </div>
            {days.map((d, c) => {
              const dt = parseISO(d.date);
              const weekend = d.weekday === 6;
              return (
                <button type="button" role="columnheader" key={d.date} tabIndex={-1}
                  aria-label={`${format(dt, "EEEE d MMMM")}${d.holiday_name ? `, ${d.holiday_name}` : ""}. Select column`}
                  title={d.holiday_name ?? format(dt, "EEEE d MMM")}
                  onClick={() => { if (rows.length) { setAnchor({ r: 0, c }); setFocus({ r: rows.length - 1, c }); focusCell({ r: 0, c }); } }}
                  className={cn("relative flex shrink-0 cursor-pointer flex-col items-center justify-end pb-1.5 text-center transition-colors hover:bg-muted/60",
                    d.is_today && "text-primary", (weekend || d.is_holiday) && !d.is_today && "text-muted-foreground/70")}
                  style={{ width: CELL_W }}>
                  <span className="text-[10px] font-medium uppercase">{format(dt, "EEEEE")}</span>
                  <span className={cn("mt-0.5 flex size-6 items-center justify-center rounded-full text-xs font-semibold tnum",
                    d.is_today && "bg-primary text-primary-foreground shadow-glow")}>{format(dt, "d")}</span>
                  {d.is_holiday && <span className="absolute top-1 size-1.5 rounded-full bg-status-h" aria-hidden />}
                </button>
              );
            })}
          </div>

          {/* today column highlight */}
          {todayIdx >= 0 && (
            <div aria-hidden className="pointer-events-none absolute z-0 bg-primary/[.06] ring-1 ring-inset ring-primary/15"
              style={{ left: NAME_W + todayIdx * CELL_W, top: 0, width: CELL_W, height: virt.getTotalSize() + ROW_H + 8 }} />
          )}

          {/* rows */}
          <div className="relative" style={{ height: virt.getTotalSize() }}>
            {items.map((vi) => {
              const r = vi.index;
              const inRows = range && r >= range.r0 && r <= range.r1;
              return (
                <GridRowView key={rows[r].id} row={rows[r]} r={r} top={vi.start} days={days}
                  selCols={inRows ? [range!.c0, range!.c1] : null}
                  focusCol={focus ? (focus.r === r ? focus.c : null) : (r === entry.r ? entry.c : null)}
                  flash={flash} editable={editable} canEditCell={canEditCell}
                  selected={rows[r].id === selectedEmployeeId}
                  onCellClick={onCellClick} onCellFocus={onCellFocus} onNameClick={onNameClick} />
              );
            })}
          </div>

          {/* footer: present / expected per day */}
          <div role="row" className="glass sticky bottom-0 z-30 flex border-t text-[10px] text-muted-foreground" style={{ height: ROW_H - 8, width: totalW }}>
            <div className="sticky left-0 z-40 flex items-center border-r bg-card px-3 text-xs font-medium" style={{ width: NAME_W, minWidth: NAME_W }}>
              Present / expected
            </div>
            {dayCounts.map((d, c) => (
              <div key={c} className="flex shrink-0 flex-col items-center justify-center tnum leading-tight" style={{ width: CELL_W }}
                title={`${d.present} of ${d.expected} present`}>
                {d.expected ? (<><span className="font-semibold text-foreground">{d.present}</span><span>/{d.expected}</span></>) : "—"}
              </div>
            ))}
          </div>
        </div>
      </div>

      {!editable && (
        <div className="pointer-events-none absolute right-3 top-3 z-40 hidden items-center gap-1.5 rounded-full glass border px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-e1 sm:flex">
          <Lock className="size-3.5" aria-hidden /> Read-only
        </div>
      )}

      <PickerOverlay open={pickerOpen && !!pickerCell && !!pickerDay} anchor={pickerAnchor} onClose={closePicker}>
        {pickerCell && pickerDay && (
          <RadialPicker current={pickerCell.auto ? null : pickerCell.s}
            allowed={(code) => canEditCell(pickerCell, pickerDay, code)}
            onClose={() => {
              closePicker();
              if (focus) focusCell(focus);
            }}
            onPick={(code) => {
              closePicker();
              apply(code, range);
              if (focus) focusCell(focus);
            }} />
        )}
      </PickerOverlay>
    </div>
  );
}

const GridRowView = React.memo(function GridRowView({ row, r, top, days, selCols, focusCol, flash, editable,
  canEditCell, onCellClick, onCellFocus, onNameClick, selected }: {
  row: GridRow; r: number; top: number; days: GridDay[]; selCols: [number, number] | null; focusCol: number | null;
  flash: Set<string>; editable: boolean; canEditCell: (cell: Cell, day: GridDay) => boolean;
  onCellClick: (e: React.MouseEvent, p: Pos) => void; onCellFocus: (p: Pos) => void; onNameClick: (r: number) => void;
  selected: boolean;
}) {
  return (
    <div role="row" aria-rowindex={r + 2} className="group absolute left-0 flex border-b border-border/70" style={{ top, height: ROW_H }}>
      <div role="rowheader"
        className={cn("sticky left-0 z-20 flex items-center gap-2.5 border-r bg-card px-3 transition-colors group-hover:bg-muted",
          selected && "shadow-[inset_3px_0_0_hsl(var(--primary))]")} style={{ width: NAME_W, minWidth: NAME_W }}>
        <button type="button" tabIndex={-1} onClick={() => onNameClick(r)} className="flex min-w-0 cursor-pointer items-center gap-2.5 text-left">
          <PersonAvatar name={row.full_name} src={row.photo_url} size={26} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium leading-tight">{row.full_name}</span>
            <span className="block truncate text-[11px] text-muted-foreground leading-tight">{row.code} · {row.department ?? "—"}</span>
          </span>
        </button>
        {row.employment_type === "probation" && (
          <span className="ml-auto rounded bg-status-l/12 px-1 text-[9px] font-semibold uppercase text-status-l-fg" title="On probation">Prob</span>
        )}
      </div>
      {row.cells.map((cell, c) => {
        const meta = statusMeta(cell.s);
        const day = days[c];
        const sel = selCols && c >= selCols[0] && c <= selCols[1];
        const isFocus = focusCol === c;
        const locked = cell.s === "NJ" || cell.s === "EX";
        const Icon = meta?.icon;
        const ed = editable && canEditCell(cell, day);
        const label = `${row.full_name}, ${format(parseISO(day.date), "EEE d MMM")}: ${meta ? meta.label : "Not marked"}${cell.auto && meta ? " (auto)" : ""}${cell.note ? `. ${cell.note}` : ""}`;
        return (
          <button key={day.date} type="button" role="gridcell" data-cell={`${r}:${c}`}
            tabIndex={isFocus ? 0 : -1} aria-selected={!!sel} aria-label={label} aria-disabled={!ed || undefined}
            onClick={(e) => onCellClick(e, { r, c })} onFocus={() => onCellFocus({ r, c })}
            className={cn("relative z-10 flex shrink-0 items-center justify-center outline-none",
              locked ? "cursor-default hatched" : "cursor-pointer", sel && "bg-primary/10")}
            style={{ width: CELL_W, height: ROW_H }}>
            {meta && (
              <span key={cell.s ?? ""}
                className={cn("flex h-7 w-[34px] flex-col items-center justify-center rounded-md text-[10px] font-bold leading-none transition-transform duration-fast",
                  locked ? "text-muted-foreground/60" : cell.auto ? "text-muted-foreground/70" : meta.soft,
                  !locked && !cell.auto && "shadow-e1", flash.has(`${r}:${c}`) && "animate-pop-in",
                  ed && "group-hover:scale-[1.03]")}>
                {!locked && !cell.auto && Icon && <Icon className="mb-px size-3" aria-hidden />}
                <span>{cell.s}</span>
              </span>
            )}
            {!meta && ed && !day.is_future && (
              <span className="size-1.5 rounded-full bg-warning/70" aria-hidden title="Not marked" />
            )}
            {cell.late && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive" aria-hidden title="Late" />}
            {cell.src === "leave" && <span className="absolute bottom-1 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded bg-status-l" aria-hidden />}
            {isFocus && <span className="pointer-events-none absolute inset-0.5 rounded-md ring-2 ring-ring" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
});

export const LEGEND_CODES = (Object.keys(STATUS) as StatusCode[]).filter((c) => c !== "LOP");
