import * as React from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { download, errorMessage } from "@/lib/api";
import { downloadBlob } from "@/lib/utils";
import type { Cycle } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Download my monthly statement (PDF / Excel) for a cycle. */
export function StatementMenu({ cycle, variant = "outline" }: { cycle: Cycle | undefined; variant?: "outline" | "ghost" | "secondary" }) {
  const [busy, setBusy] = React.useState<"pdf" | "xlsx" | null>(null);
  const get = async (fmt: "pdf" | "xlsx") => {
    setBusy(fmt);
    try {
      const { blob, filename } = await download("/api/reports/statement", { fmt, cycle_id: cycle?.id });
      downloadBlob(blob, filename);
      toast.success("Statement downloaded", { description: cycle?.label });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} loading={!!busy} aria-label="Download my statement">
          {!busy && <Download />}Statement<ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{cycle ? `Cycle ${cycle.label}` : "Current cycle"}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void get("pdf")}><FileText />PDF statement</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void get("xlsx")}><FileSpreadsheet />Excel statement</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
