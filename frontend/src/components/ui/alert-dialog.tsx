import * as React from "react";
import * as AD from "@radix-ui/react-alert-dialog";
import { buttonVariants } from "./button";
import { cn } from "@/lib/utils";

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", destructive,
  onConfirm, children, loading }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: React.ReactNode;
  confirmLabel?: string; destructive?: boolean; onConfirm: () => void; children?: React.ReactNode; loading?: boolean;
}) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-50 bg-background/55 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AD.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border bg-popover p-6 shadow-e3 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="grid gap-1.5">
            <AD.Title className="text-lg font-semibold">{title}</AD.Title>
            {description && <AD.Description className="text-sm text-muted-foreground">{description}</AD.Description>}
          </div>
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AD.Cancel className={buttonVariants({ variant: "outline" })}>Cancel</AD.Cancel>
            <AD.Action disabled={loading}
              className={cn(buttonVariants({ variant: destructive ? "destructive" : "default" }))}
              onClick={(e) => { e.preventDefault(); onConfirm(); }}>{confirmLabel}</AD.Action>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
