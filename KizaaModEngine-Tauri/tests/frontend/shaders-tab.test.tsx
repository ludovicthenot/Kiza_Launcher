import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShadersTab } from "../../src/components/instance/shaders/ShadersTab";
import type { GameInstanceSummary, MinecraftLoader } from "../../src/lib/types";

const mocks = vi.hoisted(() => ({
  irisStatus: vi.fn(),
  installIris: vi.fn(),
  shaderSearch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../src/lib/queries", () => ({
  useShaderpacks: () => ({ data: [], isLoading: false }),
  useIrisStatus: (instanceId: string | null) => {
    mocks.irisStatus(instanceId);
    return { data: false };
  },
  useInstallIris: () => ({ mutate: mocks.installIris, isPending: false }),
  useDeleteShaderpack: () => ({ mutate: vi.fn(), isPending: false }),
  useImportShaderpack: () => ({ mutate: vi.fn(), isPending: false }),
  useOpenShaderpacksFolder: () => ({ mutate: vi.fn(), isPending: false }),
  useShaderSearch: () => ({ mutate: mocks.shaderSearch, isPending: false, data: undefined }),
  useInstallShaderpack: () => ({ mutate: vi.fn(), isPending: false }),
}));

function instance(loader: MinecraftLoader): GameInstanceSummary {
  return {
    schema_version: 1,
    id: `${loader}-instance`,
    game_id: "minecraft",
    display_name: `${loader} test`,
    install_path: "C:\\Minecraft",
    executable_path: "",
    mods_path: "",
    detected_variant: null,
    minecraft: {
      mc_version: "1.21.5",
      loader,
      loader_version: loader === "forge" ? "55.1.11" : "0.16.14",
    },
    status: "Valid",
    created_at: "2026-07-17T00:00:00Z",
    last_verified_at: null,
    active_profile_id: null,
    mod_count: 0,
    active_mod_count: 0,
    last_deployed_at: null,
  };
}

describe("ShadersTab loader support", () => {
  beforeEach(() => {
    mocks.irisStatus.mockClear();
    mocks.installIris.mockClear();
    mocks.shaderSearch.mockClear();
  });

  it("never offers Iris or Modrinth shader installation on Forge", () => {
    render(<ShadersTab instance={instance("forge")} />);

    expect(screen.getByText("No compatible shader engine available")).toBeInTheDocument();
    expect(screen.getAllByText(/Minecraft 1.21.5 with Forge 55.1.11/)).toHaveLength(2);
    expect(screen.queryByText(/Iris/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Install Iris/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search Modrinth shaders/i)).not.toBeInTheDocument();
    expect(mocks.irisStatus).toHaveBeenCalledWith(null);
  });

  it("keeps the Iris installation workflow on Fabric", () => {
    render(<ShadersTab instance={instance("fabric")} />);

    expect(screen.getByText("Iris is not installed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install Iris" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search Modrinth shaders/i)).toBeInTheDocument();
    expect(mocks.irisStatus).toHaveBeenCalledWith("fabric-instance");
  });
});
