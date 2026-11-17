import * as React from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type Json = unknown;

const isObj = (v: Json): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);

export function humanize(key: string) {
  const s = key.replace(/[_.]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Value({ v, tone }: { v: Json; tone?: "old" | "new" }) {
  if (v === undefined) return <span className="italic text-muted-foreground">not set</span>;
  if (v === null || v === "") return <span className="italic text-muted-foreground">empty</span>;
  if (typeof v === "boolean") return <span className="font-mono">{v ? "true" : "false"}</span>;
  if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) return <span className="font-mono tnum">{String(v)}</span>;
  if (typeof v === "string") return <span className={cn("break-words", tone === "old" && "line-through decoration-destructive/50")}>{v}</span>;
  return (
    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-sunken p-2 font-mono text-2xs leading-relaxed scrollbar-thin">
      {JSON.stringify(v, null, 2)}
    </pre>
  );
}

/** Key-by-key old → new diff. Changed keys first (red → green), then unchanged keys collapsed. */
export function ValueDiff({ oldValue, newValue }: { oldValue: Json; newValue: Json }) {
  const [showSame, setShowSame] = React.useState(false);
  if (oldValue == null && newValue == null) {
    return <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">No field changes were recorded for this event.</p>;
  }
  // Non-object payloads: show as whole blocks
  if (!(isObj(oldValue) || oldValue == null) || !(isObj(newValue) || newValue == null)) {
    return (
      <div className="grid gap-2">
        {oldValue != null && <Block tone="old"><Value v={oldValue} tone="old" /></Block>}
        {newValue != null && <Block tone="new"><Value v={newValue} /></Block>}
      </div>
    );
  }
  const o = (oldValue ?? {}) as Record<string, Json>;
  const n = (newValue ?? {}) as Record<string, Json>;
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])];
  const changed = keys.filter((k) => !same(o[k], n[k]));
  const unchanged = keys.filter((k) => same(o[k], n[k]));
  const kind = oldValue == null ? "created" : newValue == null ? "removed" : "changed";

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground tnum">
        {kind === "created" ? `${keys.length} field${keys.length === 1 ? "" : "s"} set` :
          kind === "removed" ? `${keys.length} field${keys.length === 1 ? "" : "s"} removed` :
            `${changed.length} of ${keys.length} field${keys.length === 1 ? "" : "s"} changed`}
      </p>
      <div className="grid divide-y overflow-hidden rounded-lg border">
        {changed.length > 0 && <dl className="grid divide-y">{changed.map((k) => (
          <div key={k} className="grid gap-1.5 p-3">
            <dt className="text-xs font-semibold">{humanize(k)} <span className="font-mono text-2xs font-normal text-muted-foreground">{k}</span></dt>
            <dd className="grid gap-1 text-sm">
              {k in o && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/5 px-2 py-1.5 text-destructive ring-1 ring-inset ring-destructive/15">
                  <Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span className="sr-only">Before:</span>
                  <div className="min-w-0 flex-1 text-foreground/80"><Value v={o[k]} tone="old" /></div>
                </div>
              )}
              {k in n && (
                <div className="flex items-start gap-2 rounded-md bg-success/10 px-2 py-1.5 text-success ring-1 ring-inset ring-success/20">
                  <Plus className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span className="sr-only">After:</span>
                  <div className="min-w-0 flex-1 text-foreground"><Value v={n[k]} /></div>
                </div>
              )}
            </dd>
          </div>
        ))}</dl>}
        {unchanged.length > 0 && (
          <div className="bg-muted/30">
            <button type="button" onClick={() => setShowSame((s) => !s)} aria-expanded={showSame}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              {unchanged.length} unchanged field{unchanged.length === 1 ? "" : "s"}
              <ChevronDown className={cn("size-4 transition-transform duration-base", showSame && "rotate-180")} aria-hidden />
            </button>
            {showSame && (
              <dl className="grid divide-y border-t">
                {unchanged.map((k) => (
                  <div key={k} className="grid grid-cols-[minmax(0,8rem)_1fr] gap-3 px-3 py-2 text-sm">
                    <dt className="truncate text-xs text-muted-foreground" title={k}>{humanize(k)}</dt>
                    <dd className="min-w-0"><Value v={n[k]} /></dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Block({ tone, children }: { tone: "old" | "new"; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-lg p-3 ring-1 ring-inset", tone === "old" ? "bg-destructive/5 ring-destructive/15" : "bg-success/10 ring-success/20")}>
      <p className={cn("mb-1 text-2xs font-semibold uppercase tracking-wider", tone === "old" ? "text-destructive" : "text-success")}>
        {tone === "old" ? "Before" : "After"}
      </p>
      {children}
    </div>
  );
}
