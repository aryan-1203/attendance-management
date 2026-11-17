import { differenceInCalendarDays, parseISO } from "date-fns";
import { Hourglass } from "lucide-react";
import type { CompOff } from "@/lib/types";
import { cn, fmtDate, fmtDays, num } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/misc";
import { EmptyState } from "@/components/shared/empty-state";

const STATUS: Record<string, { label: string; variant: "success" | "secondary" | "warning" | "default" }> = {
  available: { label: "Available", variant: "success" },
  partial: { label: "Partly used", variant: "default" },
  used: { label: "Used", variant: "secondary" },
  expired: { label: "Expired", variant: "secondary" },
};

/** Comp-off lots: earned on a weekly-off/holiday, each with its own expiry. */
export function CompOffLots({ lots, today }: { lots: CompOff[]; today: Date }) {
  if (!lots.length) {
    return <EmptyState compact title="No comp-offs earned"
      description="Working on a weekly off or holiday earns a comp-off lot here." />;
  }
  return (
    <ul className="grid gap-2" aria-label="Comp-off lots">
      {lots.map((l) => {
        const total = num(l.days);
        const used = num(l.used_days);
        const expired = num(l.expired_days);
        const left = Math.max(0, Math.round((total - used - expired) * 100) / 100);
        const daysToExpiry = differenceInCalendarDays(parseISO(l.expires_on), today);
        const soon = left > 0 && daysToExpiry >= 0 && daysToExpiry <= 14;
        const st = STATUS[l.status] ?? { label: l.status, variant: "secondary" as const };
        return (
          <li key={l.id} className={cn("rounded-lg border bg-card p-3", (l.status === "expired" || l.status === "used") && "opacity-70")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">Earned {fmtDate(l.earned_date, "d MMM yyyy")}</p>
                <p className={cn("mt-0.5 flex items-center gap-1 text-xs tnum", soon ? "font-medium text-warning" : "text-muted-foreground")}>
                  {soon && <Hourglass className="size-3" aria-hidden />}
                  {daysToExpiry < 0 ? `Expired ${fmtDate(l.expires_on)}` : `Expires ${fmtDate(l.expires_on)}${soon ? ` · in ${daysToExpiry} d` : ""}`}
                </p>
              </div>
              <Badge variant={soon ? "warning" : st.variant}>{soon ? "Expiring soon" : st.label}</Badge>
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <Progress value={total ? (used / total) * 100 : 0} className="h-1.5" indicatorClassName="bg-status-co"
                label={`${fmtDays(used)} of ${fmtDays(total)} days used`} />
              <span className="shrink-0 text-xs tnum text-muted-foreground">
                <b className="font-semibold text-foreground">{fmtDays(left)}</b> / {fmtDays(total)} left
              </span>
            </div>
            {expired > 0 && <p className="mt-1 text-2xs text-muted-foreground tnum">{fmtDays(expired)} day(s) lapsed</p>}
          </li>
        );
      })}
    </ul>
  );
}
