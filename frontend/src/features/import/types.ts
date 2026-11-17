import type { ImportBatch, ImportSummary, InspectOut } from "@/lib/types";

export type Layout = "wide" | "long";

/** Mirrors the dict accepted by `POST /api/imports/{id}/validate` (see backend import_service._extract). */
export interface Mapping {
  layout: Layout;
  header_row: number;
  employee_code_column: string | null;
  name_column: string | null;
  /** wide: header text → ISO date */
  date_columns: Record<string, string>;
  /** long */
  date_column: string | null;
  status_column: string | null;
  note_column: string | null;
  /** custom raw value → status code */
  status_map: Record<string, string>;
  cycle_id: number | null;
}

export interface Inspect extends Omit<InspectOut, "detected_mapping" | "suggested_template"> {
  detected_mapping: Mapping;
  suggested_template: { id: number; name: string } | null;
}

export interface Issue {
  field: string;
  severity: "error" | "warning";
  message: string;
}

export interface PreviewCell {
  v: string;
  sev: "ok" | "warning" | "error";
  issues: Issue[];
  row: number;
}

export interface PreviewGrid {
  dates: string[];
  employees: { code: string; name: string | null; cells: Record<string, PreviewCell> }[];
}

export interface CommitResult {
  applied: number;
  employees: number;
  affected_cycles: string[];
}

export interface RollbackResult {
  restored: number;
  kept_newer: number;
}

export interface Template {
  id: number;
  name: string;
  layout: Layout;
  mapping: Partial<Mapping>;
  created_at: string;
}

export type { ImportBatch, ImportSummary };

export function normalizeMapping(m: Partial<Mapping> | null | undefined): Mapping {
  return {
    layout: m?.layout === "long" ? "long" : "wide",
    header_row: Number(m?.header_row) || 1,
    employee_code_column: m?.employee_code_column ?? null,
    name_column: m?.name_column ?? null,
    date_columns: { ...(m?.date_columns ?? {}) },
    date_column: m?.date_column ?? null,
    status_column: m?.status_column ?? null,
    note_column: m?.note_column ?? null,
    status_map: { ...(m?.status_map ?? {}) },
    cycle_id: m?.cycle_id ?? null,
  };
}

export function toInspect(o: InspectOut): Inspect {
  const raw = o as unknown as Inspect;
  return { ...raw, detected_mapping: normalizeMapping(raw.detected_mapping) };
}

/** Naive UTC timestamps from the API → Date. */
export function utc(ts: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`);
}

export const BATCH_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }> = {
  uploaded: { label: "Uploaded", variant: "secondary" },
  validated: { label: "Validated", variant: "default" },
  committed: { label: "Imported", variant: "success" },
  rolled_back: { label: "Rolled back", variant: "warning" },
  failed: { label: "Failed", variant: "destructive" },
};
