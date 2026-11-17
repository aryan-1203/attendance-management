import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, FileUp, LayoutGrid, List, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { client, unwrap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Holiday } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { ErrorState, InlineAlert, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { CountUp } from "@/components/shared/motion";
import { HolidayLegend, YearCalendar } from "@/features/holidays/year-calendar";
import { HolidayList } from "@/features/holidays/holiday-list";
import { HolidayDialog, toastHolidayError } from "@/features/holidays/holiday-dialog";
import { HolidayImportDialog } from "@/features/holidays/import-dialog";
import { HOLIDAY_KINDS, KIND_META } from "@/features/holidays/kinds";

const VIEW_KEY = "ae-holiday-view";

export default function HolidaysPage() {
  const { can } = useAuth();
  const canEdit = can("hr_admin");
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = React.useState(thisYear);
  const [view, setView] = React.useState<"calendar" | "list">(() => {
    try { return (localStorage.getItem(VIEW_KEY) as "calendar" | "list") || "calendar"; } catch { return "calendar"; }
  });
  const [editing, setEditing] = React.useState<{ holiday?: Holiday | null; date?: string } | null>(null);
  const [deleting, setDeleting] = React.useState<Holiday | null>(null);
  const [importing, setImporting] = React.useState(false);

  const q = useQuery({
    queryKey: ["holidays", year],
    placeholderData: (p) => p,
    queryFn: () => unwrap(client.GET("/api/holidays", { params: { query: { year } } })),
  });
  const holidays = q.data ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["holidays"] });
    ["grid", "summary", "dashboard", "profile", "paydays"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const del = useMutation({
    meta: { silent: true },
    mutationFn: (h: Holiday) => unwrap(client.DELETE("/api/holidays/{holiday_id}", { params: { path: { holiday_id: h.id } } })),
    onSuccess: (_d, h) => {
      toast.success(`Removed ${h.name}`, { description: "Open cycles recalculated." });
      setDeleting(null);
      setEditing(null);
      refresh();
    },
    onError: (e) => { setDeleting(null); toastHolidayError(e); },
  });

  const changeView = (v: string) => {
    setView(v as "calendar" | "list");
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  };

  const counts = HOLIDAY_KINDS.map((k) => ({ k, n: holidays.filter((h) => h.kind === k).length }));
  const today = format(new Date(), "yyyy-MM-dd");
  const next = holidays.find((h) => h.date >= today);
  const weekdayCount = holidays.filter((h) => h.kind === "public" && parseISO(h.date).getDay() !== 0).length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Holidays" eyebrow="Calendar"
        description={canEdit ? "Plan the year's holidays. Changes flow straight into attendance and pay days." : "Holidays observed this year."}
        actions={canEdit && <>
          <Button variant="outline" onClick={() => setImporting(true)}><FileUp aria-hidden />Import</Button>
          <Button onClick={() => setEditing({ holiday: null })}><Plus aria-hidden />Add holiday</Button>
        </>} />

      <Tabs value={view} onValueChange={changeView}>
      {/* toolbar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border bg-card p-1 shadow-e1" role="group" aria-label="Year">
          <Button variant="ghost" size="icon-sm" aria-label={`Previous year, ${year - 1}`} onClick={() => setYear((y) => y - 1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <span className="min-w-[4.5rem] text-center text-lg font-semibold tnum" aria-live="polite">{year}</span>
          <Button variant="ghost" size="icon-sm" aria-label={`Next year, ${year + 1}`} onClick={() => setYear((y) => y + 1)}>
            <ChevronRight aria-hidden />
          </Button>
          {year !== thisYear && (
            <Button variant="soft" size="sm" className="ml-1" onClick={() => setYear(thisYear)}>This year</Button>
          )}
        </div>
        <TabsList aria-label="View">
          <TabsTrigger value="calendar"><LayoutGrid aria-hidden />Calendar</TabsTrigger>
          <TabsTrigger value="list"><List aria-hidden />List</TabsTrigger>
        </TabsList>
      </div>

      {/* summary */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="col-span-2 flex items-center gap-4 rounded-xl border bg-card p-4 shadow-e1 lg:col-span-1">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden>
            <CalendarDays className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{next ? "Next up" : `${year} holidays`}</p>
            {q.isLoading ? <Skeleton className="mt-1 h-5 w-32" /> : next ? (
              <>
                <p className="truncate font-semibold">{next.name}</p>
                <p className="text-xs text-muted-foreground tnum">
                  {format(parseISO(next.date), "EEE d MMM")} · {(() => {
                    const d = differenceInCalendarDays(parseISO(next.date), new Date());
                    return d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
                  })()}
                </p>
              </>
            ) : <p className="font-semibold tnum">{holidays.length ? `${holidays.length} total` : "None yet"}</p>}
          </div>
        </div>
        {counts.map(({ k, n }) => {
          const m = KIND_META[k];
          const Icon = m.icon;
          return (
            <div key={k} className="rounded-xl border bg-card p-4 shadow-e1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
                <span className={cn("flex size-6 items-center justify-center rounded-md border-2", m.swatch,
                  k === "public" ? "text-white" : k === "optional" ? "text-status-l-fg" : "text-accent")} aria-hidden>
                  <Icon className="size-3" />
                </span>
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight">
                {q.isLoading ? <Skeleton className="h-7 w-10" /> : <CountUp value={n} />}
              </div>
              {k === "public" && !q.isLoading && <p className="text-2xs text-muted-foreground tnum">{weekdayCount} on working days</p>}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <InlineAlert tone="info" icon={<RefreshCw className="size-4" />} className="mb-5">
          Adding, editing or removing a holiday recalculates attendance, leave and pay days for open cycles.
          Dates inside a locked cycle can't be changed until the cycle is unlocked.
        </InlineAlert>
      )}

      <HolidayLegend className="mb-4" />

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
        </div>
      ) : (
        <>
          <TabsContent value="calendar" className="mt-0">
            {holidays.length === 0 && (
              <EmptyState compact className="mb-2" title={`No holidays in ${year} yet`}
                description={canEdit ? "Click a day to add one, or import the list from a spreadsheet." : "HR hasn't published the holiday list for this year yet."} />
            )}
            <YearCalendar year={year} holidays={holidays} canEdit={canEdit}
              onAdd={(date) => setEditing({ holiday: null, date })} onEdit={(h) => setEditing({ holiday: h })} />
            {canEdit && <p className="mt-3 text-center text-xs text-muted-foreground">Tip: click any day to add a holiday, or a highlighted day to edit it. Use arrow keys to move between days.</p>}
          </TabsContent>
          <TabsContent value="list" className="mt-0">
            {holidays.length === 0 ? (
              <div className="rounded-xl border bg-card shadow-e1">
                <EmptyState art="calendar" title={`No holidays in ${year}`}
                  description={canEdit ? "Add them one by one, or import the whole list from a spreadsheet." : "HR hasn't published the holiday list for this year yet."}
                  action={canEdit && (
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button size="sm" onClick={() => setEditing({ holiday: null })}><Plus aria-hidden />Add holiday</Button>
                      <Button size="sm" variant="outline" onClick={() => setImporting(true)}><FileUp aria-hidden />Import</Button>
                    </div>
                  )} />
              </div>
            ) : (
              <HolidayList holidays={holidays} canEdit={canEdit} onEdit={(h) => setEditing({ holiday: h })} onDelete={setDeleting} />
            )}
          </TabsContent>
        </>
      )}
      </Tabs>

      {canEdit && (
        <>
          <HolidayDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} holiday={editing?.holiday}
            defaultDate={editing?.date} onSaved={refresh} onDelete={setDeleting} />
          <HolidayImportDialog open={importing} onOpenChange={setImporting} year={year} onDone={refresh} />
          <ConfirmDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)} destructive
            title={`Delete ${deleting?.name ?? "holiday"}?`} confirmLabel="Delete holiday" loading={del.isPending}
            onConfirm={() => deleting && del.mutate(deleting)}
            description={deleting && <>
              {format(parseISO(deleting.date), "EEEE d MMMM yyyy")} becomes a regular working day. Attendance for open
              cycles is recalculated — anyone without a mark that day may show as absent.
            </>} />
        </>
      )}
    </div>
  );
}
