import { forwardRef } from "react";
import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  // Filled shapes, no outlines: the prominent one in the theme's colour, the
  // rest in a quiet grey fill, a destructive one tinted red. Hover only
  // lifts the fill; the press is what answers, at once.
  primary:
    "kiza-action border-transparent text-primary-foreground font-semibold hover:brightness-[1.08]",
  secondary: "kiza-button bg-secondary/55 text-foreground/90 font-medium hover:bg-secondary/75 hover:text-foreground",
  ghost:
    "kiza-button bg-transparent text-muted-foreground font-medium hover:bg-secondary/50 hover:text-foreground !border-transparent",
  danger:
    "kiza-button bg-destructive/[0.14] text-red-300 font-medium hover:bg-destructive/[0.22]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", children, ...props }, ref) => (
    <button
      ref={ref}
      {...editable(variant === "primary" ? "action" : "button")}
      className={cn(
        "inline-flex h-10 select-none items-center justify-center gap-2 border px-4 text-sm tracking-[-0.005em]",
        "transition-[transform,background-color,border-color,color,box-shadow,filter] duration-150 ease-out active:scale-[0.97] active:duration-75",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        buttonVariants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export function IconButton({ className, ...props }: ButtonProps) {
  return (
    <Button
      variant="ghost"
      className={cn("h-9 w-9 shrink-0 rounded-[10px] px-0", className)}
      {...props}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      {...editable("input")}
      className={cn(
        "kiza-input h-10 w-full border px-3 text-sm outline-none",
        "transition-[border-color,box-shadow,background-color] duration-150",
        "placeholder:text-muted-foreground/60",
        "focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...editable("badge")}
      className={cn(
        "kiza-badge inline-flex max-w-full items-center gap-1.5 border px-2 py-1 text-xs font-medium text-muted-foreground tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      {...editable("panel")}
      className={cn("kiza-panel border kiza-elevated", className)}
      {...props}
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** The one thing to do about it, under the words. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/20 p-8 text-center", className)}>
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-secondary/35 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {description && <div className="mt-1 max-w-md text-sm text-muted-foreground">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive", className)}>
      {message}
    </div>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-secondary/45", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...editable("input")}
      className={cn(
        "kiza-input h-10 border px-3 text-sm outline-none",
        "transition-[border-color,box-shadow] duration-150",
        "focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function DataTable({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 overflow-hidden rounded-lg border border-border", className)} {...props} />;
}
