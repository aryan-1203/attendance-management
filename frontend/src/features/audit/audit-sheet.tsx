import * as React from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Check, Copy, Hash, User2 } from "lucide-react";
import type { AuditEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PersonAvatar, Separator } from "@/components/ui/misc";
import { ValueDiff, humanize } from "./diff";

export function utc(ts: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`);
}

const VERB_TONE: [RegExp, string][] = [
  [/(create|add|apply|upload|import|commit|approve|unlock)/, "bg-success/10 text-success ring-success/25"],
  [/(delete|remove|reject|cancel|rollback|lock|deactivate|exit)/, "bg-destructive/10 text-destructive ring-destructive/25"],
  [/(update|edit|change|set|mark|recalc)/, "bg-primary/10 text-primary ring-primary/20"],
];

export function ActionBadge({ action, className }: { action: string; className?: string }) {
  const verb = action.split(".").slice(1).join(".") || action;
  const tone = VERB_TONE.find(([re]) => re.test(verb.toLowerCase()))?.[1] ?? "bg-muted text-muted-foreground ring-border";
  return (
    <span className={cn("inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 font-mono text-2xs font-medium ring-1 ring-inset", tone, className)}>
      <span className="truncate">{action}</span>
    </span>
  );
}

export function AuditSheet({ entry, onOpenChange }: { entry: AuditEntry | null; onOpenChange: (v: boolean) => void }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    if (!entry) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };
  const when = entry ? utc(entry.created_at) : null;
  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent side="right" className="content-start sm:max-w-lg">
        {entry && when && (
          <>
            <DialogHeader>
              <div className="mb-1"><ActionBadge action={entry.action} /></div>
              <DialogTitle className="text-balance">{entry.summary || humanize(entry.action)}</DialogTitle>
              <DialogDescription>
                <time dateTime={when.toISOString()}>{format(when, "EEEE d MMMM yyyy, HH:mm:ss")}</time>
                {" · "}{formatDistanceToNow(when, { addSuffix: true })}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-3 rounded-xl border bg-surface-sunken/50 p-3 text-sm">
              <div className="col-span-2 flex items-center gap-2.5">
                {entry.user_email && entry.user_email !== "system"
                  ? <PersonAvatar name={entry.user_email} size={28} />
                  : <span className="flex size-7 items-center justify-center rounded-full bg-muted" aria-hidden><User2 className="size-3.5" /></span>}
                <div className="min-w-0">
                  <dt className="text-2xs text-muted-foreground">Done by</dt>
                  <dd className="truncate font-medium">{entry.user_email || "system"}</dd>
                </div>
              </div>
              <div>
                <dt className="text-2xs text-muted-foreground">Entity</dt>
                <dd className="font-medium">{humanize(entry.entity_type)}</dd>
              </div>
              <div>
                <dt className="text-2xs text-muted-foreground">Record</dt>
                <dd className="inline-flex items-center gap-1 font-mono text-xs tnum"><Hash className="size-3 text-muted-foreground" aria-hidden />{entry.entity_id || "—"}</dd>
              </div>
            </dl>

            <Separator />
            <section aria-labelledby="audit-changes" className="grid gap-2">
              <h3 id="audit-changes" className="text-sm font-semibold">Changes</h3>
              <ValueDiff oldValue={entry.old_value} newValue={entry.new_value} />
            </section>

            <div className="flex justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={copy} aria-live="polite">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "Copied" : "Copy as JSON"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
