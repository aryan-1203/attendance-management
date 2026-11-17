import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { FadeIn } from "./motion";

export function PageHeader({ title, description, actions, eyebrow, className }: {
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    if (typeof title === "string") document.title = `${title} · ProsParity`;
  }, [title]);
  return (
    <FadeIn className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)} y={4}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-primary">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </FadeIn>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <EmptyState art="error" className={className} title="Couldn't load this"
      description={errorMessage(error)}
      action={onRetry && <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw />Try again</Button>} />
  );
}

export function InlineAlert({ tone = "warning", title, children, className, icon }: {
  tone?: "warning" | "info" | "destructive" | "success"; title?: string; children?: React.ReactNode; className?: string;
  icon?: React.ReactNode;
}) {
  const tones = {
    warning: "bg-warning/10 text-warning ring-warning/25",
    info: "bg-primary/8 text-primary ring-primary/20",
    destructive: "bg-destructive/10 text-destructive ring-destructive/25",
    success: "bg-success/10 text-success ring-success/25",
  };
  return (
    <div role={tone === "destructive" ? "alert" : "status"}
      className={cn("flex gap-2.5 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset", tones[tone], className)}>
      <span className="mt-0.5 shrink-0">{icon ?? <AlertTriangle className="size-4" />}</span>
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-foreground/80">{children}</div>}
      </div>
    </div>
  );
}

export function StatTile({ label, value, sub, icon, tone, className }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode;
  tone?: "primary" | "success" | "warning" | "destructive" | "muted"; className?: string;
}) {
  const toneCls = {
    primary: "bg-primary/10 text-primary", success: "bg-success/12 text-success", warning: "bg-warning/12 text-warning",
    destructive: "bg-destructive/10 text-destructive", muted: "bg-muted text-muted-foreground",
  }[tone ?? "muted"];
  return (
    <div className={cn("rounded-xl border bg-card p-4 shadow-e1", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon && <span className={cn("flex size-7 items-center justify-center rounded-lg [&_svg]:size-4", toneCls)}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tnum">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
