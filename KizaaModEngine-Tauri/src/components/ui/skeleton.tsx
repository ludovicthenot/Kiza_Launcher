import { cn } from "../../lib/utils";

/** One soft placeholder shape with a sheen passing over it. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("kiza-shimmer rounded-lg", className)} style={style} />;
}

/**
 * A list arriving: rows shaped like the rows that will replace them, in a
 * rounded card. It fades in after a beat, so a fast load never flashes it.
 */
export function SkeletonList({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "overflow-hidden rounded-2xl bg-secondary/[0.18] px-4 animate-in fade-in-0 duration-500 [animation-delay:120ms] [animation-fill-mode:both] motion-reduce:animate-none",
        className,
      )}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex min-h-[72px] items-center gap-4 border-b border-border/30 py-3 last:border-b-0">
          <Skeleton className="h-12 w-12 shrink-0 rounded-[12px]" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 rounded-full" style={{ width: `${34 + ((index * 17) % 30)}%` }} />
            <Skeleton className="h-3 rounded-full opacity-70" style={{ width: `${52 + ((index * 23) % 35)}%` }} />
          </div>
          <Skeleton className="hidden h-6 w-11 shrink-0 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

/** A grid of instance cards arriving, in the library's own shape. */
export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="grid gap-x-5 gap-y-7 animate-in fade-in-0 duration-500 [animation-delay:120ms] [animation-fill-mode:both] motion-reduce:animate-none"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-2.5">
          <Skeleton className="aspect-[3/4] w-full rounded-2xl" />
          <Skeleton className="h-3.5 w-2/3 rounded-full" />
          <Skeleton className="h-3 w-1/2 rounded-full opacity-70" />
        </div>
      ))}
    </div>
  );
}

/** A few lines of a panel arriving: settings, a summary, a small list. */
export function SkeletonBlock({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("space-y-2.5 py-2 animate-in fade-in-0 duration-500 [animation-delay:120ms] [animation-fill-mode:both] motion-reduce:animate-none", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="h-3.5 rounded-full" style={{ width: `${90 - index * 18}%` }} />
      ))}
    </div>
  );
}
