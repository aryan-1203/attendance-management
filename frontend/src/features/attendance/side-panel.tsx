import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Lock, TrendingDown } from "lucide-react";
import { client, unwrap } from "@/lib/api";
import { cn, fmtDays, num } from "@/lib/utils";
import { PersonAvatar, Skeleton } from "@/components/ui/misc";
import { Ring } from "@/components/shared/rings";
import { CountUp } from "@/components/shared/motion";
import { EmptyState } from "@/components/shared/empty-state";
import type { GridRow } from "@/lib/types";

export function EmployeeSidePanel({ row, cycleId }: { row: GridRow | null; cycleId: number | undefined }) {
  const q = useQuery({
    queryKey: ["summary", row?.id, cycleId], enabled: !!row && !!cycleId,
    queryFn: () => unwrap(client.GET("/api/attendance/summary", { params: { query: { employee_id: row!.id, cycle_id: cycleId } } })),
  });
  if (!row) {
    return <EmptyState art="people" compact title="Select an employee"
      description="Click a name or any cell to see balances, LOP so far and projected payable days." />;
  }
  const s = q.data;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4" aria-live="polite">
      <div className="flex items-center gap-3">
        <PersonAvatar name={row.full_name} src={row.photo_url} size={44} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{row.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.code} · {row.department ?? "—"} · <span className="capitalize">{row.employment_type}</span></p>
        </div>
        <Link to={`/employees/${row.id}`} aria-label={`Open ${row.full_name}'s profile`}
          className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowUpRight className="size-4" /></Link>
      </div>
      {q.isLoading || !s ? (
        <div className="grid gap-2"><Skeleton className="h-24" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : (<>
        <div className="grid grid-cols-3 gap-2">
          <Bal label="Usable" value={s.balance.usable} tone="text-status-p-fg" />
          <Bal label="Locked" value={s.balance.locked} tone="text-status-l-fg" icon={<Lock className="size-3" />} />
          <Bal label="Comp-off" value={s.balance.comp_off} tone="text-status-co-fg" />
        </div>
        <div className="flex items-center gap-4 rounded-xl border bg-surface-sunken/60 p-3">
          <Ring value={num(s.projected_payable_days)} max={s.cycle_days} size={72} stroke={8}
            color="hsl(var(--primary))" label={`${fmtDays(s.projected_payable_days)} of ${s.cycle_days} payable`}>
            <span className="text-sm font-semibold tnum">{fmtDays(s.projected_payable_days)}</span>
          </Ring>
          <div className="text-sm">
            <p className="font-medium">Projected payable days</p>
            <p className="text-xs text-muted-foreground tnum">of {s.cycle_days} cycle days · {s.eligible_days} eligible</p>
            {s.pending_days > 0 && <p className="text-xs text-muted-foreground tnum">{s.pending_days} future day(s) assumed present</p>}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
          <Stat k="Present" v={String(s.present_days)} />
          <Stat k="Half-days" v={String(s.half_days)} />
          <Stat k="Absent" v={String(s.absent_days)} />
          <Stat k="On leave" v={String(s.leave_days)} />
          <Stat k="Paid leave used" v={fmtDays(s.paid_leave_used)} />
          <Stat k="Unmarked" v={String(s.unmarked_days)} warn={s.unmarked_days > 0} />
        </dl>
        <div className={cn("flex items-center justify-between rounded-xl px-3 py-2.5 ring-1 ring-inset",
          num(s.lop_days) > 0 ? "bg-status-lop/10 ring-status-lop/25" : "bg-muted ring-border")}>
          <span className="flex items-center gap-2 text-sm font-medium"><TrendingDown className="size-4 text-status-lop-fg" aria-hidden />LOP so far</span>
          <span className="text-right">
            <span className="block text-lg font-semibold tnum"><CountUp value={num(s.lop_days)} decimals={1} /> d</span>
          </span>
        </div>
        {s.remarks.length > 0 && (
          <ul className="grid gap-1 text-xs text-muted-foreground">{s.remarks.map((r) => <li key={r}>• {r}</li>)}</ul>
        )}
      </>)}
    </div>
  );
}

function Bal({ label, value, tone, icon }: { label: string; value: string; tone: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-2.5 text-center shadow-e1">
      <p className="flex items-center justify-center gap-1 text-2xs font-medium text-muted-foreground">{icon}{label}</p>
      <p className={cn("text-xl font-semibold tnum", tone)}><CountUp value={num(value)} decimals={1} /></p>
    </div>
  );
}

function Stat({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed pb-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("font-semibold tnum", warn && "text-warning")}>{v}</dd>
    </div>
  );
}
