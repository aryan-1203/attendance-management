
import { format, parseISO, startOfWeek, differenceInCalendarWeeks } from "date-fns";
import { cn } from "@/lib/utils";
import { STATUS, statusMeta } from "@/lib/status";
import { Tooltip } from "@/components/ui/misc";

const CELL = 12;
const GAP = 3;

/** GitHub-style attendance heatmap, colored by status (with tooltip text for every cell). */
export function AttendanceHeatmap({ days, className }: { days: { date: string; status: string | null }[]; className?: string }) {
  if (!days.length) return null;
  const first = parseISO(days[0].date);
  const origin = startOfWeek(first, { weekStartsOn: 1 });
  const weeks = differenceInCalendarWeeks(parseISO(days[days.length - 1].date), origin, { weekStartsOn: 1 }) + 1;
  const months: { label: string; col: number }[] = [];
  let lastMonth = -1;
  days.forEach((d) => {
    const dt = parseISO(d.date);
    if (dt.getDate() <= 7 && dt.getMonth() !== lastMonth) {
      months.push({ label: format(dt, "MMM"), col: differenceInCalendarWeeks(dt, origin, { weekStartsOn: 1 }) });
      lastMonth = dt.getMonth();
    }
  });
  const width = weeks * (CELL + GAP);
  return (
    <div className={cn("overflow-x-auto scrollbar-thin pb-1", className)}>
      <div className="relative" style={{ width: width + 28, height: 7 * (CELL + GAP) + 18 }}>
        {months.map((m) => (
          <span key={`${m.label}-${m.col}`} className="absolute top-0 text-2xs text-muted-foreground"
            style={{ left: 28 + m.col * (CELL + GAP) }}>{m.label}</span>
        ))}
        {["Mon", "", "Wed", "", "Fri", "", ""].map((l, i) => (
          <span key={i} className="absolute left-0 text-2xs text-muted-foreground" style={{ top: 16 + i * (CELL + GAP) - 1 }}>{l}</span>
        ))}
        <div className="absolute left-7 top-4" role="grid" aria-label="Attendance heatmap for the last 12 months">
          {days.map((d) => {
            const dt = parseISO(d.date);
            const col = differenceInCalendarWeeks(dt, origin, { weekStartsOn: 1 });
            const row = (dt.getDay() + 6) % 7;
            const meta = statusMeta(d.status);
            const cls = !d.status ? "bg-muted" : d.status === "NJ" || d.status === "EX" ? "bg-muted/40 hatched" :
              cellColor[d.status] ?? "bg-muted";
            return (
              <Tooltip key={d.date} content={`${format(dt, "EEE d MMM yyyy")} · ${meta?.label ?? "Not marked"}`}>
                <span role="gridcell" aria-label={`${d.date}: ${meta?.label ?? "Not marked"}`}
                  className={cn("absolute rounded-[3px] transition-transform hover:scale-125", cls)}
                  style={{ left: col * (CELL + GAP), top: row * (CELL + GAP), width: CELL, height: CELL }} />
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const cellColor: Record<string, string> = {
  P: "bg-status-p/80", WFH: "bg-status-wfh/75", OD: "bg-status-od/75", A: "bg-status-a/85", HD: "bg-status-hd/80",
  L: "bg-status-l/75", CO: "bg-status-co/75", WO: "bg-status-wo/25", H: "bg-status-h/45",
};

export function HeatmapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
      {(["P", "WFH", "HD", "A", "L", "H", "WO"] as const).map((c) => (
        <span key={c} className="inline-flex items-center gap-1">
          <span className={cn("size-2.5 rounded-[3px]", cellColor[c])} aria-hidden />{STATUS[c].label}
        </span>
      ))}
    </div>
  );
}

