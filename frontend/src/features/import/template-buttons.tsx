import * as React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { download, errorMessage } from "@/lib/api";
import { useCycle } from "@/lib/cycle";
import { cn, downloadBlob } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Layout } from "./types";

/** Blank wide/long templates for the globally selected cycle. */
export function TemplateButtons({ className, size = "sm" }: { className?: string; size?: "sm" | "default" }) {
  const { cycle } = useCycle();
  const [busy, setBusy] = React.useState<Layout | null>(null);
  const get = async (layout: Layout) => {
    setBusy(layout);
    try {
      const { blob, filename } = await download("/api/imports/template.xlsx", { layout, cycle_id: cycle?.id });
      downloadBlob(blob, filename);
      toast.success(`${layout === "wide" ? "Wide" : "Long"} template downloaded`, { description: cycle?.label });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {(["wide", "long"] as const).map((l) => (
        <Button key={l} variant="outline" size={size} loading={busy === l} onClick={() => get(l)}
          aria-label={`Download blank ${l} template${cycle ? ` for ${cycle.label}` : ""}`}>
          {busy !== l && <Download aria-hidden />}{l === "wide" ? "Wide template" : "Long template"}
        </Button>
      ))}
    </div>
  );
}
