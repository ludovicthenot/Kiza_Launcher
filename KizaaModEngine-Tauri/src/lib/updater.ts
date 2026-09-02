import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "unavailable"
  | "available"
  | "downloading"
  | "ready"
  | "deferred"
  | "installing"
  | "error";

type FailedUpdaterAction = "check" | "download" | "install";

interface UpdaterProgress {
  downloadedBytes: number;
  totalBytes: number | null;
}

interface UpdaterState {
  phase: UpdaterPhase;
  startupCheckStarted: boolean;
  update: Update | null;
  version: string | null;
  notes: string | null;
  progress: UpdaterProgress;
  error: string | null;
  failedAction: FailedUpdaterAction | null;
  /** The version the user has already been told about. */
  notifiedVersion: string | null;
  checkForUpdate: () => Promise<void>;
  checkForUpdateOnStartup: () => Promise<boolean>;
  checkInBackground: () => Promise<void>;
  takeAnnouncement: () => string | null;
  downloadUpdate: () => Promise<void>;
  postponeInstallation: () => void;
  installUpdate: () => Promise<void>;
  retry: () => Promise<void>;
}

/**
 * How often the launcher looks for a new release while it is open.
 *
 * A release is a small signed JSON file, so this costs almost nothing, and it
 * is what makes a launcher left open all evening notice an update at all.
 */
export const BACKGROUND_CHECK_INTERVAL_MS = 5 * 60_000;

const EMPTY_PROGRESS: UpdaterProgress = {
  downloadedBytes: 0,
  totalBytes: null,
};

const isBusy = (phase: UpdaterPhase) =>
  phase === "checking" || phase === "downloading" || phase === "installing";

/**
 * Tells the update service which channel this launcher follows.
 *
 * Sent as a header rather than baked into the endpoint, because the endpoint is
 * compiled into the binary and the channel is a setting someone can change
 * tonight. A launcher built in January has to be able to move to the beta
 * channel without being rebuilt.
 *
 * Read from the configuration file at each check rather than cached: switching
 * channel should take effect on the next check, not on the next launch.
 */
async function channelHeaders(): Promise<Record<string, string>> {
  // What proves this launcher may have a test build, when it has any. The
  // service refuses a gated channel without it, which is the point: a build
  // nobody is entitled to must be a file the service will not serve, not a
  // button the interface hides.
  const proof: Record<string, string> = {};
  try {
    for (const [name, value] of await invoke<[string, string][]>("access_headers")) {
      proof[name] = value;
    }
  } catch {
    // An older backend, or no access at all. The channel header below still
    // goes, and the service answers what it answers.
  }

  try {
    const config = await invoke<{ update_channel?: string }>("get_app_config");
    const channel = config?.update_channel?.trim().toLowerCase();
    // The service falls back to stable for anything it does not recognise, so
    // an unreadable setting is not worth failing a check over.
    return channel ? { ...proof, "X-Kiza-Channel": channel } : proof;
  } catch {
    // An unreadable setting is not a reason to drop the proof: the channel
    // falls back to stable at the service, and a launcher that could update
    // yesterday can still update today.
    return proof;
  }
}

async function closeUpdate(update: Update | null) {
  if (!update) return;
  await update.close().catch(() => undefined);
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  phase: "idle",
  startupCheckStarted: false,
  update: null,
  version: null,
  notes: null,
  progress: EMPTY_PROGRESS,
  error: null,
  failedAction: null,
  notifiedVersion: null,

  checkForUpdate: async () => {
    if (isBusy(get().phase)) return;

    set({ phase: "checking", error: null, failedAction: null });
    try {
      const nextUpdate = await check({ timeout: 30_000, headers: await channelHeaders() });
      const previousUpdate = get().update;

      if (previousUpdate !== nextUpdate) {
        await closeUpdate(previousUpdate);
      }

      if (!nextUpdate) {
        set({
          phase: "unavailable",
          update: null,
          version: null,
          notes: null,
          progress: EMPTY_PROGRESS,
        });
        return;
      }

      set({
        phase: "available",
        update: nextUpdate,
        version: nextUpdate.version,
        notes: nextUpdate.body ?? null,
        progress: EMPTY_PROGRESS,
      });
    } catch (error) {
      set({
        phase: "error",
        error: `Update check failed: ${String(error)}`,
        failedAction: "check",
      });
    }
  },

  checkForUpdateOnStartup: async () => {
    if (get().startupCheckStarted) return false;
    set({ startupCheckStarted: true });
    await get().checkForUpdate();
    return true;
  },

  /**
   * The recurring check, run on a timer while the launcher is open.
   *
   * It stays out of the way of everything the user is doing: it never
   * interrupts a check, download or installation in progress, and it never
   * re-checks once an update has been found — replacing an update that is
   * already downloaded and waiting would throw that download away.
   *
   * It is also silent about failure. A check that fails because the machine is
   * offline for a minute is not news, and turning the panel red every five
   * minutes would be.
   */
  checkInBackground: async () => {
    const { phase } = get();
    if (isBusy(phase)) return;
    if (phase === "available" || phase === "ready" || phase === "deferred") return;

    const previousPhase = phase;
    await get().checkForUpdate();
    if (get().phase === "error") {
      set({ phase: previousPhase, error: null, failedAction: null });
    }
  },

  /**
   * The version worth telling the user about, once.
   *
   * Announcing the same release on every tick would be an annoyance rather than
   * a notification, so a version is only ever returned the first time.
   */
  takeAnnouncement: () => {
    const { phase, version, notifiedVersion } = get();
    if (phase !== "available" || !version || version === notifiedVersion) return null;
    set({ notifiedVersion: version });
    return version;
  },

  downloadUpdate: async () => {
    const update = get().update;
    if (!update || isBusy(get().phase)) return;

    let downloadedBytes = 0;
    let totalBytes: number | null = null;
    set({
      phase: "downloading",
      progress: EMPTY_PROGRESS,
      error: null,
      failedAction: null,
    });

    try {
      await update.download((event: DownloadEvent) => {
        if (get().update !== update) return;

        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? null;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
        }

        set({
          progress: { downloadedBytes, totalBytes },
        });
      });

      if (get().update === update) {
        set({
          phase: "ready",
          progress: { downloadedBytes, totalBytes },
        });
      }
    } catch (error) {
      set({
        phase: "error",
        error: `Update download failed: ${String(error)}`,
        failedAction: "download",
      });
    }
  },

  postponeInstallation: () => {
    if (get().phase === "ready") {
      set({ phase: "deferred" });
    }
  },

  installUpdate: async () => {
    const { update, phase, failedAction } = get();
    const canInstall = phase === "ready" || phase === "deferred" || (phase === "error" && failedAction === "install");
    if (!update || !canInstall) return;

    set({ phase: "installing", error: null, failedAction: null });
    try {
      await update.install();
      // Windows exits during install; relaunch is the fallback for platforms
      // where the installer returns control to the application.
      await relaunch();
    } catch (error) {
      set({
        phase: "error",
        error: `Update installation failed: ${String(error)}`,
        failedAction: "install",
      });
    }
  },

  retry: async () => {
    const failedAction = get().failedAction;
    if (failedAction === "download") {
      await get().downloadUpdate();
    } else if (failedAction === "install") {
      await get().installUpdate();
    } else {
      await get().checkForUpdate();
    }
  },
}));
