import {
  ArrowLeftRight, BadgeMinus, Briefcase, CalendarHeart, CheckCircle2, Coffee, Contrast, House, LogOut,
  Palmtree, UserPlus, XCircle, type LucideIcon,
} from "lucide-react";

export type StatusCode = "P" | "A" | "HD" | "L" | "WO" | "H" | "CO" | "WFH" | "OD" | "NJ" | "EX" | "LOP";

export interface StatusMeta {
  code: StatusCode;
  label: string;
  short: string;
  icon: LucideIcon;
  /** tailwind classes: soft cell / badge, solid dot, text */
  soft: string;
  solid: string;
  text: string;
  key?: string; // keyboard shortcut
  settable: boolean;
  /** css color for charts */
  color: string;
}

const CLASSES: Record<string, { soft: string; solid: string; text: string }> = {
  p: { soft: "bg-status-p/12 text-status-p-fg ring-1 ring-inset ring-status-p/25", solid: "bg-status-p text-white", text: "text-status-p-fg" },
  a: { soft: "bg-status-a/12 text-status-a-fg ring-1 ring-inset ring-status-a/25", solid: "bg-status-a text-white", text: "text-status-a-fg" },
  hd: { soft: "bg-status-hd/12 text-status-hd-fg ring-1 ring-inset ring-status-hd/25", solid: "bg-status-hd text-white", text: "text-status-hd-fg" },
  l: { soft: "bg-status-l/12 text-status-l-fg ring-1 ring-inset ring-status-l/25", solid: "bg-status-l text-white", text: "text-status-l-fg" },
  wo: { soft: "bg-status-wo/12 text-status-wo-fg ring-1 ring-inset ring-status-wo/25", solid: "bg-status-wo text-white", text: "text-status-wo-fg" },
  h: { soft: "bg-status-h/12 text-status-h-fg ring-1 ring-inset ring-status-h/25", solid: "bg-status-h text-white", text: "text-status-h-fg" },
  co: { soft: "bg-status-co/12 text-status-co-fg ring-1 ring-inset ring-status-co/25", solid: "bg-status-co text-white", text: "text-status-co-fg" },
  wfh: { soft: "bg-status-wfh/12 text-status-wfh-fg ring-1 ring-inset ring-status-wfh/25", solid: "bg-status-wfh text-white", text: "text-status-wfh-fg" },
  od: { soft: "bg-status-od/12 text-status-od-fg ring-1 ring-inset ring-status-od/25", solid: "bg-status-od text-white", text: "text-status-od-fg" },
  lop: { soft: "bg-status-lop/12 text-status-lop-fg ring-1 ring-inset ring-status-lop/25", solid: "bg-status-lop text-white", text: "text-status-lop-fg" },
  nj: { soft: "bg-status-nj/12 text-status-nj-fg ring-1 ring-inset ring-status-nj/25", solid: "bg-status-nj text-white", text: "text-status-nj-fg" },
  ex: { soft: "bg-status-ex/12 text-status-ex-fg ring-1 ring-inset ring-status-ex/25", solid: "bg-status-ex text-white", text: "text-status-ex-fg" },
};

const m = (code: StatusCode, label: string, icon: LucideIcon, token: string, key: string | undefined,
  settable = true): StatusMeta => ({
  code, label, short: code, icon, key, settable, ...CLASSES[token], color: `hsl(var(--st-${token}))`,
});

/** Same semantic color + icon + text everywhere: grid, calendar, charts, badges. Color is never the only signal. */
export const STATUS: Record<StatusCode, StatusMeta> = {
  P: m("P", "Present", CheckCircle2, "p", "p"),
  A: m("A", "Absent", XCircle, "a", "a"),
  HD: m("HD", "Half-day", Contrast, "hd", "d"),
  L: m("L", "Leave", Palmtree, "l", "l"),
  WO: m("WO", "Weekly off", Coffee, "wo", "w"),
  H: m("H", "Holiday", CalendarHeart, "h", "h"),
  CO: m("CO", "Comp-off", ArrowLeftRight, "co", "c"),
  WFH: m("WFH", "Work from home", House, "wfh", "f"),
  OD: m("OD", "On duty", Briefcase, "od", "o"),
  NJ: m("NJ", "Not joined", UserPlus, "nj", undefined, false),
  EX: m("EX", "Exited", LogOut, "ex", undefined, false),
  LOP: m("LOP", "Loss of pay", BadgeMinus, "lop", undefined, false),
};

export const SETTABLE: StatusCode[] = ["P", "A", "HD", "L", "WFH", "OD", "CO", "WO", "H"];
export const KEY_TO_STATUS: Record<string, StatusCode> = Object.fromEntries(
  Object.values(STATUS).filter((s) => s.key).map((s) => [s.key!, s.code]),
);

export function statusMeta(code: string | null | undefined): StatusMeta | null {
  if (!code) return null;
  return STATUS[code as StatusCode] ?? null;
}
