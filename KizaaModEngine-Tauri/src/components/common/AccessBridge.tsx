/**
 * Catches the answer to a Discord sign-in, wherever the launcher happens to be.
 *
 * The browser sends the result back as a `kiza://` link, and it can arrive at
 * any moment — while somebody is on the settings page that started it, or
 * three pages away, or after the window was minimised for two minutes. So the
 * listener lives here, mounted for the life of the launcher, rather than on
 * whichever page happened to ask.
 *
 * It also finishes what the sign-in was for. Somebody who chose Alpha and was
 * sent to Discord wanted the alpha, not a dialogue telling them they may now
 * choose it: coming back with a pass that opens it switches the channel and
 * looks for an update.
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useAccess } from "../../lib/access";
import { useUpdaterStore } from "../../lib/updater";
import { useI18n } from "../../lib/i18n";

export function AccessBridge() {
  const { t } = useI18n();

  useEffect(() => {
    if (!isTauri()) return;
    void useAccess.getState().refresh();

    const unlisten = listen<{ code: string; state: string }>(
      "kiza://access-code",
      async (event) => {
        try {
          const status = await useAccess.getState().claim(event.payload.code, event.payload.state);
          const wanted = useAccess.getState().takeWanted();

          if (wanted && status.channels.includes(wanted)) {
            // Read, changed, written back whole: the configuration is saved as
            // one object, and sending a single field would blank the rest.
            const config = await invoke<Record<string, unknown>>("get_app_config");
            await invoke("save_app_config", {
              config: { ...config, update_channel: wanted },
            });
            await useUpdaterStore.getState().checkForUpdate();
            toast.success(
              `${t("Connected. You are on the")} ${wanted} ${t("channel now.")}`,
            );
            return;
          }

          if (wanted) {
            // Signed in correctly, and not on that list. Said plainly: the
            // person did nothing wrong and there is nothing for them to fix
            // here — somebody has to add them.
            toast.error(
              `${t("Connected, but this account is not on the")} ${wanted} ${t("list yet.")}`,
            );
            return;
          }

          toast.success(
            status.channels.length > 0
              ? `${t("Connected")} — ${status.channels.join(", ")}`
              : t("Connected. This account is not on a test list yet."),
          );
        } catch (error) {
          toast.error(String(error));
        }
      },
    );

    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [t]);

  return null;
}
