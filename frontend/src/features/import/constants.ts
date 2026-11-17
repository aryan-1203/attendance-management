/** Values the backend already understands without a custom alias (mirror of import_service.STATUS_ALIASES keys). */
export const KNOWN_VALUES = new Set([
  "P", "PRESENT", "1", "1.0", "X", "✓", "PR",
  "A", "ABSENT", "AB", "0", "0.0",
  "HD", "H/D", "HALF DAY", "HALFDAY", "HALF-DAY", "0.5", "½", "½P", "P/2", "1/2", "HF",
  "L", "LEAVE", "PL", "CL", "SL", "EL", "AL",
  "WO", "W/O", "WOFF", "WEEKLY OFF", "OFF", "SUN", "SUNDAY",
  "H", "HOL", "HOLIDAY", "PH", "PUBLIC HOLIDAY",
  "CO", "C/O", "COMP OFF", "COMPOFF", "COFF",
  "WFH", "WORK FROM HOME", "REMOTE",
  "OD", "ON DUTY", "TOUR",
]);

export function isKnownValue(v: string, map: Record<string, string>): boolean {
  const s = v.trim().toUpperCase();
  if (!s) return true;
  if (Object.keys(map).some((k) => k.trim().toUpperCase() === s)) return true;
  return KNOWN_VALUES.has(s);
}
