import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, CalendarRange, Columns3, FileSpreadsheet, Plus, RotateCcw, Rows3, Save, Sparkles, Trash2, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { client, unwrap } from "@/lib/api";
import { useCycle } from "@/lib/cycle";
import { SETTABLE, STATUS } from "@/lib/status";
import { cn, fmtDate, pluralize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Skeleton } from "@/components/ui/misc";
import { InlineAlert } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { isKnownValue } from "./constants";
import { normalizeMapping, type Inspect, type Layout, type Mapping, type Template } from "./types";

const NONE = "__none__";

export interface ReinspectArgs {
  sheet?: string;
  header_row?: number;
  cycle_id?: number | null;
  /** "structure" = headers may change → reset to detection; "cycle" = only remap dates */
  kind: "structure" | "cycle";
}

export function mappingProblems(m: Mapping, headers: string[]): Partial<Record<"code" | "dates" | "date" | "status", string>> {
  const p: Partial<Record<"code" | "dates" | "date" | "status", string>> = {};
  if (!m.employee_code_column || !headers.includes(m.employee_code_column)) p.code = "Choose the column with employee codes";
  if (m.layout === "wide") {
    if (!Object.values(m.date_columns).some(Boolean)) p.dates = "Map at least one column to a date";
  } else {
    if (!m.date_column) p.date = "Choose the date column";
    if (!m.status_column) p.status = "Choose the status column";
  }
  return p;
}

export function MappingStep({ inspect, mapping, setMapping, sheet, onReinspect, reinspecting, saveAs, setSaveAs,
  onBack, onValidate, validating }: {
  inspect: Inspect; mapping: Mapping; setMapping: React.Dispatch<React.SetStateAction<Mapping>>; sheet: string;
  onReinspect: (a: ReinspectArgs) => void; reinspecting: boolean; saveAs: string; setSaveAs: (v: string) => void;
  onBack: () => void; onValidate: () => void; validating: boolean;
}) {
  const { cycles } = useCycle();
  const headers = React.useMemo(() => [...new Set(inspect.headers.filter(Boolean))], [inspect.headers]);
  const [headerRow, setHeaderRow] = React.useState(String(mapping.header_row));
  React.useEffect(() => setHeaderRow(String(mapping.header_row)), [mapping.header_row]);
  const [showErrors, setShowErrors] = React.useState(false);
  const problems = mappingProblems(mapping, headers);
  const valid = Object.keys(problems).length === 0;

  const templates = useQuery({
    queryKey: ["import-templates"],
    queryFn: async () => (await unwrap(client.GET("/api/imports/templates"))) as unknown as Template[],
  });

  const set = <K extends keyof Mapping>(k: K, v: Mapping[K]) => setMapping((m) => ({ ...m, [k]: v }));

  const applyTemplate = (t: Template) => {
    const tm = normalizeMapping({ ...t.mapping, layout: t.layout });
    const has = (c: string | null) => (c && headers.includes(c) ? c : null);
    const dc = Object.fromEntries(Object.entries(tm.date_columns).filter(([h]) => headers.includes(h)));
    setMapping((cur) => ({
      ...cur,
      layout: tm.layout,
      employee_code_column: has(tm.employee_code_column) ?? cur.employee_code_column,
      name_column: has(tm.name_column) ?? cur.name_column,
      date_columns: Object.keys(dc).length ? dc : cur.date_columns,
      date_column: has(tm.date_column) ?? cur.date_column,
      status_column: has(tm.status_column) ?? cur.status_column,
      note_column: has(tm.note_column) ?? cur.note_column,
      status_map: { ...cur.status_map, ...tm.status_map },
    }));
    toast.success(`Applied template “${t.name}”`,
      tm.header_row !== mapping.header_row ? { description: `This template expects headers on row ${tm.header_row}.` } : undefined);
  };

  const suggested = inspect.suggested_template;
  const suggestedTpl = templates.data?.find((t) => t.id === suggested?.id);
  const bareNumbers = mapping.layout === "wide" && Object.keys(mapping.date_columns).length === 0 &&
    headers.filter((h) => /^\d{1,2}$/.test(h)).length >= 3;

  const submit = () => {
    if (!valid) { setShowErrors(true); return; }
    onValidate();
  };

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      {/* file bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-e1">
        <span className="flex size-9 items-center justify-center rounded-lg bg-success/10 text-success" aria-hidden>
          <FileSpreadsheet className="size-4" />
        </span>
        <div className="min-w-[10rem] flex-1">
          <p className="truncate text-sm font-semibold">{inspect.batch.filename}</p>
          <p className="text-xs text-muted-foreground tnum">
            {pluralize(headers.length, "column")} · {pluralize(inspect.sheets.length, "sheet")} · headers on row {mapping.header_row}
          </p>
        </div>
        <Badge variant="default" className="gap-1">
          {mapping.layout === "wide" ? <Columns3 className="size-3" aria-hidden /> : <Rows3 className="size-3" aria-hidden />}
          {inspect.detected_mapping.layout === mapping.layout ? "Detected" : "Chosen"}: {mapping.layout === "wide" ? "Wide" : "Long"}
        </Badge>
        <Button variant="ghost" size="sm" onClick={onBack}><RotateCcw aria-hidden />Change file</Button>
      </div>

      {suggested && suggestedTpl && (
        <InlineAlert tone="info" icon={<Sparkles className="size-4" />} title={`Looks like your “${suggested.name}” template`}>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span>The columns match a saved mapping.</span>
            <Button size="sm" variant="soft" onClick={() => applyTemplate(suggestedTpl)}><Wand2 aria-hidden />Apply it</Button>
          </div>
        </InlineAlert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---------------- source */}
        <Card>
          <CardHeader>
            <CardTitle>Source</CardTitle>
            <CardDescription>Which sheet, where the headers are, and how the data is shaped.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label id="layout-label">Layout</Label>
              <LayoutToggle value={mapping.layout} onChange={(v) => set("layout", v)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sheet" htmlFor="imp-sheet">
                <Select value={sheet} onValueChange={(v) => onReinspect({ sheet: v, kind: "structure" })}
                  disabled={inspect.sheets.length < 2 || reinspecting}>
                  <SelectTrigger id="imp-sheet" aria-label="Sheet"><SelectValue /></SelectTrigger>
                  <SelectContent>{inspect.sheets.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Header row" htmlFor="imp-hr" hint="Row number that holds the column titles">
                <div className="flex gap-2">
                  <Input id="imp-hr" type="number" inputMode="numeric" min={1} max={500} value={headerRow} className="tnum"
                    onChange={(e) => setHeaderRow(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && Number(headerRow) >= 1) onReinspect({ header_row: Number(headerRow), kind: "structure" });
                    }} />
                  <Button variant="outline" disabled={reinspecting || !(Number(headerRow) >= 1) || Number(headerRow) === mapping.header_row}
                    loading={reinspecting} onClick={() => onReinspect({ header_row: Number(headerRow), kind: "structure" })}>
                    Apply
                  </Button>
                </div>
              </Field>
            </div>
            <Field label="Salary cycle (optional)" htmlFor="imp-cycle"
              hint="Needed when date headers are bare day numbers (1, 2, 3 …) — we'll map each to a date in this cycle.">
              <Select value={mapping.cycle_id ? String(mapping.cycle_id) : NONE} disabled={reinspecting}
                onValueChange={(v) => onReinspect({ cycle_id: v === NONE ? null : Number(v), kind: "cycle" })}>
                <SelectTrigger id="imp-cycle" className={cn(bareNumbers && "border-warning ring-4 ring-warning/15")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not needed — headers are full dates</SelectItem>
                  {cycles.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.label}{c.status === "locked" ? " (locked)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {bareNumbers && (
              <InlineAlert tone="warning" title="Headers look like day numbers">
                Pick the salary cycle above so we can turn 1, 2, 3 … into real dates.
              </InlineAlert>
            )}
          </CardContent>
        </Card>

        {/* ---------------- columns */}
        <Card>
          <CardHeader>
            <CardTitle>Columns</CardTitle>
            <CardDescription>Point us at the employee code{mapping.layout === "wide" ? " and the date columns" : ", date and status"}.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <ColumnSelect id="imp-code" label="Employee code" required headers={headers} value={mapping.employee_code_column}
                onChange={(v) => set("employee_code_column", v)} error={showErrors ? problems.code : undefined} />
              <ColumnSelect id="imp-name" label="Employee name" headers={headers} value={mapping.name_column} optional
                onChange={(v) => set("name_column", v)} hint="Only for your reference" />
            </div>
            {mapping.layout === "long" ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <ColumnSelect id="imp-date" label="Date" required headers={headers} value={mapping.date_column}
                  onChange={(v) => set("date_column", v)} error={showErrors ? problems.date : undefined} />
                <ColumnSelect id="imp-status" label="Status" required headers={headers} value={mapping.status_column}
                  onChange={(v) => set("status_column", v)} error={showErrors ? problems.status : undefined} />
                <ColumnSelect id="imp-note" label="Note" headers={headers} value={mapping.note_column} optional
                  onChange={(v) => set("note_column", v)} />
              </div>
            ) : (
              <DateColumns headers={headers} mapping={mapping} detected={inspect.detected_mapping.date_columns}
                onChange={(dc) => set("date_columns", dc)} error={showErrors ? problems.dates : undefined} />
            )}
          </CardContent>
        </Card>

        {/* ---------------- status aliases */}
        <StatusAliases inspect={inspect} mapping={mapping} onChange={(m) => set("status_map", m)} />

        {/* ---------------- templates */}
        <Card>
          <CardHeader>
            <CardTitle>Templates</CardTitle>
            <CardDescription>Reuse a mapping for files that come in the same shape every month.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Apply a saved template" htmlFor="imp-tpl">
              {templates.isLoading ? <Skeleton className="h-9" /> : (
                <Select value="" onValueChange={(v) => {
                  const t = templates.data?.find((x) => String(x.id) === v);
                  if (t) applyTemplate(t);
                }} disabled={!templates.data?.length}>
                  <SelectTrigger id="imp-tpl">
                    <SelectValue placeholder={templates.data?.length ? "Choose a template…" : "No saved templates yet"} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.data?.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name} · {t.layout === "wide" ? "Wide" : "Long"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Save this mapping as" htmlFor="imp-save" hint="Saved when you run validation. Same name overwrites.">
              <div className="relative">
                <Save className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id="imp-save" value={saveAs} maxLength={100} placeholder="e.g. Biometric export (monthly)"
                  className="pl-9" onChange={(e) => setSaveAs(e.target.value)} />
              </div>
            </Field>
          </CardContent>
        </Card>
      </div>

      <SamplePreview inspect={inspect} mapping={mapping} />

      {/* footer */}
      <div className="sticky bottom-0 z-20 -mx-1 flex flex-col-reverse gap-2 rounded-xl border glass px-3 py-3 shadow-e2 safe-bottom sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft aria-hidden />Back</Button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {showErrors && !valid && (
            <p role="alert" className="text-xs font-medium text-destructive">{Object.values(problems)[0]}</p>
          )}
          <Button onClick={submit} loading={validating} disabled={reinspecting}>
            Validate file{!validating && <ArrowRight aria-hidden />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ pieces */

function LayoutToggle({ value, onChange }: { value: Layout; onChange: (v: Layout) => void }) {
  const opts: { v: Layout; label: string; icon: React.ReactNode; hint: string }[] = [
    { v: "wide", label: "Wide", icon: <Columns3 />, hint: "Dates across columns" },
    { v: "long", label: "Long", icon: <Rows3 />, hint: "One row per day" },
  ];
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="radiogroup" aria-labelledby="layout-label" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
      {opts.map((o, i) => {
        const on = value === o.v;
        return (
          <button key={o.v} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.v)}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                e.preventDefault();
                const n = opts[(i + 1) % 2];
                onChange(n.v);
                refs.current[(i + 1) % 2]?.focus();
              }
            }}
            className={cn("flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left transition-all duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
              on ? "bg-surface text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground")}>
            <span className={cn(on && "text-primary")} aria-hidden>{o.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block truncate text-2xs text-muted-foreground">{o.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ColumnSelect({ id, label, headers, value, onChange, required, optional, error, hint }: {
  id: string; label: string; headers: string[]; value: string | null; onChange: (v: string | null) => void;
  required?: boolean; optional?: boolean; error?: string; hint?: string;
}) {
  return (
    <Field label={label} htmlFor={id} required={required} error={error} hint={hint}>
      <Select value={value && headers.includes(value) ? value : optional ? NONE : ""}
        onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger id={id} aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-error` : undefined}
          className={cn(error && "border-destructive")}>
          <SelectValue placeholder="Choose column…" />
        </SelectTrigger>
        <SelectContent>
          {optional && <SelectItem value={NONE}>None</SelectItem>}
          {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function DateColumns({ headers, mapping, detected, onChange, error }: {
  headers: string[]; mapping: Mapping; detected: Record<string, string>; onChange: (dc: Record<string, string>) => void;
  error?: string;
}) {
  const candidates = headers.filter((h) => h !== mapping.employee_code_column && h !== mapping.name_column);
  const dc = mapping.date_columns;
  const mapped = candidates.filter((h) => dc[h]).length;
  const update = (h: string, d: string | null) => {
    const next = { ...dc };
    if (d) next[h] = d; else delete next[h];
    onChange(next);
  };
  const dates = Object.values(dc).filter(Boolean).sort();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Date columns<span className="text-destructive" aria-hidden> *</span></p>
          <p className="text-xs text-muted-foreground tnum" aria-live="polite">
            {mapped} of {candidates.length} columns mapped
            {dates.length > 0 && <> · {fmtDate(dates[0], "d MMM")} – {fmtDate(dates[dates.length - 1], "d MMM yyyy")}</>}
          </p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...detected })} disabled={!Object.keys(detected).length}>
            <Wand2 aria-hidden />Auto-detect
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChange({})} disabled={!mapped}>Clear</Button>
        </div>
      </div>
      <ul className={cn("max-h-72 divide-y overflow-y-auto rounded-lg border bg-surface-sunken/50 scrollbar-thin",
        error && "border-destructive")} aria-label="Header to date mapping">
        {candidates.length === 0 && <li className="p-3 text-sm text-muted-foreground">No other columns found.</li>}
        {candidates.map((h) => {
          const on = !!dc[h];
          const inputId = `dc-${h}`;
          return (
            <li key={h} className={cn("flex items-center gap-3 px-3 py-1.5", !on && "text-muted-foreground")}>
              <Checkbox checked={on} aria-label={`Import column ${h}`}
                onCheckedChange={(c) => update(h, c ? (detected[h] ?? dc[h] ?? "") || null : null)}
                disabled={!on && !detected[h]} />
              <label htmlFor={inputId} className="min-w-0 flex-1 truncate font-mono text-xs" title={h}>{h}</label>
              <CalendarRange className="size-3.5 shrink-0 opacity-50" aria-hidden />
              <Input id={inputId} type="date" value={dc[h] ?? ""} onChange={(e) => update(h, e.target.value || null)}
                className="h-8 w-[9.5rem] text-xs tnum" aria-label={`Date for column ${h}`} />
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

function StatusAliases({ inspect, mapping, onChange }: {
  inspect: Inspect; mapping: Mapping; onChange: (m: Record<string, string>) => void;
}) {
  const entries = Object.entries(mapping.status_map);
  const [draft, setDraft] = React.useState("");
  const idx = (h: string | null) => (h ? inspect.headers.indexOf(h) : -1);

  // distinct values in the mapped status cells of the sample that the backend won't understand
  const unknown = React.useMemo(() => {
    const cols = mapping.layout === "wide" ? Object.keys(mapping.date_columns).map(idx) : [idx(mapping.status_column)];
    const seen = new Set<string>();
    inspect.sample_rows.forEach((r) => cols.forEach((c) => { if (c >= 0 && r[c]) seen.add(r[c].trim()); }));
    return [...seen].filter((v) => !isKnownValue(v, mapping.status_map)).slice(0, 12);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspect, mapping.layout, mapping.date_columns, mapping.status_column, mapping.status_map]);

  const add = (raw: string, code = "P") => {
    const k = raw.trim();
    if (!k) return;
    onChange({ ...mapping.status_map, [k]: mapping.status_map[k] ?? code });
    setDraft("");
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom status codes</CardTitle>
        <CardDescription>Map values your sheet uses (e.g. “PP”, “Late”) to an ProsParity status. Common ones like P, A, HD, CL, W/O already work.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {unknown.length > 0 && (
          <div className="rounded-lg bg-warning/10 p-3 ring-1 ring-inset ring-warning/20">
            <p className="mb-2 text-xs font-medium text-warning">Unrecognised values in the sample — click to map</p>
            <div className="flex flex-wrap gap-1.5">
              {unknown.map((u) => (
                <button key={u} type="button" onClick={() => add(u)}
                  className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full bg-surface px-2.5 font-mono text-xs ring-1 ring-inset ring-warning/30 transition-colors hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Add mapping for ${u}`}>
                  <Plus className="size-3" aria-hidden />{u}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.length > 0 && (
          <ul className="grid gap-2" aria-label="Custom status mappings">
            {entries.map(([k, v]) => (
              <li key={k} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-md bg-surface-sunken px-2.5 py-1.5 font-mono text-xs ring-1 ring-inset ring-border" title={k}>{k}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Select value={v} onValueChange={(c) => onChange({ ...mapping.status_map, [k]: c })}>
                  <SelectTrigger className="w-40" aria-label={`Status for ${k}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SETTABLE.map((c) => (
                      <SelectItem key={c} value={c}>
                        <span className="inline-flex items-center gap-2"><StatusBadge code={c} size="xs" />{STATUS[c].label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove mapping for ${k}`}
                  onClick={() => { const n = { ...mapping.status_map }; delete n[k]; onChange(n); }}>
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(draft); }}>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Value in your sheet, e.g. PP" maxLength={30}
            aria-label="New custom value" />
          <Button type="submit" variant="outline" disabled={!draft.trim()}><Plus aria-hidden />Add</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SamplePreview({ inspect, mapping }: { inspect: Inspect; mapping: Mapping }) {
  const role = (h: string): { label: string; cls: string } | null => {
    if (!h) return null;
    if (h === mapping.employee_code_column) return { label: "Employee code", cls: "bg-primary/10 text-primary" };
    if (h === mapping.name_column) return { label: "Name", cls: "bg-muted text-muted-foreground" };
    if (mapping.layout === "wide" && mapping.date_columns[h]) return { label: fmtDate(mapping.date_columns[h], "EEE d MMM"), cls: "bg-success/10 text-success" };
    if (mapping.layout === "long") {
      if (h === mapping.date_column) return { label: "Date", cls: "bg-success/10 text-success" };
      if (h === mapping.status_column) return { label: "Status", cls: "bg-accent/10 text-accent" };
      if (h === mapping.note_column) return { label: "Note", cls: "bg-muted text-muted-foreground" };
    }
    return null;
  };
  return (
    <Card>
      <CardHeader className="flex-row items-end justify-between gap-2">
        <div>
          <CardTitle>Sample</CardTitle>
          <CardDescription>First {inspect.sample_rows.length} rows under the header. Tinted columns will be imported.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {inspect.sample_rows.length === 0 ? (
          <p className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground">No rows below the header row. Try a smaller header row number.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border scrollbar-thin" tabIndex={0} role="region" aria-label="Sample rows">
            <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 border-b bg-muted px-2 py-2 text-right font-medium text-muted-foreground tnum">#</th>
                  {inspect.headers.map((h, i) => {
                    const r = role(h);
                    return (
                      <th key={i} scope="col" className="border-b bg-muted px-2.5 py-2 text-left align-bottom font-semibold">
                        <span className="block max-w-[10rem] truncate font-mono" title={h}>{h || <span className="text-muted-foreground">—</span>}</span>
                        {r && <span className={cn("mt-1 inline-block rounded px-1.5 py-px text-2xs font-medium", r.cls)}>{r.label}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {inspect.sample_rows.map((row, ri) => (
                  <tr key={ri}>
                    <td className="sticky left-0 z-10 border-b bg-card px-2 py-1.5 text-right text-muted-foreground tnum">{mapping.header_row + ri + 1}</td>
                    {inspect.headers.map((h, ci) => (
                      <td key={ci} className={cn("border-b px-2.5 py-1.5 font-mono", role(h) && "bg-primary/[.035]",
                        !role(h) && "text-muted-foreground")}>
                        <span className="block max-w-[10rem] truncate">{row[ci] ?? ""}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
