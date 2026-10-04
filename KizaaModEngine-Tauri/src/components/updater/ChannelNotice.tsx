import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ArrowRight, Heart, Loader2, Sparkles } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useUpdaterStore } from "../../lib/updater";
import { Button } from "../ui/primitives";

interface Notice {
  channel: string;
  state: "open" | "retired" | "moved" | string;
  to?: string | null;
}

/** Seconds a closed channel's launcher waits before removing itself. */
const UNINSTALL_AFTER = 30;

/**
 * What the update service says about the channel this launcher follows,
 * asked once at start.
 *
 * Two things can have happened to it. It moved -- Stable is Beta now -- and
 * the launcher follows it there at once and says so, the way it announces an
 * update. Or it closed -- Alpha has -- and the launcher says thank you,
 * counts down, and removes itself, keeping the player's instances and worlds
 * for whatever they install next. Nothing is shown for an open channel or an
 * unreachable service.
 */
export function ChannelNotice() {
  const { t } = useI18n();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [left, setLeft] = useState(UNINSTALL_AFTER);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!isTauri() || started.current) return;
    started.current = true;
    void (async () => {
      const found = await invoke<Notice | null>("channel_notice").catch(() => null);
      if (!found || found.state === "open") return;
      if (found.state === "moved" && found.to) {
        await invoke("follow_channel", { channel: found.to }).catch(() => undefined);
        // The check that ran at start asked the old channel.
        void useUpdaterStore.getState().checkForUpdate();
      }
      setNotice(found);
    })();
  }, []);

  const uninstall = async () => {
    setRemoving(true);
    setError(null);
    try {
      await invoke("uninstall_launcher");
    } catch (failure) {
      setRemoving(false);
      setError(String(failure));
    }
  };

  useEffect(() => {
    if (notice?.state !== "retired" || removing || error) return;
    if (left <= 0) {
      void uninstall();
      return;
    }
    const timer = window.setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [notice, left, removing, error]);

  if (!notice) return null;

  const retired = notice.state === "retired";
  const channelName = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm animate-in fade-in-0 duration-200">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="channel-notice-title"
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-popover/95 p-7 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.08),0_30px_80px_hsl(242_30%_2%/0.7)] backdrop-blur-xl animate-in zoom-in-95 duration-200"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-80 -translate-x-1/2 rounded-full bg-primary/30 blur-3xl"
        />
        <div className="relative">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] bg-primary/15 text-primary">
            {retired ? <Heart className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
          </div>

          {retired ? (
            <>
              <h2 id="channel-notice-title" className="text-[22px] font-bold leading-tight tracking-[-0.02em]">
                {t("The Alpha is over. Thank you.")}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {t("The Alpha channel has closed. Every report, crash and idea you sent shaped what Kiza is today.")}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t("This launcher will now uninstall itself. Your instances, worlds, accounts and skins stay on this computer: install the Kiza Beta and you will find everything where you left it.")}
              </p>
              {error && <p className="mt-3 rounded-lg bg-destructive/[0.14] px-3 py-2 text-xs text-red-300">{error}</p>}
              <div className="mt-6 flex items-center justify-between gap-3">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {removing
                    ? t("Uninstalling...")
                    : error
                      ? ""
                      : t("Uninstalling in {seconds} s").replace("{seconds}", String(left))}
                </span>
                <Button variant="primary" onClick={() => void uninstall()} disabled={removing}>
                  {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("Uninstall now")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 id="channel-notice-title" className="text-[22px] font-bold leading-tight tracking-[-0.02em]">
                {t("{from} is now {to}")
                  .replace("{from}", `Kiza ${channelName(notice.channel)}`)
                  .replace("{to}", `Kiza ${channelName(notice.to ?? "beta")}`)}
              </h2>
              <div className="mt-3 flex items-center gap-2 text-sm font-medium">
                <span className="rounded-full bg-secondary/60 px-2.5 py-1">{channelName(notice.channel)}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="rounded-full bg-primary/15 px-2.5 py-1 text-primary">{channelName(notice.to ?? "beta")}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {t("Your launcher now follows the Beta channel. Nothing to reinstall: updates keep coming here, a little earlier than before, and your instances and worlds are untouched.")}
              </p>
              <div className="mt-6 flex justify-end">
                <Button variant="primary" onClick={() => setNotice(null)}>
                  {t("Got it")}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
