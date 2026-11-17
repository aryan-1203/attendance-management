import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { motion, useReducedMotion } from "framer-motion";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Holiday } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { stagger } from "@/components/shared/motion";
import { kindMeta } from "./kinds";

export function KindBadge({ kind }: { kind: string }) {
  const m = kindMeta(kind);
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", m.badge)}>
      <Icon className="size-3" aria-hidden />{m.label}
    </span>
  );
}

function relative(date: string) {
  const d = differenceInCalendarDays(parseISO(date), new Date());
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

export function HolidayList({ holidays, canEdit, onEdit, onDelete }: {
  holidays: Holiday[]; canEdit: boolean; onEdit: (h: Holiday) => void; onDelete: (h: Holiday) => void;
}) {
  const reduce = useReducedMotion();
  const groups = new Map<string, Holiday[]>();
  holidays.forEach((h) => {
    const k = h.date.slice(0, 7);
    groups.set(k, [...(groups.get(k) ?? []), h]);
  });
  const today = format(new Date(), "yyyy-MM-dd");
  return (
    <div className="grid gap-6">
      {[...groups.entries()].map(([month, list]) => (
        <section key={month} aria-labelledby={`hl-${month}`}>
          <h3 id={`hl-${month}`} className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {format(parseISO(`${month}-01`), "MMMM yyyy")}
          </h3>
          <motion.ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-e1"
            variants={stagger.container} initial={reduce ? false : "hidden"} animate="show">
            {list.map((h) => {
              const d = parseISO(h.date);
              const past = h.date < today;
              const m = kindMeta(h.kind);
              const sunday = d.getDay() === 0;
              return (
                <motion.li key={h.id} variants={stagger.item} className={cn("flex items-center gap-4 px-4 py-3", past && "opacity-60")}>
                  <div className={cn("flex size-12 shrink-0 flex-col items-center justify-center rounded-xl border-2 leading-none", m.cell)}>
                    <span className="text-2xs font-medium uppercase opacity-90">{format(d, "EEE")}</span>
                    <span className="mt-0.5 text-lg font-semibold tnum">{format(d, "d")}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{h.name}</p>
                      <KindBadge kind={h.kind} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      <span className="tnum">{format(d, "EEEE, d MMMM")}</span> · {relative(h.date)}
                      {sunday && " · falls on a Sunday"}
                      {h.description && <> · {h.description}</>}
                    </p>
                  </div>
                  {canEdit && (
                    <>
                      <div className="hidden gap-1 sm:flex">
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${h.name}`} onClick={() => onEdit(h)}><Pencil aria-hidden /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${h.name}`} className="text-destructive hover:bg-destructive/10"
                          onClick={() => onDelete(h)}><Trash2 aria-hidden /></Button>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="sm:hidden" aria-label={`Actions for ${h.name}`}><MoreHorizontal aria-hidden /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => onEdit(h)}><Pencil />Edit</DropdownMenuItem>
                          <DropdownMenuItem destructive onSelect={() => onDelete(h)}><Trash2 />Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </motion.li>
              );
            })}
          </motion.ul>
        </section>
      ))}
    </div>
  );
}
