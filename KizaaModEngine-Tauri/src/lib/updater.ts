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
  checkForUpdate: () => Promise<void>;
  checkForUpdateOnStartup: () => Promise<boolean>;
  downloadUpdate: () => Promise<void>;
  postponeInstallation: () => void;
  installUpdate: () => Promise<void>;
  retry: () => Promise<void>;
}

const EMPTY_PROGRESS: UpdaterProgress = {
  downloadedBytes: 0,
  totalBytes: null,
};

const isBusy = (phase: UpdaterPhase) =>
  phase === "checking" || phase === "downloading" || phase === "installing";

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

  checkForUpdate: async () => {
    if (isBusy(get().phase)) return;

    set({ phase: "checking", error: null, failedAction: null });
    try {
      const nextUpdate = await check({ timeout: 30_000 });
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
