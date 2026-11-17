import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Columns3, Keyboard, Lock, Search, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { client, unwrap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCycle } from "@/lib/cycle";
import { useDepartments } from "@/hooks/queries";
import { isoDate } from "@/lib/utils";
import type { GridRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd, Skeleton } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, InlineAlert, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusLegend } from "@/components/shared/status-badge";
import { STATUS } from "@/lib/status";
import { CycleSwitcher } from "@/components/layout/topbar";
import { AttendanceGrid, type AttendanceGridHandle, LEGEND_CODES } from "@/features/attendance/attendance-grid";
import { EmployeeSidePanel } from "@/features/attendance/side-panel";
import { useGrid, useSaveMarks, type GridFilters } from "@/features/attendance/use-attendance";

const ALL = "__all";

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function AttendancePage() {
  const { can } = useAuth();
  const { cycle } = useCycle();
  const qc = useQueryClient();
  const deps = useDepartments();
  const [search, setSearch] = React.useState("");
  const [dept, setDept] = React.useState(ALL);
  const [etype, setEtype] = React.useState(ALL);
  const [status, setStatus] = React.useState("active");
  const debounced = useDebounced(search);
  const filters: GridFilters = {
    search: debounced || undefined,
    department_id: dept === ALL ? undefined : Number(dept),
    employment_type: etype === ALL ? undefined : etype,
    status: status === ALL ? undefined : status,
  };
  const grid = useGrid(cycle?.id, filters);
  const { save } = useSaveMarks(cycle?.id, filters);
  const [selected, setSelected] = React.useState<GridRow | null>(null);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const gridRef = React.useRef<AttendanceGridHandle>(null);
  const locked = grid.data?.cycle.status === "locked";
  const editable = can("hr_admin") && !locked;
  const today = isoDate(new Date());
  const todayInCycle = !!grid.data?.days.some((d) => d.is_today);

  const unmarkedToday = React.useMemo(() => {
    if (!grid.data) return 0;
    const i = grid.data.days.findIndex((d) => d.is_today);
    if (i < 0) return 0;
    return grid.data.employees.filter((e) => e.cells[i].s === null).length;
  }, [grid.data]);

  const markAll = useMutation({
    mutationFn: () => unwrap(client.POST("/api/attendance/mark-all-present", {
      body: { date: today, employee_ids: grid.data?.employees.map((e) => e.id) } })),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["grid"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      const previous = res.previous.map((p) => ({ employee_id: p.employee_id, date: p.date, status: p.status }));
      toast.success(res.count ? `Marked ${res.count} employee${res.count === 1 ? "" : "s"} present` : "Everyone is already marked",
        { description: res.count ? "Now tap the exceptions." : undefined,
          action: res.count ? { label: "Undo", onClick: () => save(previous, { undo: true }) } : undefined });
    },
  });

  const selectEmployee = React.useCallback((row: GridRow) => setSelected(row), []);
  const rows = grid.data?.employees;
  React.useEffect(() => {
    if (selected && rows) setSelected(rows.find((r) => r.id === selected.id) ?? null);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader
        title="Daily attendance"
        eyebrow={cycle?.label}
        description={locked ? "This cycle is locked — attendance is read-only." :
          editable ? "Mark everyone present, then tap the exceptions. Changes save automatically." :
            "Your team's attendance for the selected cycle."}
        actions={<>
          <CycleSwitcher className="sm:hidden" />
          <ShortcutsButton />
          {can("hr_admin") && (
            <Button variant="outline" asChild><Link to="/import"><Upload />Import</Link></Button>
          )}
          {editable && todayInCycle && (<>
            <Button variant="outline" onClick={() => gridRef.current?.selectToday()}><Columns3 />Select today</Button>
            <Button onClick={() => markAll.mutate()} loading={markAll.isPending} disabled={unmarkedToday === 0}>
              <CheckCheck />Mark all present{unmarkedToday ? <span className="rounded-full bg-white/20 px-1.5 text-xs tnum">{unmarkedToday}</span> : null}
            </Button>
          </>)}
        </>}
      />

      {locked && (
        <InlineAlert tone="info" icon={<Lock className="size-4" />} className="mb-4" title="Locked cycle">
          {grid.data?.cycle.locked_at ? `Locked on ${new Date(grid.data.cycle.locked_at + "Z").toLocaleString()}. ` : ""}
          HR can unlock it from Cycle close &amp; reports (a reason is required and audited).
        </InlineAlert>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code"
            aria-label="Search employees" className="pl-8" />
        </div>
        <Select value={dept} onValueChange={setDept}>
          <SelectTrigger className="w-[calc(50%-4px)] sm:w-44" aria-label="Department"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {deps.data?.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={etype} onValueChange={setEtype}>
          <SelectTrigger className="w-[calc(50%-4px)] sm:w-40" aria-label="Employment type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {["probation", "permanent", "contract", "intern"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t[0].toUpperCase() + t.slice(1)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[calc(50%-4px)] sm:w-36" aria-label="Employee status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="exited">Exited</SelectItem>
          </SelectContent>
        </Select>
        <StatusLegend codes={LEGEND_CODES.filter((c) => c !== "NJ" && c !== "EX")} className="ml-auto hidden 2xl:flex" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {grid.isLoading ? (
            <Skeleton className="h-[480px] rounded-xl" />
          ) : grid.isError ? (
            <ErrorState error={grid.error} onRetry={() => grid.refetch()} />
          ) : !grid.data?.employees.length ? (
            <div className="rounded-xl border bg-card"><EmptyState art="search" title="No employees match"
              description="Try clearing the filters or searching for a different name." /></div>
          ) : (
            <AttendanceGrid ref={gridRef} grid={grid.data} editable={editable} onSave={save}
              selectedEmployeeId={selected?.id ?? null}
              onSelectEmployee={(r) => { selectEmployee(r); if (window.matchMedia("(max-width: 1279px)").matches) setPanelOpen(true); }} />
          )}
          <StatusLegend codes={LEGEND_CODES} className="mt-3 2xl:hidden" />
        </div>
        <aside className="hidden xl:block" aria-label="Employee summary">
          <div className="sticky top-20 rounded-xl border bg-card p-4 shadow-e1">
            <EmployeeSidePanel row={selected} cycleId={cycle?.id} />
          </div>
        </aside>
      </div>

      <Dialog open={panelOpen && !!selected} onOpenChange={setPanelOpen}>
        <DialogContent side="right" className="xl:hidden">
          <DialogHeader><DialogTitle>Cycle summary</DialogTitle></DialogHeader>
          <EmployeeSidePanel row={selected} cycleId={cycle?.id} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShortcutsButton() {
  const keys = Object.values(STATUS).filter((s) => s.key);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts"><Keyboard /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="mb-2 text-sm font-semibold">Keyboard shortcuts</p>
        <ul className="grid gap-1.5 text-sm">
          <li className="flex justify-between"><span>Move</span><span className="flex gap-1"><Kbd>←</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>→</Kbd></span></li>
          <li className="flex justify-between"><span>Extend selection</span><span className="flex gap-1"><Kbd>Shift</Kbd>+ arrows / click</span></li>
          <li className="flex justify-between"><span>Open picker</span><Kbd>Enter</Kbd></li>
          <li className="flex justify-between"><span>Clear mark</span><Kbd>Del</Kbd></li>
          <li className="flex justify-between"><span>Select a whole day</span><span className="text-muted-foreground">click the date</span></li>
        </ul>
        <div className="mt-3 grid grid-cols-2 gap-1.5 border-t pt-3 text-sm">
          {keys.map((s) => (
            <span key={s.code} className="flex items-center gap-2"><Kbd>{s.key!.toUpperCase()}</Kbd>{s.label}</span>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Ranges skip Sundays and holidays so nobody earns a comp-off by accident.</p>
      </PopoverContent>
    </Popover>
  );
}
