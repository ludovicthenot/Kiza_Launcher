import { cn } from "../../lib/utils";

/**
 * A line of work in progress: what is being done, how far, and a bar that
 * eases between values with a sheen passing over it. Used wherever a list of
 * files is fetched one after another.
 */
export function ProgressStrip({
  label,
  done,
  total,
  className,
}: {
  label: string;
  done: number;
  total: number;
  className?: string;
}) {
  const percent = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className={cn("space-y-2", className)} aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 text-[0.7812rem]">
        <span key={label} className="min-w-0 truncate text-muted-foreground animate-in fade-in-0 duration-200">
          {label}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {done} / {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
      >
        <div
          className="kiza-sheen h-full rounded-full bg-primary transition-[width] duration-700 ease-drawer"
          style={{ width: `${Math.max(3, percent)}%` }}
        />
      </div>
    </div>
  );
}

/** A ring that fills to a percentage, the number in the middle. */
export function ProgressRing({ percent, size = 48 }: { percent: number | null; size?: number }) {
  const radius = size / 2 - 5;
  const circumference = 2 * Math.PI * radius;
  const known = percent !== null;
  const fraction = known ? Math.min(1, Math.max(0, percent / 100)) : 0.28;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className={cn("-rotate-90", !known && "animate-spin [animation-duration:1.6s]")} style={{ width: size, height: size }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth="4" className="stroke-white/15" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          className="stroke-white transition-[stroke-dashoffset] duration-700 ease-drawer"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      {known && (
        <span className="absolute inset-0 flex items-center justify-center text-[0.6875rem] font-semibold tabular-nums text-white">
          {Math.round(percent)}%
        </span>
      )}
    </div>
  );
}
