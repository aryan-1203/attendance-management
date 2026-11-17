import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-base sm:text-sm shadow-e1 " +
          "transition-[border-color,box-shadow] duration-fast placeholder:text-muted-foreground/80 " +
          "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 " +
          "focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive " +
          "aria-[invalid=true]:ring-destructive/15 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-surface px-3 py-2 text-base sm:text-sm shadow-e1 " +
          "placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:border-ring " +
          "focus-visible:ring-4 focus-visible:ring-ring/15 focus-visible:ring-offset-0 disabled:opacity-50 " +
          "aria-[invalid=true]:border-destructive",
        className,
      )}
      {...props} />
  ),
);
Textarea.displayName = "Textarea";
