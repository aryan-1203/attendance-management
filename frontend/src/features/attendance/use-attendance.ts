import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { client, errorMessage, unwrap } from "@/lib/api";
import type { Grid } from "@/lib/types";

export interface GridFilters { search?: string; department_id?: number; employment_type?: string; status?: string }
export interface Change { employee_id: number; date: string; status: string | null }

export function useGrid(cycleId: number | undefined, f: GridFilters) {
  return useQuery({
    queryKey: ["grid", cycleId, f],
    enabled: !!cycleId,
    placeholderData: (prev) => prev,
    queryFn: () => unwrap(client.GET("/api/attendance/grid", { params: { query: { cycle_id: cycleId, ...f } } })),
  });
}

/** Optimistic bulk save with undo. */
export function useSaveMarks(cycleId: number | undefined, f: GridFilters) {
  const qc = useQueryClient();
  const key = ["grid", cycleId, f];
  const m = useMutation({
    meta: { silent: true },
    mutationFn: (changes: Change[]) => unwrap(client.POST("/api/attendance/bulk", { body: { changes } })),
    onMutate: async (changes) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Grid>(key);
      if (prev) qc.setQueryData<Grid>(key, applyLocal(prev, changes));
      return { prev };
    },
    onError: (err, _changes, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(errorMessage(err));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const save = React.useCallback((changes: Change[], opts: { undo?: boolean } = {}) => {
    if (!changes.length) return;
    m.mutate(changes, {
      onSuccess: (res) => {
        const n = changes.length;
        if (opts.undo) { toast.success("Change undone"); return; }
        const previous: Change[] = res.previous.map((p) => ({ employee_id: p.employee_id, date: p.date, status: p.status }));
        toast.success(n === 1 ? `Marked ${changes[0].status ?? "cleared"}` : `Saved ${n} changes`, {
          description: res.ledger_rows ? `Leave ledger updated (${res.ledger_rows} entr${res.ledger_rows === 1 ? "y" : "ies"})` : undefined,
          action: { label: "Undo", onClick: () => save(previous, { undo: true }) },
          duration: 6000,
        });
      },
    });
  }, [m]);
  return { save, isSaving: m.isPending };
}

function applyLocal(grid: Grid, changes: Change[]): Grid {
  const idx = new Map(grid.days.map((d, i) => [d.date, i]));
  const byEmp = new Map<number, Change[]>();
  changes.forEach((c) => byEmp.set(c.employee_id, [...(byEmp.get(c.employee_id) ?? []), c]));
  return {
    ...grid,
    employees: grid.employees.map((e) => {
      const ch = byEmp.get(e.id);
      if (!ch) return e;
      const cells = e.cells.slice();
      ch.forEach((c) => {
        const i = idx.get(c.date);
        if (i === undefined) return;
        const day = grid.days[i];
        const auto = c.status === null ? (day.is_holiday ? "H" : day.weekday === 6 ? "WO" : null) : null;
        cells[i] = c.status === null
          ? { s: auto, auto: true, src: null, late: false, note: null }
          : { ...cells[i], s: c.status, auto: false, src: "manual" };
      });
      return { ...e, cells };
    }),
  };
}
