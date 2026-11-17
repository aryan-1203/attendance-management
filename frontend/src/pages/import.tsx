import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { History, Upload } from "lucide-react";
import { toast } from "sonner";
import { client, errorMessage, unwrap } from "@/lib/api";
import { pluralize } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Stepper, STEPS } from "@/features/import/stepper";
import { UploadStep } from "@/features/import/upload-step";
import { MappingStep, type ReinspectArgs } from "@/features/import/mapping-step";
import { ValidationStep } from "@/features/import/validation-step";
import { ConfirmStep, DoneStep } from "@/features/import/finish-steps";
import { ImportHistory } from "@/features/import/history";
import { TemplateButtons } from "@/features/import/template-buttons";
import {
  normalizeMapping, toInspect, type CommitResult, type ImportBatch, type ImportSummary, type Inspect, type Mapping,
} from "@/features/import/types";

const STEP_COPY = [
  { title: "Upload a file", text: "Drop an Excel or CSV attendance sheet. Nothing changes until you confirm." },
  { title: "Map your columns", text: "We've guessed the layout — check the employee code and date columns, then validate." },
  { title: "Review validation", text: "Every cell is checked against employees, dates, cycles and existing marks." },
  { title: "Confirm import", text: "One last look before attendance is updated." },
  { title: "", text: "" },
];

export default function ImportPage() {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [tab, setTab] = React.useState<"new" | "history">("new");
  const [step, setStep] = React.useState(0);
  const [maxReached, setMaxReached] = React.useState(0);
  const [inspect, setInspect] = React.useState<Inspect | null>(null);
  const [mapping, setMapping] = React.useState<Mapping>(() => normalizeMapping(null));
  const [sheet, setSheet] = React.useState("");
  const [saveAs, setSaveAs] = React.useState("");
  const [summary, setSummary] = React.useState<ImportSummary | null>(null);
  const [version, setVersion] = React.useState(0);
  const [result, setResult] = React.useState<CommitResult | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const prevStep = React.useRef(0);

  const go = React.useCallback((i: number) => {
    setStep(i);
    setMaxReached((m) => Math.max(m, i));
  }, []);

  React.useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, [step, reduce]);

  const reset = () => {
    setInspect(null); setSummary(null); setResult(null); setSaveAs(""); setSheet("");
    setMapping(normalizeMapping(null)); setStep(0); setMaxReached(0);
  };

  const onUploaded = (i: Inspect) => {
    setInspect(i);
    setSheet(i.batch.sheet_name ?? i.sheets[0] ?? "");
    setMapping(i.detected_mapping);
    setSummary(null);
    setMaxReached(1);
    setStep(1);
  };

  const reinspect = useMutation({
    mutationFn: async (a: ReinspectArgs) => {
      const body = {
        sheet: a.sheet ?? sheet,
        header_row: a.kind === "structure" ? (a.sheet ? undefined : a.header_row) : mapping.header_row,
        cycle_id: a.cycle_id !== undefined ? a.cycle_id : mapping.cycle_id,
      };
      const out = await unwrap(client.POST("/api/imports/{batch_id}/inspect",
        { params: { path: { batch_id: inspect!.batch.id } }, body }));
      return { a, i: toInspect(out), sheet: body.sheet };
    },
    onSuccess: ({ a, i, sheet: s }) => {
      setInspect(i);
      setSheet(s);
      const d = i.detected_mapping;
      if (a.kind === "structure") {
        setMapping((m) => ({ ...d, status_map: m.status_map, cycle_id: m.cycle_id }));
      } else {
        setMapping((m) => ({
          ...m, cycle_id: a.cycle_id ?? null,
          ...(d.layout === "wide" ? { layout: "wide" as const, date_columns: d.date_columns } : {}),
        }));
        if (d.layout === "wide") toast.success(`Mapped ${pluralize(Object.keys(d.date_columns).length, "column")} to dates`);
      }
      setSummary(null);
      setMaxReached(1);
    },
  });

  const validate = useMutation({
    mutationFn: () => unwrap(client.POST("/api/imports/{batch_id}/validate", {
      params: { path: { batch_id: inspect!.batch.id } },
      body: { mapping: mapping as unknown as Record<string, never>, sheet: sheet || null, save_template: saveAs.trim() || null },
    })),
    onSuccess: (s) => {
      setSummary(s);
      setVersion((v) => v + 1);
      if (saveAs.trim()) {
        toast.success(`Template “${saveAs.trim()}” saved`);
        qc.invalidateQueries({ queryKey: ["import-templates"] });
      }
      qc.invalidateQueries({ queryKey: ["imports"] });
      go(2);
    },
  });

  const commit = useMutation({
    meta: { silent: true },
    mutationFn: () => unwrap(client.POST("/api/imports/{batch_id}/commit", { params: { path: { batch_id: summary!.batch.id } } })),
    onSuccess: (d) => {
      const r = d as unknown as CommitResult;
      setResult(r);
      toast.success(`Imported ${pluralize(r.applied, "mark")}`, { description: r.affected_cycles.length ? `Recalculated ${r.affected_cycles.join(", ")}` : undefined });
      qc.invalidateQueries();
      go(4);
    },
    onError: (e) => toast.error(errorMessage(e), { description: (e as { status?: number }).status === 423 ? "Unlock that cycle in Settings → Cycles, then try again." : undefined }),
  });

  const resume = useMutation({
    mutationFn: async (b: ImportBatch) => {
      const validated = b.status === "validated" && !!b.mapping;
      const m = validated ? normalizeMapping(b.mapping as Partial<Mapping>) : null;
      const [ins, sum] = await Promise.all([
        unwrap(client.POST("/api/imports/{batch_id}/inspect", { params: { path: { batch_id: b.id } },
          body: { sheet: b.sheet_name, header_row: m?.header_row, cycle_id: m?.cycle_id } })),
        validated ? unwrap(client.GET("/api/imports/{batch_id}", { params: { path: { batch_id: b.id } } })) : null,
      ]);
      return { ins: toInspect(ins), sum, m, b };
    },
    onSuccess: ({ ins, sum, m, b }) => {
      setInspect(ins); setSheet(b.sheet_name ?? ins.sheets[0] ?? ""); setMapping(m ?? ins.detected_mapping);
      setSummary(sum); setVersion((v) => v + 1); setResult(null); setSaveAs("");
      setTab("new");
      const target = sum ? 2 : 1;
      setMaxReached(target); setStep(target);
    },
  });

  const copy = STEP_COPY[step];
  const slide = reduce ? {} : { initial: { opacity: 0, x: 16 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -16 } };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Import attendance" eyebrow="Attendance"
        description="Bring attendance in from Excel or CSV. Every cell is validated before anything changes."
        actions={<TemplateButtons />} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "new" | "history")}>
        <TabsList aria-label="Import sections">
          <TabsTrigger value="new"><Upload aria-hidden />New import</TabsTrigger>
          <TabsTrigger value="history"><History aria-hidden />History</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-5">
          <Stepper step={step} maxReached={step === 4 ? 0 : maxReached} onStep={(i) => (i >= 2 && !summary ? undefined : setStep(i))} />
          {step < 4 && (
            <div className="mb-4">
              <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
                <span className="sr-only">Step {step + 1} of {STEPS.length}: </span>{copy.title}
              </h2>
              <p className="text-sm text-muted-foreground">{copy.text}</p>
            </div>
          )}
          {step === 4 && <h2 ref={headingRef} tabIndex={-1} className="sr-only focus-visible:ring-0">Import complete</h2>}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} {...slide} transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}>
              {step === 0 && <UploadStep onUploaded={onUploaded} />}
              {step === 1 && inspect && (
                <MappingStep inspect={inspect} mapping={mapping} setMapping={setMapping} sheet={sheet}
                  onReinspect={(a) => reinspect.mutate(a)} reinspecting={reinspect.isPending}
                  saveAs={saveAs} setSaveAs={setSaveAs} onBack={reset}
                  onValidate={() => validate.mutate()} validating={validate.isPending} />
              )}
              {step === 2 && summary && (
                <ValidationStep summary={summary} version={version} onBack={() => setStep(1)} onNext={() => go(3)} />
              )}
              {step === 3 && summary && (
                <ConfirmStep summary={summary} onBack={() => setStep(2)} onCommit={() => commit.mutate()} committing={commit.isPending} />
              )}
              {step === 4 && result && (
                <DoneStep result={result} filename={summary?.batch.filename ?? ""} onAgain={reset}
                  onHistory={() => { reset(); setTab("history"); }} />
              )}
            </motion.div>
          </AnimatePresence>
        </TabsContent>

        <TabsContent value="history" className="mt-5">
          <ImportHistory onResume={(b) => resume.mutate(b)} onStart={() => setTab("new")} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
