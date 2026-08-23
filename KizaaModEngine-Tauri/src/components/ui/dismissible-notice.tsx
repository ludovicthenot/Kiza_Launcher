import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";

const STORAGE_PREFIX = "kiza.notice.";

/**
 * A notice the user can close for good.
 *
 * The dismissal is keyed by `signature`, so closing it hides *this* message
 * only: if the underlying situation changes — a new warning appears, a problem
 * is fixed — the signature changes and the notice comes back. That keeps the
 * choice with the user without ever hiding new information from them.
 */
export function DismissibleNotice({
  signature,
  className,
  children,
}: {
  signature: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const storageKey = STORAGE_PREFIX + signature;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === "1");
    } catch {
      // Private mode or blocked storage: keep the notice visible.
      setDismissed(false);
    }
  }, [storageKey]);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      // Not persisting is acceptable; it stays hidden for this session.
    }
  };

  return (
    <div className={cn("relative", className)}>
      <div className="pr-8">{children}</div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("Dismiss this message")}
        title={t("Dismiss this message")}
        className={cn(
          "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md",
          "text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
