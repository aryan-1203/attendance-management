import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
    "transition-[background-color,box-shadow,transform,color] duration-base ease-out-expo cursor-pointer " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
    "focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[.97] " +
    "[&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-e1 hover:bg-primary/90 hover:shadow-glow",
        accent: "bg-accent text-accent-foreground shadow-e1 hover:bg-accent/90",
        destructive: "bg-destructive text-destructive-foreground shadow-e1 hover:bg-destructive/90",
        outline: "border bg-surface hover:bg-muted text-foreground shadow-e1",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/75",
        ghost: "hover:bg-muted text-foreground",
        soft: "bg-primary/10 text-primary hover:bg-primary/15",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-6 text-base",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref}
        disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
        {asChild ? children : <>{loading && <Loader2 className="animate-spin" aria-hidden />}{children}</>}
      </Comp>
    );
  },
);
Button.displayName = "Button";
export { buttonVariants };
