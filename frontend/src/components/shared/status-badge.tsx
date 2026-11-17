import { cn } from "@/lib/utils";
import { statusMeta } from "@/lib/status";

/** Icon + code + (optional) label: color is never the only signal. */
export function StatusBadge({ code, showLabel = false, className, size = "sm" }: {
  code: string | null | undefined; showLabel?: boolean; className?: string; size?: "xs" | "sm";
}) {
  const meta = statusMeta(code);
  if (!meta) return <span className="text-muted-foreground">—</span>;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full font-semibold",
      size === "xs" ? "px-1.5 py-0 text-2xs" : "px-2 py-0.5 text-xs", meta.soft, className)}
      title={meta.label}>
      <Icon className={size === "xs" ? "size-3" : "size-3.5"} aria-hidden />
      <span>{showLabel ? meta.label : meta.code}</span>
      {!showLabel && <span className="sr-only">{meta.label}</span>}
    </span>
  );
}

export function StatusLegend({ codes, className }: { codes: string[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground", className)}
      aria-label="Status legend">
      {codes.map((c) => {
        const m = statusMeta(c)!;
        const Icon = m.icon;
        return (
          <li key={c} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-flex size-5 items-center justify-center rounded-md", m.soft)}>
              <Icon className="size-3" aria-hidden />
            </span>
            <span><b className="font-semibold text-foreground">{m.code}</b> {m.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
