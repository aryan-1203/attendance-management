import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** API decimals arrive as strings ("1.50"). Parse only for display/arithmetic in the UI. */
export function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  return typeof v === "number" ? v : Number(v);
}

/** Day counts: 1, 1.5, 0.5 — trailing zeros trimmed. */
export function fmtDays(v: string | number | null | undefined, opts: { signed?: boolean } = {}): string {
  const n = num(v);
  const s = Number.isInteger(n) ? n.toFixed(0) : n.toFixed(n * 10 === Math.round(n * 10) ? 1 : 2);
  return opts.signed && n > 0 ? `+${s}` : s;
}


export function fmtDate(d: string | Date | null | undefined, pattern = "d MMM yyyy"): string {
  if (!d) return "—";
  const date = typeof d === "string" ? parseISO(d) : d;
  return format(date, pattern);
}

export function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** Deterministic pleasant hue per person for avatars. */
export function hueFor(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export function pluralize(n: number, word: string, plural = `${word}s`) {
  return `${n} ${n === 1 ? word : plural}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
