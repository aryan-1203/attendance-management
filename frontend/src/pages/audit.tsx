import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { format, formatDistanceToNow } from "date-fns";
import { ChevronRight, FilterX, Search } from "lucide-react";
import { client, unwrap } from "@/lib/api";
import type { AuditEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersonAvatar } from "@/components/ui/misc";
import { DataTable, Pager } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState, PageHeader } from "@/components/shared/page";
import { ActionBadge, AuditSheet, utc } from "@/features/audit/audit-sheet";
import { humanize } from "@/features/audit/diff";

const ALL = "__all__";
const PAGE_SIZE = 25;
const FILTER_KEYS = ["search", "entity_type", "action", "user_email", "date_from", "date_to"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = React.useState(v);
  React.useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

function changeCount(e: AuditEntry): number {
  const o = e.old_value, n = e.new_value;
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (o == null && n == null) return 0;
  if (!obj(o) && o != null) return 1;
  if (!obj(n) && n != null) return 1;
  const a = (o ?? {}) as Record<string, unknown>, b = (n ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).length;
}

export default function AuditPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sortParam = params.get("sort") || "-created_at";
  const [selected, setSelected] = React.useState<AuditEntry | null>(null);

  const update = React.useCallback((patch: Partial<Record<FilterKey | "page" | "sort", string>>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      if (!("page" in patch)) next.delete("page");
      return next;
    }, { replace: true });
  }, [setParams]);

  // text inputs are local + debounced into the URL
  const [search, setSearch] = React.useState(get("search"));
  const [email, setEmail] = React.useState(get("user_email"));
  const dSearch = useDebounced(search);
  const dEmail = useDebounced(email);
  React.useEffect(() => { if (dSearch !== get("search")) update({ search: dSearch }); /* eslint-disable-next-line */ }, [dSearch]);
  React.useEffect(() => { if (dEmail !== get("user_email")) update({ user_email: dEmail }); /* eslint-disable-next-line */ }, [dEmail]);

  const query = {
    search: get("search") || undefined, entity_type: get("entity_type") || undefined, action: get("action") || undefined,
    user_email: get("user_email") || undefined, date_from: get("date_from") || undefined, date_to: get("date_to") || undefined,
    page, page_size: PAGE_SIZE, sort: sortParam,
  };
  const q = useQuery({
    queryKey: ["audit", query],
    placeholderData: (p) => p,
    queryFn: () => unwrap(client.GET("/api/audit", { params: { query } })),
  });
  const facets = useQuery({
    queryKey: ["audit-facets"],
    staleTime: 5 * 60_000,
    queryFn: async () => (await unwrap(client.GET("/api/audit/facets"))) as unknown as { entity_types: string[]; actions: string[] },
  });

  const sorting: SortingState = [{ id: sortParam.replace(/^-/, ""), desc: sortParam.startsWith("-") }];
  const onSortingChange = (updater: SortingState | ((s: SortingState) => SortingState)) => {
    const s = typeof updater === "function" ? updater(sorting) : updater;
    const first = s[0];
    update({ sort: first ? `${first.desc ? "-" : ""}${first.id}` : "-created_at" });
  };

  const active = FILTER_KEYS.filter((k) => get(k)).length;
  const clear = () => {
    setSearch(""); setEmail("");
    setParams(new URLSearchParams(sortParam !== "-created_at" ? { sort: sortParam } : {}), { replace: true });
  };

  const columns = React.useMemo<ColumnDef<AuditEntry>[]>(() => [
    { id: "created_at", accessorKey: "created_at", header: "When", cell: (c) => {
      const d = utc(c.getValue<string>());
      return (
        <div className="whitespace-nowrap">
          <p className="font-medium tnum">{format(d, "d MMM, HH:mm")}</p>
          <p className="text-2xs text-muted-foreground">{formatDistanceToNow(d, { addSuffix: true })}</p>
        </div>
      );
    } },
    { id: "user_email", accessorKey: "user_email", header: "Who", cell: (c) => {
      const v = c.getValue<string>() || "system";
      return (
        <div className="flex min-w-[10rem] items-center gap-2">
          <PersonAvatar name={v} size={24} />
          <span className="max-w-[12rem] truncate" title={v}>{v}</span>
        </div>
      );
    } },
    { id: "action", accessorKey: "action", header: "Action", cell: (c) => <ActionBadge action={c.getValue<string>()} /> },
    { id: "entity", header: "Entity", enableSorting: false, cell: (c) => (
      <span className="whitespace-nowrap text-muted-foreground">
        {humanize(c.row.original.entity_type)}{c.row.original.entity_id && <span className="font-mono text-2xs tnum"> #{c.row.original.entity_id}</span>}
      </span>
    ) },
    { id: "summary", accessorKey: "summary", header: "Summary", enableSorting: false, cell: (c) => (
      <span className="line-clamp-2 min-w-[14rem] max-w-[28rem]">{c.getValue<string>()}</span>
    ) },
    { id: "changes", header: () => <span className="sr-only">Changes</span>, enableSorting: false, cell: (c) => {
      const n = changeCount(c.row.original);
      return (
        <span className="flex items-center justify-end gap-2 text-muted-foreground">
          {n > 0 && <span className="whitespace-nowrap rounded-full bg-primary/10 px-1.5 text-2xs font-semibold text-primary tnum">{n} change{n === 1 ? "" : "s"}</span>}
          <ChevronRight className="size-4 opacity-50 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      );
    } },
  ], []);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Audit log" eyebrow="Compliance"
        description="Every change to attendance, leave, people and settings — who did it, when, and what changed." />

      {/* filters */}
      <div className="mb-4 rounded-xl border bg-card p-3 shadow-e1" role="search" aria-label="Filter audit log">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Label htmlFor="audit-search" className="sr-only">Search summaries</Label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="audit-search" type="search" placeholder="Search summaries…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <FacetSelect label="Entity" all="All entities" value={get("entity_type")} options={facets.data?.entity_types ?? []}
            render={humanize} onChange={(v) => update({ entity_type: v })} />
          <FacetSelect label="Action" all="All actions" value={get("action")} options={facets.data?.actions ?? []}
            render={(a) => a} mono onChange={(v) => update({ action: v })} />
          <div>
            <Label htmlFor="audit-user" className="sr-only">User email</Label>
            <Input id="audit-user" type="search" placeholder="User email…" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="audit-from" className="text-xs text-muted-foreground">From</Label>
            <Input id="audit-from" type="date" className="h-8 w-[10rem] text-xs tnum" value={get("date_from")}
              max={get("date_to") || undefined} onChange={(e) => update({ date_from: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="audit-to" className="text-xs text-muted-foreground">To</Label>
            <Input id="audit-to" type="date" className="h-8 w-[10rem] text-xs tnum" value={get("date_to")}
              min={get("date_from") || undefined} onChange={(e) => update({ date_to: e.target.value })} />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted-foreground tnum" aria-live="polite">
              {q.data ? `${q.data.total.toLocaleString()} event${q.data.total === 1 ? "" : "s"}` : ""}
            </span>
            {active > 0 && (
              <Button variant="ghost" size="sm" onClick={clear}><FilterX aria-hidden />Clear {active} filter{active === 1 ? "" : "s"}</Button>
            )}
          </div>
        </div>
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className={cn("transition-opacity duration-base", q.isFetching && !q.isLoading && "opacity-70")}>
          <DataTable columns={columns} data={q.data?.items ?? []} loading={q.isLoading} rowKey={(r) => r.id}
            sorting={sorting} onSortingChange={onSortingChange} manualSorting onRowClick={setSelected} maxHeight="68vh"
            empty={active ? (
              <EmptyState art="search" title="No matching events" description="Try a wider date range or fewer filters."
                action={<Button size="sm" variant="outline" onClick={clear}>Clear filters</Button>} />
            ) : <EmptyState art="inbox" title="Nothing logged yet" description="Changes made in ProsParity will appear here." />} />
          {q.data && q.data.total > 0 && (
            <Pager page={page} pages={q.data.pages} total={q.data.total} onPage={(p) => update({ page: String(p) })} />
          )}
        </div>
      )}

      <AuditSheet entry={selected} onOpenChange={(v) => !v && setSelected(null)} />
    </div>
  );
}

function FacetSelect({ label, all, value, options, onChange, render, mono }: {
  label: string; all: string; value: string; options: string[]; onChange: (v: string) => void; render: (v: string) => string; mono?: boolean;
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger aria-label={`Filter by ${label.toLowerCase()}`} className={cn(value && "border-primary/50 bg-primary/5")}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o} className={cn(mono && "font-mono text-xs")}>{render(o)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
