import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { Check, Minus } from "lucide-react";
import { cn, hueFor, initials } from "@/lib/utils";

/* ------------------------------------------------------------------ Tabs (M3 segmented feel) */
export const Tabs = TabsPrimitive.Root;
export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref}
    className={cn("inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />
));
TabsList.displayName = "TabsList";
export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref}
    className={cn("inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 " +
      "text-sm font-medium transition-all duration-base hover:text-foreground disabled:opacity-50 " +
      "data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-e1 [&_svg]:size-4", className)}
    {...props} />
));
TabsTrigger.displayName = "TabsTrigger";
export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn("mt-4 focus-visible:outline-none", className)} {...props} />
));
TabsContent.displayName = "TabsContent";

/* ------------------------------------------------------------------ Tooltip */
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ content, children, side = "top" }: {
  content: React.ReactNode; children: React.ReactElement; side?: "top" | "bottom" | "left" | "right";
}) {
  if (!content) return children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6}
          className="z-[60] max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-e2 animate-in fade-in-0 zoom-in-95">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ Switch */
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root ref={ref}
    className={cn("peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent " +
      "transition-colors duration-base data-[state=checked]:bg-primary data-[state=unchecked]:bg-input disabled:opacity-50", className)}
    {...props}>
    <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow-e2 transition-transform duration-base ease-out-expo data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";

/* ------------------------------------------------------------------ Checkbox */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root ref={ref}
    className={cn("peer size-4 shrink-0 cursor-pointer rounded-[5px] border border-input bg-surface shadow-e1 " +
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground " +
      "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground disabled:opacity-50", className)}
    {...props}>
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      {props.checked === "indeterminate" ? <Minus className="size-3" /> : <Check className="size-3" strokeWidth={3} />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";

/* ------------------------------------------------------------------ Avatar */
export function PersonAvatar({ name, src, size = 32, className, ring }: {
  name: string; src?: string | null; size?: number; className?: string; ring?: boolean;
}) {
  const h = hueFor(name);
  return (
    <AvatarPrimitive.Root className={cn("relative inline-flex shrink-0 overflow-hidden rounded-full",
      ring && "ring-2 ring-background", className)} style={{ width: size, height: size }}>
      {src && <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" />}
      <AvatarPrimitive.Fallback delayMs={src ? 300 : 0}
        className="flex size-full items-center justify-center font-semibold"
        style={{ fontSize: size * 0.38, background: `hsl(${h} 70% 92%)`, color: `hsl(${h} 55% 30%)` }}>
        <span className="sr-only">{name}</span><span aria-hidden>{initials(name)}</span>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ Separator / Progress / Skeleton */
export const Separator = ({ className, orientation = "horizontal", ...p }:
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) => (
  <SeparatorPrimitive.Root orientation={orientation}
    className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)} {...p} />
);

export function Progress({ value, className, indicatorClassName, label }: {
  value: number; className?: string; indicatorClassName?: string; label?: string;
}) {
  return (
    <ProgressPrimitive.Root value={value} aria-label={label}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <ProgressPrimitive.Indicator
        className={cn("h-full rounded-full bg-primary transition-transform duration-slow ease-out-expo", indicatorClassName)}
        style={{ transform: `translateX(-${100 - Math.max(0, Math.min(100, value))}%)` }} />
    </ProgressPrimitive.Root>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden className={cn("relative overflow-hidden rounded-md bg-muted before:absolute before:inset-0 " +
      "before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent " +
      "before:via-white/40 dark:before:via-white/5 before:to-transparent", className)} {...props} />
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border bg-surface px-1 font-mono " +
      "text-[10px] font-medium text-muted-foreground shadow-e1", className)}>{children}</kbd>
  );
}
