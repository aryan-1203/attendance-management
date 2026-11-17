import * as React from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuGroup = DM.Group;
export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DM.Content>, React.ComponentPropsWithoutRef<typeof DM.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DM.Portal>
    <DM.Content ref={ref} sideOffset={sideOffset}
      className={cn("z-50 min-w-[11rem] overflow-hidden rounded-xl border glass p-1 text-popover-foreground shadow-e3 " +
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 " +
        "data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95", className)}
      {...props} />
  </DM.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";
export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DM.Item>, React.ComponentPropsWithoutRef<typeof DM.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <DM.Item ref={ref}
    className={cn("relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none " +
      "transition-colors data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 " +
      "[&_svg]:size-4 [&_svg]:text-muted-foreground", destructive && "text-destructive", className)}
    {...props} />
));
DropdownMenuItem.displayName = "DropdownMenuItem";
export const DropdownMenuLabel = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof DM.Label>) => (
  <DM.Label className={cn("px-2.5 py-1.5 text-xs font-medium text-muted-foreground", className)} {...p} />
);
export const DropdownMenuSeparator = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof DM.Separator>) => (
  <DM.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...p} />
);
