import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Eraser, Search } from "lucide-react";
import { toast } from "sonner";
import { client, errorMessage, unwrap } from "@/lib/api";
import { SETTABLE, STATUS, type StatusCode } from "@/lib/status";
import { cn, isoDate } from "@/lib/utils";
import type { Cycle, GridRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { PersonAvatar } from "@/components/ui/misc";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type RangeStatus = StatusCode | "CLEAR";
type Scope = "all" | "filtered" | "selected";

const FUTURE_OK = new Set<RangeStatus>(["L", "CO", "WFH", "OD", "WO", "H", "CLEAR"]);

const STATUS_OPTIONS: { value: RangeStatus; label: string; hint: string }[] = [
  ...SETTABLE.map((code) => ({ value: code as RangeStatus, label: STATUS[code].label, hint: code })),
  { value: "CLEAR", label: "Clear", hint: "Remove marks" },
];

export function MarkRangeDialog({
  open, onOpenChange, cycle, filteredEmployees, onUndo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cycle: Cycle | undefined;
  filteredEmployees: GridRow[];
  onUndo: (previous: { employee_id: number; date: string; status: string | null }[]) => void;
}) {
  const qc = useQueryClient();
  const today = isoDate(new Date());
  const cycleStart = cycle?.start_date ?? today;
  const defaultEnd = cycle ? (cycle.end_date < today ? cycle.end_date : today) : today;

  const [start, setStart] = React.useState(cycleStart);
  const [end, setEnd] = React.useState(defaultEnd);
  const [status, setStatus] = React.useState<RangeStatus>("P");
  const [scope, setScope] = React.useState<Scope>("filtered");
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(() => new Set());
  const [empSearch, setEmpSearch] = React.useState("");
  const [onlyUnmarked, setOnlyUnmarked] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStart(cycleStart);
    setEnd(defaultEnd);
    setStatus("P");
    setScope("filtered");
    setSelectedIds(new Set());
    setEmpSearch("");
    setOnlyUnmarked(false);
    setTouched(false);
  }, [open, cycleStart, defaultEnd]);

  const allowFuture = FUTURE_OK.has(status);
  const maxDate = allowFuture && cycle ? cycle.end_date : today;

  const errors = React.useMemo(() => {
    const e: { start?: string; end?: string; selected?: string } = {};
    if (!start) e.start = "Choose a start date";
    if (!end) e.end = "Choose an end date";
    if (start && end && end < start) e.end = "End date must be on or after start date";
    if (start && start > today && !allowFuture) e.start = "Start date cannot be in the future for this status";
    if (scope === "selected" && selectedIds.size === 0) e.selected = "Pick at least one employee";
    if (scope === "filtered" && filteredEmployees.length === 0) e.selected = "No employees match the current filters";
    return e;
  }, [start, end, today, allowFuture, scope, selectedIds, filteredEmployees.length]);
  const invalid = !!errors.start || !!errors.end || !!errors.selected;

  const employeeIds = React.useMemo(() => {
    if (scope === "all") return null;
    if (scope === "selected") return Array.from(selectedIds);
    return filteredEmployees.map((e) => e.id);
  }, [scope, selectedIds, filteredEmployees]);

  const m = useMutation({
    mutationFn: () => unwrap(client.POST("/api/attendance/mark-range", {
      body: {
        start_date: start,
        end_date: end,
        status: status === "CLEAR" ? null : status,
        only_unmarked: onlyUnmarked,
        employee_ids: employeeIds,
      },
    })),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["grid"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      const label = status === "CLEAR" ? "cleared" : STATUS[status].label.toLowerCase();
      const previous = res.previous.map((p) => ({
        employee_id: p.employee_id, date: p.date, status: p.status,
      }));
      const n = res.count ?? res.applied.length;
      toast.success(
        n
          ? status === "CLEAR"
            ? `Cleared ${n} day${n === 1 ? "" : "s"}`
            : `Marked ${n} day${n === 1 ? "" : "s"} ${label}`
          : status === "CLEAR"
            ? "Nothing to clear"
            : `Nothing to mark — already ${label}`,
        {
          description: n ? "Sundays, holidays and leave days were left alone." : undefined,
          action: n ? { label: "Undo", onClick: () => onUndo(previous) } : undefined,
          duration: 7000,
        },
      );
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const filteredCount = filteredEmployees.length;
  const picked = selectedIds.size;
  const statusLabel = status === "CLEAR" ? "Clear marks" : `Mark ${STATUS[status].label.toLowerCase()}`;

  const visibleEmployees = React.useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    if (!q) return filteredEmployees;
    return filteredEmployees.filter((e) =>
      e.full_name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q)
      || (e.department ?? "").toLowerCase().includes(q));
  }, [filteredEmployees, empSearch]);

  const toggleId = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      visibleEmployees.forEach((e) => next.add(e.id));
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !m.isPending && onOpenChange(v)}>
      <DialogContent className="max-h-[min(92vh,720px)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="size-5 text-primary" aria-hidden />
            Mark date range
          </DialogTitle>
          <DialogDescription>
            Apply a status (or clear) from one date to another for everyone, your current filters, or a handful of people you pick.
          </DialogDescription>
        </DialogHeader>

        <form id="mark-range-form" className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!invalid) m.mutate();
        }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="mark-range-from" required error={touched ? errors.start : undefined}>
              <Input id="mark-range-from" type="date" value={start} max={maxDate}
                onChange={(e) => setStart(e.target.value)}
                aria-invalid={(touched && !!errors.start) || undefined} />
            </Field>
            <Field label="To" htmlFor="mark-range-to" required error={touched ? errors.end : undefined}>
              <Input id="mark-range-to" type="date" value={end} max={maxDate}
                onChange={(e) => setEnd(e.target.value)}
                aria-invalid={(touched && !!errors.end) || undefined} />
            </Field>
          </div>

          <Field label="Status" hint={allowFuture ? "This status can be marked on future dates." : undefined}>
            <div role="radiogroup" aria-label="Status" className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {STATUS_OPTIONS.map((o) => {
                const on = status === o.value;
                const meta = o.value === "CLEAR" ? null : STATUS[o.value];
                const Icon = o.value === "CLEAR" ? Eraser : meta!.icon;
                return (
                  <button key={o.value} type="button" role="radio" aria-checked={on}
                    onClick={() => setStatus(o.value)}
                    className={cn(
                      "flex cursor-pointer flex-col items-start gap-1 rounded-lg border bg-surface px-2.5 py-2 text-left transition-[border-color,box-shadow] duration-base",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-primary shadow-e1 ring-1 ring-primary" : "hover:bg-muted/60",
                    )}>
                    <span className={cn("flex size-6 items-center justify-center rounded-md text-[10px] font-bold",
                      meta ? meta.soft : "bg-muted text-muted-foreground")}>
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="text-xs font-medium leading-tight">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Apply to" error={touched ? errors.selected : undefined}>
            <ChoiceGroup
              label="Apply to"
              value={scope}
              onChange={(v) => {
                setScope(v);
                if (v === "selected" && selectedIds.size === 0 && filteredEmployees.length) {
                  // seed with nothing — user picks explicitly
                }
              }}
              options={[
                { value: "filtered", label: "Current filters", hint: `${filteredCount} people` },
                { value: "selected", label: "Pick people", hint: picked ? `${picked} selected` : "Choose 1+" },
                { value: "all", label: "Everyone", hint: "All employees" },
              ]}
            />
          </Field>

          {scope === "selected" && (
            <div className="grid gap-2 rounded-lg border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input value={empSearch} onChange={(e) => setEmpSearch(e.target.value)}
                    placeholder="Search name or code" aria-label="Search employees" className="h-8 pl-8 text-sm" />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={selectVisible}
                  disabled={!visibleEmployees.length}>Select shown</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}
                  disabled={!picked}>Clear</Button>
              </div>
              <ul className="max-h-48 overflow-y-auto scrollbar-thin" role="listbox" aria-label="Employees"
                aria-multiselectable="true">
                {visibleEmployees.length === 0 ? (
                  <li className="px-1 py-4 text-center text-sm text-muted-foreground">No employees match.</li>
                ) : visibleEmployees.map((e) => {
                  const on = selectedIds.has(e.id);
                  return (
                    <li key={e.id}>
                      <button type="button" role="option" aria-selected={on}
                        onClick={() => toggleId(e.id)}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
                          "hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          on && "bg-primary/10",
                        )}>
                        <span className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded border text-[10px]",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-surface",
                        )} aria-hidden>
                          {on ? "✓" : ""}
                        </span>
                        <PersonAvatar name={e.full_name} src={e.photo_url} size={24} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{e.full_name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {e.code}{e.department ? ` · ${e.department}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                {picked ? `${picked} selected` : "Select a few people from the list above."}
                {" "}List mirrors the employees currently shown on the attendance grid.
              </p>
            </div>
          )}

          {status !== "CLEAR" && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-surface p-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 rounded border-input"
                checked={onlyUnmarked} onChange={(e) => setOnlyUnmarked(e.target.checked)} />
              <span>
                <span className="font-medium">Only fill unmarked days</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Leave existing marks unchanged. Turn off to overwrite other manual marks (leave days stay protected).
                </span>
              </span>
            </label>
          )}
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
          <Button type="submit" form="mark-range-form" loading={m.isPending}
            disabled={(scope === "filtered" && !filteredCount) || (scope === "selected" && !picked)}>
            {statusLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceGroup<T extends string>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint: string }[];
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-2">
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
            ref={(el) => { refs.current[i] = el; }}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1
                : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const n = (i + d + options.length) % options.length;
              onChange(options[n].value);
              refs.current[n]?.focus();
            }}
            className={cn(
              "cursor-pointer rounded-lg border bg-surface px-2.5 py-2.5 text-left transition-[border-color,box-shadow] duration-base",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary shadow-e1 ring-1 ring-primary" : "hover:bg-muted/60",
            )}>
            <span className="block text-sm font-medium leading-tight">{o.label}</span>
            <span className="block text-xs text-muted-foreground">{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
