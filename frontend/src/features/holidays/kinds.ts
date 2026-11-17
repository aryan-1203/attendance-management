import { CircleDashed, Sparkle, Star, type LucideIcon } from "lucide-react";

export type HolidayKind = "public" | "optional" | "restricted";
export const HOLIDAY_KINDS: HolidayKind[] = ["public", "optional", "restricted"];

/**
 * Each kind has a distinct token colour AND a distinct shape/icon so colour is never the only signal:
 * public = solid fill, optional = outlined ring, restricted = dashed border.
 */
export const KIND_META: Record<HolidayKind, {
  label: string; short: string; description: string; icon: LucideIcon; cell: string; badge: string; swatch: string; dot: string;
}> = {
  public: {
    label: "Public", short: "Public holiday", icon: Star,
    description: "Office closed for everyone. Counts as a paid holiday (H).",
    cell: "bg-status-h text-white font-semibold border-transparent",
    badge: "bg-status-h/15 text-status-h-fg ring-status-h/30",
    swatch: "bg-status-h border-transparent",
    dot: "bg-status-h",
  },
  optional: {
    label: "Optional", short: "Optional holiday", icon: Sparkle,
    description: "Employees may choose to take it. Office stays open.",
    cell: "bg-status-l/15 text-status-l-fg font-semibold border-status-l",
    badge: "bg-status-l/15 text-status-l-fg ring-status-l/30",
    swatch: "bg-status-l/15 border-status-l",
    dot: "bg-status-l",
  },
  restricted: {
    label: "Restricted", short: "Restricted holiday", icon: CircleDashed,
    description: "Applies to some locations or groups only.",
    cell: "bg-accent/10 text-accent font-semibold border-dashed border-accent",
    badge: "bg-accent/10 text-accent ring-accent/30",
    swatch: "bg-accent/10 border-dashed border-accent",
    dot: "bg-accent",
  },
};

export function kindMeta(k: string) {
  return KIND_META[(k as HolidayKind)] ?? KIND_META.public;
}
