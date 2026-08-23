import { forwardRef } from "react";
import type * as React from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Checkbox in the launcher's own style. The native control keeps every
 * behaviour a checkbox is expected to have (label click, keyboard, form
 * semantics) but is visually hidden, because the OS renderer ignores our
 * palette and paints a bright system-blue square instead.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <span className={cn("relative inline-flex h-[18px] w-[18px] shrink-0", className)}>
      <input
        ref={ref}
        type="checkbox"
        className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center rounded-[5px] border border-border bg-secondary/40",
          "transition-[background-color,border-color,box-shadow] duration-150",
          "peer-hover:border-primary/50",
          "peer-checked:border-primary peer-checked:bg-primary",
          "peer-checked:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.2),0_2px_8px_-2px_hsl(258_90%_66%/0.55)]",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
          "peer-disabled:opacity-40",
          // The tick is a descendant, not a sibling, so peer-checked has to
          // reach it through the box rather than style it directly.
          "peer-checked:[&>svg]:scale-100 peer-checked:[&>svg]:opacity-100",
        )}
      >
        <Check
          className="h-3 w-3 scale-75 text-primary-foreground opacity-0 transition-[opacity,transform] duration-150"
          strokeWidth={3.5}
        />
      </span>
    </span>
  ),
);
Checkbox.displayName = "Checkbox";
