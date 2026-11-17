import { Check } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/misc";

export const STEPS = [
  { key: "upload", label: "Upload", hint: "Choose a file" },
  { key: "mapping", label: "Column mapping", hint: "Tell us what's where" },
  { key: "validate", label: "Validation", hint: "Review issues" },
  { key: "confirm", label: "Confirm", hint: "Apply to attendance" },
  { key: "done", label: "Done", hint: "Cycles recalculated" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

/** Wizard progress: full stepper on ≥ sm, compact "Step n of 5" + progress bar on phones. */
export function Stepper({ step, onStep, maxReached }: {
  step: number; maxReached: number; onStep?: (i: number) => void;
}) {
  const reduce = useReducedMotion();
  const done = step === STEPS.length - 1;
  return (
    <nav aria-label="Import progress" className="mb-5">
      {/* phones */}
      <div className="sm:hidden">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="font-semibold">{STEPS[step].label}</span>
          <span className="text-xs text-muted-foreground tnum">Step {step + 1} of {STEPS.length}</span>
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} label={`Step ${step + 1} of ${STEPS.length}`} />
      </div>
      {/* tablet / desktop */}
      <ol className="hidden items-center gap-2 sm:flex">
        {STEPS.map((s, i) => {
          const state = i < step || done ? "done" : i === step ? "current" : "todo";
          const clickable = !!onStep && !done && i <= maxReached && i !== step && i < STEPS.length - 1;
          const inner = (
            <>
              <span className={cn("relative flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tnum transition-colors duration-base",
                state === "done" && "bg-primary text-primary-foreground",
                state === "current" && "bg-primary/10 text-primary ring-2 ring-primary",
                state === "todo" && "bg-muted text-muted-foreground")}>
                {state === "done" ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              <span className="hidden min-w-0 text-left lg:block">
                <span className={cn("block truncate text-sm font-medium", state === "todo" && "text-muted-foreground")}>{s.label}</span>
                <span className="block truncate text-2xs text-muted-foreground">{s.hint}</span>
              </span>
              <span className={cn("text-sm font-medium lg:hidden", state !== "current" && "sr-only")}>{s.label}</span>
            </>
          );
          return (
            <li key={s.key} className={cn("flex min-w-0 items-center gap-2", i < STEPS.length - 1 && "flex-1")}
              aria-current={state === "current" ? "step" : undefined}>
              {clickable ? (
                <button type="button" onClick={() => onStep!(i)}
                  className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg p-1 -m-1 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Go back to ${s.label}`}>
                  {inner}
                </button>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  {inner}
                  <span className="sr-only">{state === "done" ? "(completed)" : state === "todo" ? "(not started)" : ""}</span>
                </div>
              )}
              {i < STEPS.length - 1 && (
                <span aria-hidden className="relative mx-1 h-0.5 min-w-4 flex-1 overflow-hidden rounded-full bg-muted">
                  <motion.span className="absolute inset-y-0 left-0 rounded-full bg-primary"
                    initial={false} animate={{ width: i < step || done ? "100%" : "0%" }}
                    transition={reduce ? { duration: 0 } : { duration: 0.4, ease: [0.16, 1, 0.3, 1] }} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
