import { useEffect } from "react";
import { toast } from "sonner";
import { useI18n } from "../../lib/i18n";

/**
 * Errors nothing caught, once the launcher is running, as notifications.
 *
 * <p>The boot watchdog in index.html replaces the window with a report when
 * the launcher cannot start, which is right during the boot and wrong after
 * it: a refused deletion or a failed request is one action going wrong, and
 * wiping the whole interface for it left people restarting the launcher over
 * a sentence. After the boot the watchdog hands the error here instead.
 *
 * <p>A message from the backend is already a sentence and is shown as it is;
 * a programming error (a stack trace) is not something to read, so it is
 * logged and summed up.
 */
export function RuntimeErrorBridge() {
  const { t } = useI18n();

  useEffect(() => {
    let last = "";
    let lastAt = 0;
    const onError = (event: Event) => {
      const detail = String((event as CustomEvent).detail ?? "").trim();
      // The same error repeating in a loop is one notification, not fifty.
      const now = Date.now();
      if (detail === last && now - lastAt < 4000) return;
      last = detail;
      lastAt = now;
      console.error("[Kiza] Uncaught:", detail);
      const firstLine = detail.split("\n")[0] ?? "";
      const looksLikeCode = /^(TypeError|ReferenceError|SyntaxError|RangeError|Error):|\bat\s+\S+\s+\(/.test(detail);
      toast.error(
        looksLikeCode || !firstLine
          ? t("Something went wrong. The launcher is still running; try again.")
          : firstLine,
        // In a dev build, the error itself: there is no console to read it in.
        import.meta.env.DEV && looksLikeCode ? { description: firstLine } : undefined,
      );
    };
    window.addEventListener("kiza:runtime-error", onError);
    return () => window.removeEventListener("kiza:runtime-error", onError);
  }, [t]);

  return null;
}
