import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mocks.relaunch,
}));

import { useUpdaterStore } from "../../src/lib/updater";

function resetStore() {
  useUpdaterStore.setState({
    phase: "idle",
    startupCheckStarted: false,
    update: null,
    version: null,
    notes: null,
    progress: { downloadedBytes: 0, totalBytes: null },
    error: null,
    failedAction: null,
    notifiedVersion: null,
  });
}

function createUpdate() {
  const update = {
    version: "0.0.225",
    body: "Updater test release",
    close: vi.fn().mockResolvedValue(undefined),
    download: vi.fn(async (onEvent?: (event: DownloadEvent) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 60 } });
      onEvent?.({ event: "Finished" });
    }),
    install: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn(),
  } as unknown as Update;

  return update;
}

describe("updater store", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("reports when no update is available", async () => {
    mocks.check.mockResolvedValue(null);

    await useUpdaterStore.getState().checkForUpdate();

    expect(useUpdaterStore.getState().phase).toBe("unavailable");
    expect(useUpdaterStore.getState().update).toBeNull();
  });

  it("deduplicates the silent startup check", async () => {
    mocks.check.mockResolvedValue(null);

    const first = useUpdaterStore.getState().checkForUpdateOnStartup();
    const second = useUpdaterStore.getState().checkForUpdateOnStartup();

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(useUpdaterStore.getState().phase).toBe("unavailable");
  });

  it("downloads first, keeps the update ready, then installs only after confirmation", async () => {
    const update = createUpdate();
    mocks.check.mockResolvedValue(update);
    mocks.relaunch.mockResolvedValue(undefined);

    await useUpdaterStore.getState().checkForUpdate();
    expect(useUpdaterStore.getState().phase).toBe("available");

    await useUpdaterStore.getState().downloadUpdate();
    expect(update.download).toHaveBeenCalledOnce();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().phase).toBe("ready");
    expect(useUpdaterStore.getState().progress).toEqual({ downloadedBytes: 100, totalBytes: 100 });

    useUpdaterStore.getState().postponeInstallation();
    expect(useUpdaterStore.getState().phase).toBe("deferred");
    expect(useUpdaterStore.getState().update).toBe(update);
    expect(update.install).not.toHaveBeenCalled();

    await useUpdaterStore.getState().installUpdate();
    expect(update.install).toHaveBeenCalledOnce();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("announces a version once, however many times it is checked", async () => {
    const update = createUpdate();
    mocks.check.mockResolvedValue(update);

    await useUpdaterStore.getState().checkForUpdate();

    expect(useUpdaterStore.getState().takeAnnouncement()).toBe("0.0.225");
    // A toast every five minutes for the same release is an annoyance, not a
    // notification.
    expect(useUpdaterStore.getState().takeAnnouncement()).toBeNull();
  });

  it("does not re-check once an update is downloaded and waiting", async () => {
    const update = createUpdate();
    mocks.check.mockResolvedValue(update);

    await useUpdaterStore.getState().checkForUpdate();
    await useUpdaterStore.getState().downloadUpdate();
    expect(useUpdaterStore.getState().phase).toBe("ready");
    mocks.check.mockClear();

    await useUpdaterStore.getState().checkInBackground();

    // Replacing it would throw away a download the user is one click from
    // installing.
    expect(mocks.check).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().phase).toBe("ready");
  });

  it("stays quiet when a background check fails", async () => {
    mocks.check.mockResolvedValue(null);
    await useUpdaterStore.getState().checkForUpdate();
    expect(useUpdaterStore.getState().phase).toBe("unavailable");

    mocks.check.mockRejectedValueOnce(new Error("offline"));
    await useUpdaterStore.getState().checkInBackground();

    // A minute offline is not news, and turning the panel red every five
    // minutes would be.
    expect(useUpdaterStore.getState().phase).toBe("unavailable");
    expect(useUpdaterStore.getState().error).toBeNull();
  });

  it("still reports a failure the user asked for", async () => {
    mocks.check.mockRejectedValueOnce(new Error("offline"));

    await useUpdaterStore.getState().checkForUpdate();

    // A check the user started is a question that deserves an answer.
    expect(useUpdaterStore.getState().phase).toBe("error");
    expect(useUpdaterStore.getState().failedAction).toBe("check");
  });

  it("finds a release published while the launcher was open", async () => {
    mocks.check.mockResolvedValue(null);
    await useUpdaterStore.getState().checkForUpdateOnStartup();
    expect(useUpdaterStore.getState().phase).toBe("unavailable");

    mocks.check.mockResolvedValue(createUpdate());
    await useUpdaterStore.getState().checkInBackground();

    expect(useUpdaterStore.getState().phase).toBe("available");
    expect(useUpdaterStore.getState().takeAnnouncement()).toBe("0.0.225");
  });

  it("keeps a failed download retryable without installing it", async () => {
    const update = createUpdate();
    vi.mocked(update.download).mockRejectedValueOnce(new Error("offline"));
    mocks.check.mockResolvedValue(update);

    await useUpdaterStore.getState().checkForUpdate();
    await useUpdaterStore.getState().downloadUpdate();

    expect(useUpdaterStore.getState().phase).toBe("error");
    expect(useUpdaterStore.getState().failedAction).toBe("download");
    expect(update.install).not.toHaveBeenCalled();

    await useUpdaterStore.getState().retry();
    expect(update.download).toHaveBeenCalledTimes(2);
    expect(useUpdaterStore.getState().phase).toBe("ready");
  });
});
