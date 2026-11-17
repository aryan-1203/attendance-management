import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { ChevronsLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { client, unwrap } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/misc";
import { NAV } from "./nav";
import { Logo } from "./logo";

export function useApprovalsCount(enabled: boolean) {
  return useQuery({
    queryKey: ["approvals-count"], enabled, refetchInterval: 60_000,
    queryFn: async () => {
      const [l, r] = await Promise.all([
        unwrap(client.GET("/api/leave/requests", { params: { query: { status: "pending", page_size: 1, scope: "approvals" } } })),
        unwrap(client.GET("/api/regularizations", { params: { query: { status: "pending", page_size: 1, scope: "approvals" } } })),
      ]);
      return l.total + r.total;
    },
  });
}

export function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { role } = useAuth();
  // only polls when a nav item shows an approvals badge (none in the HR-only version)
  const wantsBadge = NAV.some((sec) => sec.items.some((i) => i.badge === "approvals"));
  const approvals = useApprovalsCount(wantsBadge && (role === "hr_admin" || role === "manager"));
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-2 scrollbar-thin">
      {NAV.map((sec) => {
        const items = sec.items.filter((i) => role && i.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={sec.section} className="grid gap-0.5">
            {!collapsed && <div className="px-2.5 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/80">{sec.section}</div>}
            {items.map((item) => {
              const Icon = item.icon;
              const count = item.badge === "approvals" ? approvals.data ?? 0 : 0;
              const link = (
                <NavLink to={item.to} end={item.to === "/" || item.to === "/me"} onClick={onNavigate}
                  className={({ isActive }) => cn(
                    "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors duration-base",
                    isActive ? "text-primary" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    collapsed && "justify-center px-0")}>
                  {({ isActive }) => (<>
                    {isActive && (
                      <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/15"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }} />
                    )}
                    <Icon className="relative size-[18px] shrink-0" aria-hidden />
                    {!collapsed && <span className="relative truncate">{item.label}</span>}
                    {count > 0 && (
                      <span className={cn("relative ml-auto rounded-full bg-accent px-1.5 text-2xs font-semibold text-accent-foreground tnum",
                        collapsed && "absolute right-0.5 top-0.5 ml-0 px-1")} aria-label={`${count} pending`}>{count}</span>
                    )}
                  </>)}
                </NavLink>
              );
              return collapsed ? <Tooltip key={item.to} content={item.label} side="right">{link}</Tooltip> :
                <div key={item.to}>{link}</div>;
            })}
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <motion.aside animate={{ width: collapsed ? 72 : 256 }} transition={{ type: "spring", stiffness: 380, damping: 38 }}
      className="glass sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r lg:flex">
      <div className={cn("flex h-16 items-center gap-2 px-4", collapsed && "justify-center px-0")}>
        <Logo compact={collapsed} />
      </div>
      <SidebarNav collapsed={collapsed} />
      <div className={cn("p-3", collapsed && "flex justify-center")}>
        <button onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronsLeft className={cn("size-4 transition-transform duration-slow", collapsed && "rotate-180")} />
          {!collapsed && "Collapse"}
        </button>
      </div>
    </motion.aside>
  );
}
