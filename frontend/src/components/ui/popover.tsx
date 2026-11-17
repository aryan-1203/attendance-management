import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & { bare?: boolean }
>(({ className, align = "center", sideOffset = 6, bare, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content ref={ref} align={align} sideOffset={sideOffset}
      className={cn(bare ? "z-50 outline-none " : "z-50 w-72 rounded-xl border glass p-3 text-popover-foreground shadow-e3 outline-none " +
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 " +
        "data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95", className)}
      {...props} />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";
