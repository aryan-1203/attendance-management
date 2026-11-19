import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { toast } from "sonner";
import { client, errorMessage, unwrap } from "@/lib/api";
import { cn, isoDate } from "@/lib/utils";
import type { Cycle, GridRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Status = "P" | "A";
type Scope = "all" | "filtered";

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
  const cycleEnd = cycle ? (cycle.end_date < today ? cycle.end_date : today) : today;

  const [start, setStart] = React.useState(cycleStart);
  const [end, setEnd] = React.useState(cycleEnd);
  const [status, setStatus] = React.useState<Status>("P");
  const [scope, setScope] = React.useState<Scope>("filtered");
  const [onlyUnmarked, setOnlyUnmarked] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStart(cycleStart);
    setEnd(cycleEnd);
    setStatus("P");
    setScope("filtered");
    setOnlyUnmarked(false);
    setTouched(false);
  }, [open, cycleStart, cycleEnd]);

  const errors = React.useMemo(() => {
    const e: { start?: string; end?: string } = {};
    if (!start) e.start = "Choose a start date";
    if (!end) e.end = "Choose an end date";
    if (start && end && end < start) e.end = "End date must be on or after start date";
    if (start && start > today) e.start = "Start date cannot be in the future";
    return e;
  }, [start, end, today]);
  const invalid = !!errors.start || !!errors.end;

  const m = useMutation({
    mutationFn: () => unwrap(client.POST("/api/attendance/mark-range", {
      body: {
        start_date: start,
        end_date: end,
        status,
        only_unmarked: onlyUnmarked,
        employee_ids: scope === "filtered" ? filteredEmployees.map((e) => e.id) : null,
      },
    })),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["grid"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      const label = status === "P" ? "present" : "absent";
      const previous = res.previous.map((p) => ({
        employee_id: p.employee_id, date: p.date, status: p.status,
      }));
      const n = res.count ?? res.applied.length;
      toast.success(
        n ? `Marked ${n} day${n === 1 ? "" : "s"} ${label}` : `Nothing to mark — everyone is already ${label}`,
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
  const statusLabel = status === "P" ? "Present" : "Absent";

  return (
    <Dialog open={open} onOpenChange={(v) => !m.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="size-5 text-primary" aria-hidden />
            Mark date range
          </DialogTitle>
          <DialogDescription>
            Apply present or absent from one date to another for everyone, or just the people matching your current filters.
          </DialogDescription>
        </DialogHeader>

        <form id="mark-range-form" className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!invalid) m.mutate();
        }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="mark-range-from" required error={touched ? errors.start : undefined}>
              <Input id="mark-range-from" type="date" value={start} max={today}
                onChange={(e) => setStart(e.target.value)}
                aria-invalid={(touched && !!errors.start) || undefined} />
            </Field>
            <Field label="To" htmlFor="mark-range-to" required error={touched ? errors.end : undefined}>
              <Input id="mark-range-to" type="date" value={end} max={today}
                onChange={(e) => setEnd(e.target.value)}
                aria-invalid={(touched && !!errors.end) || undefined} />
            </Field>
          </div>

          <Field label="Status">
            <ChoiceGroup
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "P", label: "Present", hint: "Mark as P" },
                { value: "A", label: "Absent", hint: "Mark as A" },
              ]}
            />
          </Field>

          <Field label="Apply to" hint={scope === "filtered"
            ? `Uses the ${filteredCount} employee${filteredCount === 1 ? "" : "s"} currently shown in the grid.`
            : "Every employee employed during this date range."}>
            <ChoiceGroup
              label="Apply to"
              value={scope}
              onChange={setScope}
              options={[
                { value: "filtered", label: "Current filters", hint: `${filteredCount} people` },
                { value: "all", label: "Everyone", hint: "All employees" },
              ]}
            />
          </Field>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-surface p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 rounded border-input"
              checked={onlyUnmarked} onChange={(e) => setOnlyUnmarked(e.target.checked)} />
            <span>
              <span className="font-medium">Only fill unmarked days</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Leave existing marks unchanged. Turn off to overwrite present/absent/half-day marks (leave days stay protected).
              </span>
            </span>
          </label>
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={m.isPending}>Cancel</Button>
          <Button type="submit" form="mark-range-form" loading={m.isPending} disabled={!filteredCount && scope === "filtered"}>
            Mark {statusLabel.toLowerCase()}
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
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2">
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
              "cursor-pointer rounded-lg border bg-surface px-3 py-2.5 text-left transition-[border-color,box-shadow] duration-base",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary shadow-e1 ring-1 ring-primary" : "hover:bg-muted/60",
            )}>
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="block text-xs text-muted-foreground">{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
