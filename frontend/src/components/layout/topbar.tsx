import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Bell, CalendarRange, KeyRound, Lock, LogOut, Menu, Monitor, Moon, Search, Sun } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { client, unwrap } from "@/lib/api";
import { ROLE_LABEL, useAuth } from "@/lib/auth";
import { useCycle } from "@/lib/cycle";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd, PersonAvatar } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCommandPalette } from "./command-palette";
import { SidebarNav } from "./sidebar";
import { Logo } from "./logo";
import { ChangePasswordDialog } from "./change-password";

export function CycleSwitcher({ className }: { className?: string }) {
  const { cycle, cycles, setCycleId } = useCycle();
  if (!cycle) return null;
  return (
    <Select value={String(cycle.id)} onValueChange={(v) => setCycleId(Number(v))}>
      <SelectTrigger aria-label="Salary cycle" className={cn("h-9 w-auto min-w-[210px] gap-2 rounded-full bg-surface/70", className)}>
        <CalendarRange className="size-4 text-primary" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="center">
        {cycles.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            <span className="flex items-center gap-2">
              {c.label}
              {c.status === "locked" && <Lock className="size-3 text-muted-foreground" aria-label="locked" />}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const unread = useQuery({ queryKey: ["notifications", "unread"], refetchInterval: 45_000,
    queryFn: () => unwrap(client.GET("/api/notifications/unread-count")) });
  const [open, setOpen] = React.useState(false);
  const list = useQuery({ queryKey: ["notifications", "list"], enabled: open,
    queryFn: () => unwrap(client.GET("/api/notifications", { params: { query: { page_size: 8 } } })) });
  const markAll = useMutation({
    mutationFn: () => unwrap(client.POST("/api/notifications/read", { body: {} })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const count = (unread.data as { count?: number } | undefined)?.count ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${count ? `, ${count} unread` : ""}`} className="relative">
          <Bell />
          {count > 0 && <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground tnum">{count > 9 ? "9+" : count}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <button className="cursor-pointer text-xs font-medium text-primary hover:underline disabled:opacity-50"
            disabled={!count} onClick={() => markAll.mutate()}>Mark all read</button>
        </div>
        <ul className="max-h-96 overflow-y-auto scrollbar-thin" aria-live="polite">
          {list.data?.items.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">You're all caught up.</li>}
          {list.data?.items.map((n) => (
            <li key={n.id}>
              <button className={cn("flex w-full cursor-pointer gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/70",
                !n.is_read && "bg-primary/[.04]")} onClick={() => { setOpen(false); if (n.link) nav(n.link); }}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.is_read ? "bg-transparent" : "bg-primary")} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
                  <span className="text-2xs text-muted-foreground">{formatDistanceToNow(parseISO(n.created_at + "Z"), { addSuffix: true })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t px-4 py-2.5 text-center text-xs font-medium text-primary hover:bg-muted/60">View all</Link>
      </PopoverContent>
    </Popover>
  );
}

function ThemeMenu() {
  const { theme, setTheme, resolved } = useTheme();
  const Icon = resolved === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme"><Icon /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {([["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Monitor, "System"]] as const).map(([t, I, l]) => (
          <DropdownMenuItem key={t} onSelect={() => setTheme(t)} className={cn(theme === t && "text-primary")}>
            <I />{l}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar() {
  const { user, role, logout } = useAuth();
  const palette = useCommandPalette();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [pwOpen, setPwOpen] = React.useState(false);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <header className="glass sticky top-0 z-20 flex h-16 items-center gap-2 border-b px-3 sm:px-5">
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Trigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation"><Menu /></Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/50 backdrop-blur-sm lg:hidden" />
          <DialogPrimitive.Content aria-describedby={undefined}
            className="glass fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r pb-4 shadow-e3 data-[state=open]:animate-in data-[state=open]:slide-in-from-left lg:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <div className="flex h-16 items-center px-4"><Logo /></div>
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <CycleSwitcher className="hidden sm:flex" />
      <div className="flex-1" />
      <button onClick={palette.open}
        className="hidden h-9 cursor-pointer items-center gap-2 rounded-full border bg-surface/70 pl-3 pr-1.5 text-sm text-muted-foreground shadow-e1 transition-colors hover:text-foreground md:flex md:w-64">
        <Search className="size-4" aria-hidden /><span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd><Kbd>K</Kbd>
      </button>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={palette.open} aria-label="Search"><Search /></Button>
      <Notifications />
      <ThemeMenu />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="ml-1 flex cursor-pointer items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-muted" aria-label="Account menu">
            <PersonAvatar name={user?.full_name ?? "?"} src={user?.employee?.photo_url} size={32} />
            <span className="hidden text-left leading-tight xl:block">
              <span className="block text-sm font-medium">{user?.full_name}</span>
              <span className="block text-2xs text-muted-foreground">{role && ROLE_LABEL[role]}</span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <span className="block truncate text-foreground">{user?.full_name}</span>
            <span className="block truncate font-normal">{user?.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPwOpen(true)}><KeyRound />Change password</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => logout()} destructive><LogOut />Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </header>
  );
}
