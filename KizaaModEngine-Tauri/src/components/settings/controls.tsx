import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

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
    <div className="flex flex-wrap items-center justify-between gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
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
        "relative h-6 w-11 rounded-full transition disabled:opacity-60",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-1 h-4 w-4 rounded-full bg-white transition-all",
          checked ? "left-6" : "left-1",
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
    <section>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </h3>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-secondary/10 px-4">
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
        "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition disabled:opacity-60",
        tone === "destructive"
          ? "border-destructive/40 bg-destructive/10 text-destructive hover:border-destructive/60"
          : "border-border/70 bg-secondary/30 hover:border-primary/40",
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
  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
  return (
    <p className="text-sm text-destructive">
      {message} {error ? String(error) : null}
    </p>
  );
}
