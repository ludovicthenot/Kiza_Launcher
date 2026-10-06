import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * An inset grouped list: a title above a filled card, rows inside divided by
 * hairlines. The shape the settings use, for sheets that list facts or files.
 */
export function Group({
  title,
  trailing,
  children,
  className,
}: {
  title?: ReactNode;
  /** Small text at the right of the title, like a count. */
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {(title || trailing) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
          {title && <h3 className="text-[0.8125rem] font-semibold text-foreground/90">{title}</h3>}
          {trailing && <span className="text-xs tabular-nums text-muted-foreground">{trailing}</span>}
        </div>
      )}
      <div className="divide-y divide-border/40 rounded-xl bg-secondary/[0.32] px-4 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
        {children}
      </div>
    </section>
  );
}

/** A label on the left and its value on the right. */
export function GroupRow({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-10 items-center justify-between gap-4 py-2 text-[0.8438rem]", className)}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground/95">{children}</span>
    </div>
  );
}
