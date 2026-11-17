import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCheck, CheckCircle2, ChevronRight, ClipboardCheck, Info, Zap, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { client, unwrap } from "@/lib/api";
import type { Notification } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton, Tabs, TabsList, TabsTrigger, Tooltip } from "@/components/ui/misc";
import { Pager } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState, PageHeader } from "@/components/shared/page";

const PAGE_SIZE = 20;

const KIND: Record<string, { icon: LucideIcon; cls: string; label: string }> = {
  approval: { icon: ClipboardCheck, cls: "bg-primary/10 text-primary", label: "Needs approval" },
  action: { icon: Zap, cls: "bg-accent/10 text-accent", label: "Action needed" },
  success: { icon: CheckCircle2, cls: "bg-success/10 text-success", label: "Success" },
  warning: { icon: AlertTriangle, cls: "bg-warning/15 text-warning", label: "Warning" },
  info: { icon: Info, cls: "bg-muted text-muted-foreground", label: "Info" },
};

const utc = (ts: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`);

function dayLabel(d: Date) {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, d.getFullYear() === new Date().getFullYear() ? "EEEE, d MMMM" : "d MMMM yyyy");
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [tab, setTab] = React.useState<"all" | "unread">("all");
  const [page, setPage] = React.useState(1);

  const q = useQuery({
    queryKey: ["notifications", "page", tab, page],
    placeholderData: (p) => p,
    queryFn: () => unwrap(client.GET("/api/notifications", { params: { query: { unread: tab === "unread", page, page_size: PAGE_SIZE } } })),
  });
  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: async () => (await unwrap(client.GET("/api/notifications/unread-count"))) as unknown as { count: number },
  });
  const unreadCount = unread.data?.count ?? 0;

  const mark = useMutation({
    mutationFn: (ids?: number[]) => unwrap(client.POST("/api/notifications/read", { body: ids ? { ids } : {} })),
    onMutate: async (ids) => {
      // optimistic: flip is_read in cached pages
      await qc.cancelQueries({ queryKey: ["notifications", "page"] });
      qc.setQueriesData<{ items: Notification[] }>({ queryKey: ["notifications", "page"] }, (old) => old && ({
        ...old, items: old.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, is_read: true } : n)),
      }));
    },
    onSuccess: (_d, ids) => { if (!ids) toast.success("All caught up", { description: "Every notification is marked as read." }); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const open = (n: Notification) => {
    if (!n.is_read) mark.mutate([n.id]);
    if (n.link) navigate(n.link);
  };

  const items = q.data?.items ?? [];
  const groups = React.useMemo(() => {
    const g: { label: string; items: Notification[] }[] = [];
    items.forEach((n) => {
      const l = dayLabel(utc(n.created_at));
      const last = g[g.length - 1];
      if (last?.label === l) last.items.push(n); else g.push({ label: l, items: [n] });
    });
    return g;
  }, [items]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Notifications"
        description={unreadCount ? <span className="tnum">{unreadCount} unread</span> : "You're all caught up."}
        actions={
          <Button variant="outline" onClick={() => mark.mutate(undefined)} disabled={!unreadCount || mark.isPending}>
            <CheckCheck aria-hidden />Mark all read
          </Button>
        } />

      <Tabs value={tab} onValueChange={(v) => { setTab(v as "all" | "unread"); setPage(1); }} className="mb-4">
        <TabsList aria-label="Filter notifications">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">
            Unread
            {unreadCount > 0 && <span className="rounded-full bg-primary px-1.5 text-2xs font-semibold text-primary-foreground tnum">{unreadCount}</span>}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? (
        <div className="overflow-hidden rounded-xl border bg-card shadow-e1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 border-b p-4 last:border-0">
              <Skeleton className="size-9 rounded-xl" />
              <div className="grid flex-1 gap-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-3/4" /></div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border bg-card shadow-e1">
          {tab === "unread"
            ? <EmptyState art="check" title="Nothing unread" description="You've seen everything. New reminders and updates will show up here."
              action={<Button size="sm" variant="outline" onClick={() => setTab("all")}>See all notifications</Button>} />
            : <EmptyState art="inbox" title="No notifications yet" description="Reminders such as probation confirmations and year-end carry-forward will land here." />}
        </div>
      ) : (
        <div className={cn("grid gap-5 transition-opacity duration-base", q.isFetching && !q.isLoading && "opacity-70")}>
          {groups.map((g) => (
            <section key={g.label} aria-labelledby={`ng-${g.label}`}>
              <h2 id={`ng-${g.label}`} className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</h2>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-e1">
                <AnimatePresence initial={false}>
                  {g.items.map((n) => {
                    const k = KIND[n.kind] ?? KIND.info;
                    const Icon = k.icon;
                    const d = utc(n.created_at);
                    return (
                      <motion.li key={n.id} layout={!reduce} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}
                        exit={reduce ? undefined : { opacity: 0, height: 0 }}
                        className={cn("group relative flex items-start gap-3 transition-colors duration-base", !n.is_read && "bg-primary/5")}>
                        <button type="button" onClick={() => open(n)}
                          className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 p-4 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          aria-label={`${n.is_read ? "" : "Unread. "}${k.label}: ${n.title}. ${n.body} ${formatDistanceToNow(d, { addSuffix: true })}${n.link ? ". Opens related page" : ""}`}>
                          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", k.cls)} aria-hidden><Icon className="size-4" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-3">
                              <span className={cn("text-sm", n.is_read ? "font-medium text-foreground/85" : "font-semibold")}>{n.title}</span>
                              <time dateTime={d.toISOString()} title={format(d, "d MMM yyyy, HH:mm")}
                                className="shrink-0 text-2xs text-muted-foreground tnum">{format(d, "HH:mm")}</time>
                            </span>
                            {n.body && <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>}
                            <span className="mt-1 block text-2xs text-muted-foreground">{formatDistanceToNow(d, { addSuffix: true })}</span>
                          </span>
                          {n.link && <ChevronRight className="mt-2.5 size-4 shrink-0 text-muted-foreground opacity-50 transition-transform group-hover:translate-x-0.5" aria-hidden />}
                        </button>
                        {!n.is_read && (
                          <>
                            <span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden />
                            <Tooltip content="Mark as read">
                              <Button variant="ghost" size="icon-sm" className="mr-2 mt-3.5 shrink-0" aria-label={`Mark “${n.title}” as read`}
                                onClick={() => mark.mutate([n.id])}>
                                <CheckCheck aria-hidden />
                              </Button>
                            </Tooltip>
                          </>
                        )}
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </section>
          ))}
          {q.data && q.data.pages > 1 && <Pager page={page} pages={q.data.pages} total={q.data.total} onPage={(p) => { setPage(p); window.scrollTo({ top: 0 }); }} />}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{mark.isSuccess ? "Marked as read" : ""}</p>
    </div>
  );
}
