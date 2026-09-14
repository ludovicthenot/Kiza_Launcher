import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { useAppStore } from "../../lib/store";
import { useUpdaterStore } from "../../lib/updater";

/**
 * What the tray menu chose, carried out by the launcher's own page.
 *
 * The menu is another window and cannot reach this one's state; it tells
 * the backend, the backend shows this window and forwards the choice here.
 */
export function TrayBridge() {
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<{ action: string; id: string | null }>("kiza://tray", (event) => {
      const store = useAppStore.getState();
      switch (event.payload.action) {
        case "settings":
          store.setShowSettings(true);
          break;
        case "updates":
          store.setShowSettings(true, "system");
          void useUpdaterStore.getState().checkForUpdate();
          break;
        case "host":
          store.setSelectedInstanceId(null);
          store.setLibraryMode("host");
          break;
        case "instance":
          if (event.payload.id) store.setSelectedInstanceId(event.payload.id);
          break;
        default:
          break;
      }
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);
  return null;
}
