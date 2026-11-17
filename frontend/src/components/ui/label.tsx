import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref}
    className={cn("text-sm font-medium leading-none text-foreground peer-disabled:opacity-70", className)} {...props} />
));
Label.displayName = "Label";

export function Field({ label, htmlFor, error, hint, children, className, required }: {
  label: string; htmlFor?: string; error?: string; hint?: string; children: React.ReactNode; className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}{required && <span className="text-destructive" aria-hidden> *</span>}</Label>
      {children}
      {error ? (
        <p role="alert" id={htmlFor ? `${htmlFor}-error` : undefined} className="text-xs font-medium text-destructive">{error}</p>
      ) : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
