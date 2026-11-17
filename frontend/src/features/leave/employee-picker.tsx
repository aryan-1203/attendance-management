import * as React from "react";
import { Command } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { client, unwrap } from "@/lib/api";
import type { Employee } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PersonAvatar } from "@/components/ui/misc";

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Searchable employee combobox (server-side search on /api/employees). */
export function EmployeePicker({ value, onChange, status, placeholder = "Search by name or code…", id, invalid,
  className, clearable = true, disabled }: {
  value: Employee | null; onChange: (e: Employee | null) => void; status?: "active" | "exited" | "inactive";
  placeholder?: string; id?: string; invalid?: boolean; className?: string; clearable?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const q = useDebounced(search.trim(), 250);
  const res = useQuery({
    queryKey: ["employee-picker", status, q],
    enabled: open,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: () => unwrap(client.GET("/api/employees", {
      params: { query: { search: q || undefined, status, page_size: 20, sort: "full_name" } },
    })),
  });
  const items = res.data?.items ?? [];
  // results arrive async (shouldFilter=false), so keep the highlighted row valid ourselves
  const [active, setActive] = React.useState("");
  React.useEffect(() => {
    if (!items.some((e) => String(e.id) === active)) setActive(items[0] ? String(items[0].id) : "");
  }, [items, active]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild>
          <button type="button" id={id} disabled={disabled} role="combobox" aria-expanded={open} aria-haspopup="listbox"
            aria-invalid={invalid || undefined}
            className={cn("flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-md border border-input bg-surface px-3 text-left text-sm shadow-e1 " +
              "transition-[border-color,box-shadow] duration-fast focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 " +
              "focus-visible:ring-ring/15 disabled:opacity-50 aria-[invalid=true]:border-destructive",
              clearable && value && "pr-9")}>
            {value ? (
              <>
                <PersonAvatar name={value.full_name} src={value.photo_url} size={24} />
                <span className="min-w-0 flex-1 truncate font-medium">{value.full_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{value.code}</span>
              </>
            ) : (
              <>
                <Search className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate text-muted-foreground">{placeholder}</span>
              </>
            )}
            {!(clearable && value) && <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />}
          </button>
        </PopoverTrigger>
        {clearable && value && (
          <button type="button" aria-label="Clear employee" onClick={() => onChange(null)}
            className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0">
        <Command shouldFilter={false} label="Choose employee" value={active} onValueChange={setActive}>
          <div className="flex items-center gap-2 border-b px-3">
            {res.isFetching ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> :
              <Search className="size-4 text-muted-foreground" aria-hidden />}
            <Command.Input value={search} onValueChange={setSearch} autoFocus placeholder={placeholder}
              className="h-10 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm" />
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1 scrollbar-thin">
            {!res.isLoading && items.length === 0 && (
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                {q ? `No ${status === "exited" ? "exited " : ""}employees match “${q}”.` : "No employees found."}
              </Command.Empty>
            )}
            {res.isLoading && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Searching…</div>}
            {items.map((e) => (
              <Command.Item key={e.id} value={String(e.id)} onSelect={() => { onChange(e); setOpen(false); }}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm aria-selected:bg-primary/10">
                <PersonAvatar name={e.full_name} src={e.photo_url} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.full_name}</span>
                  <span className="block truncate text-2xs text-muted-foreground">
                    {e.code}{e.department ? ` · ${e.department.name}` : ""}{e.exit_date ? ` · exited ${e.exit_date}` : ""}
                  </span>
                </span>
                {value?.id === e.id && <Check className="size-4 text-primary" aria-hidden />}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
