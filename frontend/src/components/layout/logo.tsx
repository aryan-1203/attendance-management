import { useId } from "react";
import { cn } from "@/lib/utils";

/** ProsParity brand mark: green "P" with a rising arrow cut out (the background shows through). */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="72 -10 460 460" className={cn("size-8 shrink-0", className)} role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <mask id={`pp-${id}`} maskUnits="userSpaceOnUse" x="72" y="-10" width="460" height="460">
          <rect x="72" y="-10" width="460" height="460" fill="#fff" />
          <path d="M100,252 C175,222 243,188 297,141 L319,166 C262,213 190,258 100,300 Z" fill="#000" />
          <path d="M266,117 L361,92 L333,184 L317,163 L299,145 L283,133 Z" fill="#000" />
        </mask>
      </defs>
      <path mask={`url(#pp-${id})`} fill="#3DFF7E"
        d="M150,0 H350 A135,135 0 0 1 350,270 H284 Q262,270 262,292 V410 Q262,440 232,440 H150 Q120,440 120,410 V30 Q120,0 150,0 Z" />
    </svg>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <div className="leading-tight">
          <div className="text-[0.95rem] font-semibold tracking-tight">ProsParity</div>
          <div className="text-2xs text-muted-foreground">Attendance · Leave · Pay-days</div>
        </div>
      )}
    </div>
  );
}
