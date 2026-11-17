import * as React from "react";
import { Command } from "cmdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarRange, ChevronsUpDown, FileSpreadsheet, FileText, Loader2, NotebookTabs, ReceiptText, Search, UserRound, X,
  type LucideIcon,
} from "lucide-react";
import { client, download, unwrap } from "@/lib/api";
import type { Employee } from "@/lib/types";
import { cn, downloadBlob } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PersonAvatar } from "@/components/ui/misc";

interface ReportDef { key: string; title: string; description: string; icon: LucideIcon; formats: ("xlsx" | "pdf")[] }
const REPORTS: ReportDef[] = [
  { key: "pay-days", title: "Salary pay-days", description: "Eligible, payable and LOP days per employee — Accounts applies salaries.", icon: ReceiptText, formats: ["xlsx", "pdf"] },
  { key: "muster-roll", title: "Muster roll", description: "Day-by-day attendance register for the cycle.", icon: CalendarRange, formats: ["xlsx"] },
  { key: "leave-register", title: "Leave register", description: "Every ledger movement in the cycle.", icon: NotebookTabs, formats: ["xlsx"] },
  { key: "lop-summary", title: "LOP summary", description: "Loss-of-pay days and amounts by employee.", icon: FileText, formats: ["xlsx"] },
];

function useDownload() {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async (key: string, path: string, params: Record<string, string | number | undefined>) => {
    setBusy(key);
    try {
      const { blob, filename } = await download(path, params);
      downloadBlob(blob, filename);
      toast.success(`Downloaded ${filename}`);
      qc.invalidateQueries({ queryKey: ["report-runs"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

export function ReportDownloads({ cycleId }: { cycleId: number }) {
  const { busy, run } = useDownload();
  const [emp, setEmp] = React.useState<Employee | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Downloads</CardTitle>
        <CardDescription>Excel files open with frozen headers and totals; PDFs are print-ready.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-2 sm:grid-cols-2">
          {REPORTS.map((r) => (
            <li key={r.key} className="flex items-start gap-3 rounded-xl border bg-card p-3 transition-shadow hover:shadow-e2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden><r.icon className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">{r.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.formats.map((f) => {
                    const k = `${r.key}.${f}`;
                    return (
                      <Button key={f} size="sm" variant="outline" loading={busy === k} disabled={!!busy && busy !== k}
                        aria-label={`Download ${r.title} as ${f === "xlsx" ? "Excel" : "PDF"}`}
                        onClick={() => run(k, `/api/reports/${r.key}.${f}`, { cycle_id: cycleId })}>
                        {busy !== k && (f === "xlsx" ? <FileSpreadsheet /> : <FileText />)}{f === "xlsx" ? "Excel" : "PDF"}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="rounded-xl border bg-muted/30 p-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent" aria-hidden><UserRound className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium" id="stmt-label">Employee monthly statement</p>
              <p className="text-xs text-muted-foreground">Attendance, leave movements and pay-days for one person.</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <EmployeeCombobox value={emp} onChange={setEmp} labelledBy="stmt-label" className="sm:flex-1" />
                <div className="flex gap-1.5">
                  {(["pdf", "xlsx"] as const).map((f) => {
                    const k = `statement.${f}`;
                    return (
                      <Button key={f} variant="outline" loading={busy === k} disabled={!emp || (!!busy && busy !== k)}
                        aria-label={`Download statement as ${f === "xlsx" ? "Excel" : "PDF"}`}
                        onClick={() => emp && run(k, "/api/reports/statement", { fmt: f, employee_id: emp.id, cycle_id: cycleId })}>
                        {busy !== k && (f === "xlsx" ? <FileSpreadsheet /> : <FileText />)}{f === "xlsx" ? "Excel" : "PDF"}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Server-searched employee combobox (cmdk inside a popover). */
export function EmployeeCombobox({ value, onChange, labelledBy, className }: {
  value: Employee | null; onChange: (e: Employee | null) => void; labelledBy?: string; className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const q = useDebounced(search.trim());
  const res = useQuery({
    queryKey: ["report-emp-picker", q], enabled: open, staleTime: 30_000, placeholderData: (p) => p,
    queryFn: () => unwrap(client.GET("/api/employees", { params: { query: { search: q || undefined, page_size: 20, sort: "full_name" } } })),
  });
  const items = res.data?.items ?? [];
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild>
          <button type="button" role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-labelledby={labelledBy}
            className={cn("flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-surface px-3 text-left text-sm shadow-e1",
              "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15", value && "pr-9")}>
            {value ? (
              <>
                <PersonAvatar name={value.full_name} src={value.photo_url} size={22} />
                <span className="min-w-0 flex-1 truncate font-medium">{value.full_name}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{value.code}</span>
              </>
            ) : (
              <>
                <Search className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate text-muted-foreground">Choose an employee…</span>
                <ChevronsUpDown className="size-4 opacity-50" aria-hidden />
              </>
            )}
          </button>
        </PopoverTrigger>
        {value && (
          <button type="button" aria-label="Clear employee" onClick={() => onChange(null)}
            className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[17rem] p-0">
        <Command shouldFilter={false} label="Choose employee">
          <div className="flex items-center gap-2 border-b px-3">
            {res.isFetching ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : <Search className="size-4 text-muted-foreground" aria-hidden />}
            <Command.Input value={search} onValueChange={setSearch} autoFocus placeholder="Search name or code"
              className="h-10 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm" />
          </div>
          <Command.List className="max-h-64 overflow-y-auto p-1 scrollbar-thin">
            {!res.isFetching && <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">No employees found</Command.Empty>}
            {items.map((e) => (
              <Command.Item key={e.id} value={String(e.id)} onSelect={() => { onChange(e); setOpen(false); }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-muted">
                <PersonAvatar name={e.full_name} src={e.photo_url} size={24} />
                <span className="min-w-0 flex-1 truncate">{e.full_name}</span>
                <span className="font-mono text-xs text-muted-foreground">{e.code}</span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

