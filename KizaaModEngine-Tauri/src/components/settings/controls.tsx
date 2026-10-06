import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { SkeletonBlock } from "../ui/skeleton";

/**
 * The pieces every settings page is built from.
 *
 * They live here rather than in each page so that a row on Notifications is
 * the same height as a row on Downloads. Eleven pages that each drew their own
 * rows would drift apart within a release or two, and the drift is exactly the
 * thing a reader notices without being able to name.
 */

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(2.75rem*var(--kiza-density))] flex-wrap items-center justify-between gap-x-4 gap-y-2 py-[calc(0.625rem*var(--kiza-density))]">
      <div className="min-w-0 flex-1">
        <div className="text-[0.8438rem] leading-snug">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  busy = false,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={busy || disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // An iOS switch: the track fills with the accent, the thumb slides
        // over with a little give, and a press squeezes it.
        "group relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 ease-out disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        checked ? "bg-primary" : "bg-secondary",
      )}
    >
      <span
        className={cn(
          "absolute left-[2px] top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_hsl(0_0%_0%/0.35),0_0_0_0.5px_hsl(0_0%_0%/0.08)]",
          "transition-transform duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1.15)] motion-reduce:transition-none",
          checked ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof Loader2;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    // A grouped list: the group's name over a filled card, rows divided by
    // hairlines, no outline. The icon is kept for callers but not drawn: a
    // heading beside a sidebar of icons does not need another one.
    <section data-icon={Icon.displayName}>
      <h3 className="mb-1.5 px-1 text-[0.8125rem] font-semibold text-foreground/90">{title}</h3>
      {hint && <p className="-mt-0.5 mb-2 px-1 text-xs leading-snug text-muted-foreground">{hint}</p>}
      <div className="divide-y divide-border/40 rounded-xl bg-secondary/[0.32] px-4 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
        {children}
      </div>
    </section>
  );
}

/** A secondary action: opening a folder, running a check, clearing a cache. */
export function ActionButton({
  onClick,
  busy = false,
  disabled = false,
  icon: Icon,
  children,
  tone = "normal",
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  icon?: typeof Loader2;
  children: React.ReactNode;
  tone?: "normal" | "destructive";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-[9px] px-3 text-[0.8125rem] font-medium transition-[background-color,scale] duration-150 active:scale-[0.97] disabled:opacity-50",
        tone === "destructive"
          ? "bg-destructive/[0.15] text-red-300 hover:bg-destructive/[0.24]"
          : "bg-secondary/70 text-foreground/90 hover:bg-secondary",
      )}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        Icon && <Icon className="h-4 w-4" />
      )}
      {children}
    </button>
  );
}

/**
 * What a page shows while the configuration is being read, and what it shows if
 * it cannot be.
 *
 * A settings page that spins for ever tells the user nothing. If the file is
 * unreadable, that is worth knowing — and worth saying rather than hiding
 * behind an animation.
 */
export function ConfigGate({
  ready,
  loading,
  error,
  message,
  children,
}: {
  ready: boolean;
  loading: boolean;
  error?: unknown;
  message: string;
  children: React.ReactNode;
}) {
  if (ready) return <>{children}</>;
  if (loading) return <SkeletonBlock lines={4} className="rounded-xl bg-secondary/[0.2] p-4" />;
  return (
    <p className="text-sm text-destructive">
      {message} {error ? String(error) : null}
    </p>
  );
}
