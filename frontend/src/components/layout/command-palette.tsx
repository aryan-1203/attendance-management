import * as React from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CalendarCheck2, CheckCheck, FileSpreadsheet, Moon, Search, Sun, User } from "lucide-react";
import { toast } from "sonner";
import { client, download, errorMessage, unwrap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useCycle } from "@/lib/cycle";
import { downloadBlob, isoDate } from "@/lib/utils";
import { PersonAvatar } from "@/components/ui/misc";
import { NAV } from "./nav";

const Ctx = React.createContext<{ open: () => void } | null>(null);
export const useCommandPalette = () => React.useContext(Ctx)!;

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Ctx.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </Ctx.Provider>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { role } = useAuth();
  const { resolved, setTheme } = useTheme();
  const { cycle } = useCycle();
  const [search, setSearch] = React.useState("");
  const canSeeEmployees = role === "hr_admin" || role === "manager" || role === "accounts";
  const emps = useQuery({
    queryKey: ["cmdk-emps", search], enabled: open && canSeeEmployees && search.length > 0,
    queryFn: () => unwrap(client.GET("/api/employees", { params: { query: { search, page_size: 8 } } })),
  });
  const run = (fn: () => void | Promise<void>) => { onOpenChange(false); setSearch(""); void fn(); };
  const items = NAV.flatMap((s) => s.items).filter((i) => role && i.roles.includes(role));

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content aria-describedby={undefined}
          className="fixed left-1/2 top-[14vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border glass shadow-e3 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <Command label="Command palette" shouldFilter={true}
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground">
            <div className="flex items-center gap-2 border-b px-4">
              <Search className="size-4 text-muted-foreground" aria-hidden />
              <Command.Input value={search} onValueChange={setSearch} autoFocus
                placeholder="Jump to an employee, page or action…"
                className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm" />
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
              <Command.Empty className="py-8 text-center text-sm text-muted-foreground">No results.</Command.Empty>
              {emps.data && emps.data.items.length > 0 && (
                <Command.Group heading="Employees">
                  {emps.data.items.map((e) => (
                    <Item key={e.id} value={`emp ${e.code} ${e.full_name}`} onSelect={() => run(() => nav(`/employees/${e.id}`))}>
                      <PersonAvatar name={e.full_name} src={e.photo_url} size={22} />
                      <span>{e.full_name}</span><span className="ml-auto text-xs text-muted-foreground">{e.code}</span>
                    </Item>
                  ))}
                </Command.Group>
              )}
              {role === "hr_admin" && (
                <Command.Group heading="Actions">
                  <Item value="mark all present today attendance" onSelect={() => run(async () => {
                    try {
                      const r = await unwrap(client.POST("/api/attendance/mark-all-present", { body: { date: isoDate(new Date()) } }));
                      toast.success(`Marked ${r.count ?? 0} employees present`);
                      qc.invalidateQueries({ queryKey: ["grid"] });
                    } catch (e) { toast.error(errorMessage(e)); }
                  })}><CheckCheck /> Mark everyone present today</Item>
                  <Item value="mark attendance grid" onSelect={() => run(() => nav("/attendance"))}><CalendarCheck2 /> Mark attendance</Item>
                  <Item value="run pay days report download excel" onSelect={() => run(async () => {
                    try {
                      const { blob, filename } = await download("/api/reports/pay-days.xlsx", { cycle_id: cycle?.id });
                      downloadBlob(blob, filename);
                    } catch (e) { toast.error(errorMessage(e)); }
                  })}><FileSpreadsheet /> Download pay-days report ({cycle?.label})</Item>
                </Command.Group>
              )}
              <Command.Group heading="Go to">
                {items.map((i) => {
                  const Icon = i.icon;
                  return <Item key={i.to} value={`go ${i.label}`} onSelect={() => run(() => nav(i.to))}><Icon />{i.label}</Item>;
                })}
                <Item value="go notifications" onSelect={() => run(() => nav("/notifications"))}><User />Notifications</Item>
              </Command.Group>
              <Command.Group heading="Preferences">
                <Item value="toggle theme dark light mode" onSelect={() => run(() => setTheme(resolved === "dark" ? "light" : "dark"))}>
                  {resolved === "dark" ? <Sun /> : <Moon />} Switch to {resolved === "dark" ? "light" : "dark"} mode
                </Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Item({ children, ...props }: React.ComponentProps<typeof Command.Item>) {
  return (
    <Command.Item {...props}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm aria-selected:bg-primary/10 aria-selected:text-primary [&_svg]:size-4 [&_svg]:text-muted-foreground aria-selected:[&_svg]:text-primary">
      {children}
    </Command.Item>
  );
}
