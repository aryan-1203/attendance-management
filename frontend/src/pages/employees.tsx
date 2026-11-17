import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Download, FileUp, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { client, download, unwrap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Employee } from "@/lib/types";
import { downloadBlob, fmtDate } from "@/lib/utils";
import { qk, useDepartments } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, Pager } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState, PageHeader } from "@/components/shared/page";
import {
  EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, EmployeeAvatar, EmployeeStatusBadge, EmploymentTypeBadge,
} from "@/features/employees/shared";
import { EmployeeFormSheet } from "@/features/employees/employee-form";
import { EmployeeImportDialog } from "@/features/employees/import-dialog";

const PAGE_SIZE = 25;
const ALL = "all";

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function EmployeesPage() {
  const { can, role } = useAuth();
  const isHR = can("hr_admin");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const depts = useDepartments();

  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const sortParam = params.get("sort") ?? "code";
  const dept = params.get("dept") ?? ALL;
  const type = params.get("type") ?? ALL;
  const status = params.get("status") ?? ALL;
  const [search, setSearch] = React.useState(params.get("q") ?? "");
  const q = useDebounced(search.trim());

  const update = React.useCallback((patch: Record<string, string | null>, resetPage = true) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => (v === null || v === "" || v === ALL ? next.delete(k) : next.set(k, v)));
      if (resetPage) next.delete("page");
      return next;
    }, { replace: true });
  }, [setParams]);

  React.useEffect(() => {
    if ((params.get("q") ?? "") !== q) update({ q: q || null });
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorting: SortingState = [{ id: sortParam.replace(/^-/, ""), desc: sortParam.startsWith("-") }];
  const filters = {
    search: q || undefined, department_id: dept !== ALL ? Number(dept) : undefined,
    employment_type: type !== ALL ? type : undefined, status: status !== ALL ? status : undefined,
    page, page_size: PAGE_SIZE, sort: sortParam,
  };
  const list = useQuery({
    queryKey: qk.employees(filters), placeholderData: keepPreviousData,
    queryFn: () => unwrap(client.GET("/api/employees", { params: { query: filters } })),
  });

  const [formOpen, setFormOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  // Warm the profile chunk so the avatar's shared-element transition has something to land on.
  React.useEffect(() => { void import("@/pages/employee-profile"); }, []);

  const exportX = useMutation({
    mutationFn: () => download("/api/employees/export.xlsx"),
    onSuccess: ({ blob, filename }) => { downloadBlob(blob, filename); toast.success("Employee master exported"); },
  });

  const open = (e: Employee) => navigate(`/employees/${e.id}`, { state: { employee: e } });
  const filtered = !!(q || dept !== ALL || type !== ALL || status !== ALL);

  const columns = React.useMemo<ColumnDef<Employee, unknown>[]>(() => {
    const cols: ColumnDef<Employee, unknown>[] = [
      {
        accessorKey: "full_name", header: "Employee", size: 260,
        cell: ({ row: { original: e } }) => (
          <div className="flex min-w-[200px] items-center gap-3">
            <EmployeeAvatar employee={e} size={36} />
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{e.full_name}</div>
              <div className="truncate text-xs text-muted-foreground">{e.email ?? e.designation?.name ?? "—"}</div>
            </div>
          </div>
        ),
      },
      { accessorKey: "code", header: "Code", cell: ({ row }) => <span className="font-mono text-xs tnum">{row.original.code}</span> },
      {
        id: "department", header: "Department", enableSorting: false,
        cell: ({ row: { original: e } }) => (
          <div className="min-w-[140px]">
            <div className="truncate">{e.department?.name ?? <span className="text-muted-foreground">—</span>}</div>
            {e.designation && <div className="truncate text-xs text-muted-foreground">{e.designation.name}</div>}
          </div>
        ),
      },
      { accessorKey: "employment_type", header: "Type", cell: ({ row }) => <EmploymentTypeBadge type={row.original.employment_type} /> },
      {
        accessorKey: "date_of_joining", header: "Joined",
        cell: ({ row }) => <span className="whitespace-nowrap tnum">{fmtDate(row.original.date_of_joining)}</span>,
      },
    ];
    cols.push({ accessorKey: "status", header: "Status", cell: ({ row }) => <EmployeeStatusBadge status={row.original.status} /> });
    return cols;
  }, []);

  const data = list.data;
  return (
    <div>
      <PageHeader title="Employees" eyebrow={role === "manager" ? "My team" : "Employee master"}
        description={role === "manager" ? "People who report to you." :
          role === "accounts" ? "Read-only view of the employee master." : "Everyone on payroll — joiners, confirmations and exits."}
        actions={isHR && (
          <>
            <Button variant="outline" onClick={() => exportX.mutate()} loading={exportX.isPending}><Download />Export</Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}><FileUp />Import</Button>
            <Button onClick={() => setFormOpen(true)}><UserPlus />Add employee</Button>
          </>
        )} />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center" role="search" aria-label="Filter employees">
        <div className="relative sm:col-span-2 lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code or email"
            aria-label="Search employees" className="pl-9 pr-9" type="search" />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search"
              className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <FilterSelect label="Department" value={dept} onChange={(v) => update({ dept: v })}
          options={(depts.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))} all="All departments" />
        <FilterSelect label="Employment type" value={type} onChange={(v) => update({ type: v })}
          options={EMPLOYMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))} all="All types" />
        <FilterSelect label="Status" value={status} onChange={(v) => update({ status: v })}
          options={EMPLOYEE_STATUSES.map((t) => ({ value: t.value, label: t.label }))} all="Any status" />
        {filtered && (
          <Button variant="ghost" size="sm" className="justify-self-start"
            onClick={() => { setSearch(""); update({ q: null, dept: null, type: null, status: null }); }}>
            <X />Clear filters
          </Button>
        )}
      </div>

      {list.isError && !data ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} className="rounded-xl border bg-card" />
      ) : (
        <>
          <DataTable columns={columns} data={data?.items ?? []} loading={list.isLoading} rowKey={(r) => r.id}
            manualSorting sorting={sorting}
            onSortingChange={(updater) => {
              const next = typeof updater === "function" ? updater(sorting) : updater;
              const s = next[0];
              update({ sort: s ? `${s.desc ? "-" : ""}${s.id}` : "code" }, true);
            }}
            onRowClick={open} maxHeight="calc(100dvh - 300px)"
            className={list.isFetching && !list.isLoading ? "opacity-80 transition-opacity" : "transition-opacity"}
            empty={filtered ? (
              <EmptyState art="search" title="No one matches these filters"
                description="Try a different name or code, or clear the filters."
                action={<Button variant="outline" size="sm" onClick={() => { setSearch(""); update({ q: null, dept: null, type: null, status: null }); }}>Clear filters</Button>} />
            ) : (
              <EmptyState art="people" title={role === "manager" ? "No direct reports yet" : "No employees yet"}
                description={isHR ? "Add your first employee or import the master from Excel." : "Employees will appear here once HR adds them."}
                action={isHR && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><FileUp />Import</Button>
                    <Button size="sm" onClick={() => setFormOpen(true)}><UserPlus />Add employee</Button>
                  </div>
                )} />
            )} />
          {data && data.total > 0 && (
            <Pager page={data.page} pages={data.pages} total={data.total} onPage={(p) => update({ page: String(p) }, false)} />
          )}
        </>
      )}

      {isHR && (
        <>
          <EmployeeFormSheet open={formOpen} onOpenChange={setFormOpen} onSaved={(e) => open(e)} />
          <EmployeeImportDialog open={importOpen} onOpenChange={setImportOpen} />
        </>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, all }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; all: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="lg:w-48"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
