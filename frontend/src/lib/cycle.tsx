import * as React from "react";
import { useCycles } from "@/hooks/queries";
import type { Cycle } from "@/lib/types";
import { isoDate } from "@/lib/utils";

/** Globally selected salary cycle (top-bar switcher). Defaults to the cycle containing today. */
const Ctx = React.createContext<{ cycle: Cycle | undefined; cycles: Cycle[]; setCycleId: (id: number) => void;
  current: Cycle | undefined; isLoading: boolean } | null>(null);

export function CycleProvider({ children }: { children: React.ReactNode }) {
  const { data = [], isLoading } = useCycles();
  const today = isoDate(new Date());
  const visible = data.filter((c) => c.start_date <= today);
  const current = data.find((c) => c.start_date <= today && c.end_date >= today);
  const [id, setId] = React.useState<number | null>(() => {
    const v = sessionStorage.getItem("ae-cycle");
    return v ? Number(v) : null;
  });
  const cycle = visible.find((c) => c.id === id) ?? current ?? visible[0];
  const setCycleId = (v: number) => {
    sessionStorage.setItem("ae-cycle", String(v));
    setId(v);
  };
  return <Ctx.Provider value={{ cycle, cycles: visible, setCycleId, current, isLoading }}>{children}</Ctx.Provider>;
}

export function useCycle() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useCycle outside CycleProvider");
  return c;
}
