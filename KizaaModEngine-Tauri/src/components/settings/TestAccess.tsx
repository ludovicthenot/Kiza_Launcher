/**
 * Connecting Discord, so a test build can update itself.
 *
 * Stable needs none of this. Beta and Experimental are tests, and the update
 * service will not hand one over to a launcher that cannot show it is meant to
 * have it — so somebody following a test channel signs in once here and the
 * launcher carries the result for a month.
 *
 * The panel deliberately shows only what a person can act on: which account is
 * connected, what it opens, when it stops. It does not decide anything. The
 * launcher cannot grant itself access and this page cannot either; both would
 * be lying to whoever is reading it, since the answer is given by the service
 * on every request.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { KeyRound, Loader2, LogIn, LogOut } from "lucide-react";
import { Row, Section } from "./controls";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

interface Status {
  connected: boolean;
  channels: string[];
  expires: string | null;
  account: string | null;
  has_setup_key: boolean;
}

export function TestAccess() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    invoke<Status>("access_status")
      .then(setStatus)
      .catch(() => setStatus(null));

  useEffect(() => {
    void refresh();
  }, []);

  /**
   * The browser comes back through a `kiza://` link, which the launcher turns
   * into this event. Claiming happens here rather than in the deep-link
   * handler so the page that shows the result is the page that asked for it.
   */
  useEffect(() => {
    const unlisten = listen<{ code: string; state: string }>("kiza://access-code", (event) => {
      setBusy(true);
      invoke<Status>("access_claim", event.payload)
        .then((next) => {
          setStatus(next);
          toast.success(t("Connected. This launcher can now receive test builds."));
        })
        .catch((error) => toast.error(String(error)))
        .finally(() => setBusy(false));
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [t]);

  const connect = () => {
    setBusy(true);
    invoke("access_begin")
      .then(() => toast.info(t("Finish signing in with Discord in your browser.")))
      .catch((error) => toast.error(String(error)))
      .finally(() => setBusy(false));
  };

  const disconnect = () => {
    invoke<Status>("access_disconnect")
      .then(setStatus)
      .catch((error) => toast.error(String(error)));
  };

  if (!status) return null;

  const expires = status.expires ? new Date(status.expires) : null;
  const running = expires ? expires.getTime() < Date.now() : false;

  return (
    <Section
      icon={KeyRound}
      title={t("Test builds")}
      hint={t("Beta and Experimental are handed out by invitation. Stable needs nothing here.")}
    >
      <Row
        label={status.connected ? t("Discord connected") : t("Not connected")}
        hint={
          status.connected
            ? running
              ? t("Access has run out. Connect again to keep receiving test builds.")
              : [
                  status.channels.length > 0
                    ? `${t("Opens")}: ${status.channels.join(", ")}`
                    : t("This account is not on a test list."),
                  expires ? `${t("Until")} ${expires.toLocaleDateString()}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
            : t("Sign in with Discord to receive the channel you were invited to.")
        }
      >
        <div className="flex items-center gap-2">
          {status.connected && (
            <button
              type="button"
              onClick={disconnect}
              className="kiza-button inline-flex h-9 items-center gap-2 border px-3 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t("Disconnect")}
            </button>
          )}
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className={cn(
              "kiza-action inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold text-primary-foreground transition",
              busy && "opacity-60",
            )}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogIn className="h-3.5 w-3.5" />
            )}
            {status.connected ? t("Connect again") : t("Connect Discord")}
          </button>
        </div>
      </Row>

      {/* Only where it is true, and stated rather than acted on: a Maker
          install opens its channel with the key its Setup left behind, and
          there is nothing for a person to do about it either way. */}
      {status.has_setup_key && (
        <Row
          label={t("Maker key")}
          hint={t("This install carries the key from its Setup, which is what opens the Maker channel.")}
        />
      )}
    </Section>
  );
}
