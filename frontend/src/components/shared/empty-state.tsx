import { cn } from "@/lib/utils";

type Art = "calendar" | "inbox" | "search" | "upload" | "chart" | "people" | "check" | "error";

/** Custom, quiet line illustrations (no confetti) — tinted with theme tokens. */
function Illustration({ art }: { art: Art }) {
  const common = { fill: "none", stroke: "hsl(var(--primary))", strokeWidth: 2, strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const };
  const soft = "hsl(var(--primary) / .10)";
  const accent = "hsl(var(--accent))";
  return (
    <svg width="132" height="104" viewBox="0 0 132 104" aria-hidden>
      <ellipse cx="66" cy="94" rx="44" ry="6" fill="hsl(var(--foreground) / .05)" />
      {art === "calendar" && (<>
        <rect x="30" y="18" width="72" height="64" rx="12" {...common} fill={soft} />
        <path d="M30 38h72M48 12v12M84 12v12" {...common} />
        {[0, 1, 2, 3].map((i) => <rect key={i} x={40 + i * 14} y="48" width="8" height="8" rx="2" fill="hsl(var(--primary) / .25)" />)}
        <rect x="40" y="62" width="8" height="8" rx="2" fill={accent} />
        <circle cx="98" cy="22" r="10" fill="hsl(var(--background))" stroke={accent} strokeWidth="2" />
        <path d="M94 22l3 3 5-6" stroke={accent} strokeWidth="2" fill="none" strokeLinecap="round" />
      </>)}
      {art === "inbox" && (<>
        <path d="M26 54l12-32h56l12 32v24a8 8 0 0 1-8 8H34a8 8 0 0 1-8-8z" {...common} fill={soft} />
        <path d="M26 54h22l6 10h24l6-10h22" {...common} />
        <path d="M58 36h16M54 44h24" stroke="hsl(var(--primary) / .45)" strokeWidth="2" strokeLinecap="round" />
      </>)}
      {art === "search" && (<>
        <circle cx="58" cy="46" r="24" {...common} fill={soft} />
        <path d="M76 64l18 18" {...common} strokeWidth="4" />
        <path d="M48 46h20" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
      </>)}
      {art === "upload" && (<>
        <rect x="34" y="20" width="64" height="64" rx="14" {...common} fill={soft} strokeDasharray="5 5" />
        <path d="M66 66V36M54 48l12-12 12 12" {...common} />
        <rect x="88" y="14" width="22" height="26" rx="4" fill="hsl(var(--background))" stroke={accent} strokeWidth="2" />
        <path d="M93 24h12M93 30h8" stroke={accent} strokeWidth="2" strokeLinecap="round" />
      </>)}
      {art === "chart" && (<>
        <rect x="28" y="16" width="76" height="66" rx="12" {...common} fill={soft} />
        <path d="M40 68l14-16 12 8 22-24" {...common} />
        <circle cx="88" cy="36" r="4" fill={accent} />
      </>)}
      {art === "people" && (<>
        <circle cx="52" cy="40" r="12" {...common} fill={soft} />
        <circle cx="82" cy="44" r="10" fill="hsl(var(--accent) / .15)" stroke={accent} strokeWidth="2" />
        <path d="M30 80c2-14 12-22 22-22s20 8 22 22M70 80c1-10 6-16 12-16s12 6 14 16" {...common} />
      </>)}
      {art === "check" && (<>
        <circle cx="66" cy="48" r="30" fill="hsl(var(--success) / .12)" stroke="hsl(var(--success))" strokeWidth="2" />
        <path d="M52 48l10 10 18-20" stroke="hsl(var(--success))" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>)}
      {art === "error" && (<>
        <path d="M66 18l36 62H30z" fill="hsl(var(--destructive) / .10)" stroke="hsl(var(--destructive))" strokeWidth="2" strokeLinejoin="round" />
        <path d="M66 42v18M66 68v1" stroke="hsl(var(--destructive))" strokeWidth="3" strokeLinecap="round" />
      </>)}
    </svg>
  );
}

export function EmptyState({ art = "inbox", title, description, action, className, compact }: {
  art?: Art; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string; compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 py-6" : "gap-3 py-12", className)}>
      {!compact && <Illustration art={art} />}
      <div className="grid gap-1">
        <p className="font-semibold">{title}</p>
        {description && <p className="mx-auto max-w-sm text-sm text-muted-foreground text-balance">{description}</p>}
      </div>
      {action}
    </div>
  );
}
