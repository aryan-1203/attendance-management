import * as React from "react";
import { cn } from "@/lib/utils";

/** Compact segmented radio group (filters). Arrow keys move between options. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; count?: number }[]; label: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const n = options[(i + dir + options.length) % options.length];
    onChange(n.value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-value="${n.value}"]`)?.focus());
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}
      className={cn("inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value || "all"} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-value={o.value}
            onClick={() => onChange(o.value)}
            className={cn("min-h-[28px] cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-base " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-surface text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground")}>
            {o.label}{o.count !== undefined && <span className="ml-1 tnum text-muted-foreground">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const STATUS_FILTERS = [
  { value: "", label: "All" }, { value: "pending", label: "Pending" }, { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" }, { value: "cancelled", label: "Cancelled" },
];
