/**
 * The door in front of a test build.
 *
 * A launcher that follows an invited channel shows this and nothing else until
 * the person at the keyboard has connected a Discord account that is on the
 * list. Not the library, not the settings, not a way round to them: somebody
 * who was never invited should meet one screen, and that screen should tell
 * them what to do about it.
 *
 * Be clear about what this is. It is a door, not a vault. It runs on the
 * tester's own computer, and anything that runs there can be taken apart by
 * somebody determined enough. The thing that cannot be taken apart is on the
 * other side: the service hands out no build to a launcher with no claim on
 * it, so what a patched door opens is a copy of what they already have — never
 * the next one, and never anything anybody else is running.
 *
 * A public build never sees this. The gate is decided by the channel the
 * launcher follows, so Stable renders exactly as it always has.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { doorShut, useAccess } from "../../lib/access";
import { useI18n } from "../../lib/i18n";

export function AccessGate({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const status = useAccess((state) => state.status);
  const channel = useAccess((state) => state.channel);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void useAccess.getState().resolveChannel();
    void useAccess.getState().refresh();
  }, []);

  const shut = doorShut(status, channel);

  // Nothing at all until the answer is in. A launcher that showed its library
  // for one frame and then covered it would have shown it.
  if (shut === null) return null;
  if (!shut) return <>{children}</>;

  const connect = () => {
    setBusy(true);
    invoke("access_begin")
      .then(() => toast.info(t("Finish signing in with Discord in your browser.")))
      .catch((error) => toast.error(String(error)))
      .finally(() => setBusy(false));
  };

  const known = status?.connected === true;

  return (
    <div className="flex flex-1 items-center justify-center px-8">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
          <ShieldCheck className="h-7 w-7" />
        </div>

        <h1 className="text-2xl font-bold tracking-tight">
          {t("This build is by invitation")}
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {known
            ? t(
                "You are signed in, but this account is not on the list for this build yet. Open a ticket on Discord and someone will add you.",
              )
            : t(
                "Connect the Discord account you were invited with. Kiza reads who you are and nothing else.",
              )}
        </p>

        <button
          type="button"
          onClick={connect}
          disabled={busy}
          className="kiza-action mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-primary-foreground transition disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {known ? t("Try another account") : t("Connect Discord")}
        </button>

        {/* Said plainly rather than hidden: somebody who cannot get in should
            know why, and that closing the window is a thing they may do. */}
        <p className="mt-5 text-xs text-muted-foreground/70">
          {t("Nothing else is available until then.")}
        </p>
      </div>
    </div>
  );
}
