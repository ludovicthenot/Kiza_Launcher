import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModsTab } from "../../src/components/instance/mods/ModsTab";

const mocks = vi.hoisted(() => ({
  deleteMod: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../src/lib/queries", () => ({
  useMods: () => ({
    data: [
      {
        id: "mod-a",
        name: "Example Mod",
        version: "1.0.0",
        description: "Test mod",
        source: null,
        author: null,
        homepage_url: null,
        cover_url: null,
        cover_path: null,
        file_size: 3,
        game_versions: ["1.21.8"],
        loaders: ["fabric"],
        updated_at: null,
        enabled: true,
        install_date: "2026-07-17T00:00:00Z",
        files: ["mods/example.jar"],
        load_order: 0,
        deployed_file_count: 2,
      },
    ],
    isLoading: false,
    error: null,
  }),
  useToggleMod: () => ({ mutate: vi.fn(), isPending: false }),
  useInstallMod: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteMod: () => ({
    mutate: mocks.deleteMod,
    isPending: false,
    variables: undefined,
  }),
  useModCompatibility: () => ({ data: undefined }),
  useOpenModFolder: () => ({ mutate: vi.fn() }),
  useRunningInstances: () => ({ data: {} }),
}));

describe("ModsTab mod deletion", () => {
  beforeEach(() => {
    mocks.deleteMod.mockReset();
  });

  it("confirms active and deployed state before invoking the backend deletion", () => {
    render(<ModsTab instanceId="instance-a" />);

    expect(screen.getByText("Deployed (2)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Example Mod" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/This mod is active and will be removed from every profile/)).toBeInTheDocument();
    expect(screen.getByText(/2 deployed files will also be removed/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete mod" }));

    expect(mocks.deleteMod).toHaveBeenCalledTimes(1);
    expect(mocks.deleteMod.mock.calls[0][0]).toEqual({
      instanceId: "instance-a",
      modId: "mod-a",
    });
    expect(mocks.deleteMod.mock.calls[0][1]).toEqual({
      onSuccess: expect.any(Function),
    });
  });
});
