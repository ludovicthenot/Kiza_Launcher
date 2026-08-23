import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorldVaultPanel } from "../../src/components/instance/WorldVaultPanel";
import { I18nProvider } from "../../src/lib/i18n";

const mocks = vi.hoisted(() => ({
  worlds: { value: [] as unknown[] },
  checkpoints: { value: [] as unknown[] },
  backup: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../src/lib/queries", () => ({
  useWorlds: () => ({ data: mocks.worlds.value, isLoading: false }),
  useWorldCheckpoints: () => ({ data: mocks.checkpoints.value }),
  useBackupWorld: () => ({ mutate: mocks.backup, isPending: false }),
  useRestoreWorld: () => ({ mutate: mocks.restore, isPending: false }),
  useDeleteWorldCheckpoint: () => ({ mutate: mocks.remove, isPending: false }),
  // Read by `useRegionFormats`, which decides how the "last played" date and
  // the backup timestamps are written. Undefined means "follow the machine",
  // which is what these tests want.
  useAppConfig: () => ({ data: undefined }),
}));

const SURVIE = {
  folder: "New World",
  display_name: "Survie de Nefer",
  size_bytes: 512 * 1024 * 1024,
  file_count: 340,
  last_played_ms: 1770000000000,
  version_name: "1.21.1",
  hardcore: false,
  icon: null,
  checkpoint_count: 1,
};

const BACKUP = {
  id: "checkpoint-1",
  instance_id: "instance-a",
  folder: "New World",
  display_name: "Survie de Nefer",
  created_at: "2026-02-01T10:00:00Z",
  reason: "Manual backup",
  total_bytes: 1024,
  entries: [{ path: "region/r.0.0.mca", sha256: "aaa", size: 1024 }],
};

function renderPanel(isRunning = false) {
  return render(
    <I18nProvider>
      <WorldVaultPanel instanceId="instance-a" isRunning={isRunning} />
    </I18nProvider>,
  );
}

describe("WorldVaultPanel", () => {
  beforeEach(() => {
    mocks.backup.mockReset();
    mocks.restore.mockReset();
    mocks.remove.mockReset();
    mocks.worlds.value = [SURVIE];
    mocks.checkpoints.value = [BACKUP];
  });

  it("names a world the way the player named it, not the way the folder is named", () => {
    renderPanel();

    expect(screen.getByText("Survie de Nefer")).toBeInTheDocument();
    // The folder keeps the name the world had the day it was created, so it is
    // shown as an aside rather than as the world's name.
    expect(screen.getByText("New World")).toBeInTheDocument();
  });

  it("refuses to back up while the game is running", () => {
    renderPanel(true);

    const button = screen.getByRole("button", { name: /Back up/i });
    // A world copied mid-save restores as a damaged world, so the button says
    // so instead of failing after the click.
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mocks.backup).not.toHaveBeenCalled();
  });

  it("backs the world up under its folder, not its display name", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Back up/i }));
    // The backend addresses worlds by directory; passing the display name would
    // look for a world that is not there.
    expect(mocks.backup).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: "instance-a", folder: "New World" }),
    );
  });

  it("asks before restoring, because restoring loses what came after", () => {
    renderPanel();

    fireEvent.click(screen.getByTitle(/Show the backups of this world/i));
    fireEvent.click(screen.getByRole("button", { name: /Restore/i }));

    // Nothing has happened yet: the confirmation is the point.
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(screen.getByText(/Everything built, mined or explored since then is lost/i))
      .toBeInTheDocument();
  });

  it("says there is nothing to show rather than showing an empty list", () => {
    mocks.worlds.value = [];
    renderPanel();

    expect(screen.getByText(/No world yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back up/i })).not.toBeInTheDocument();
  });
});
