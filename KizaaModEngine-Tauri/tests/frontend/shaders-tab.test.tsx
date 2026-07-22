import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShadersTab } from "../../src/components/instance/shaders/ShadersTab";
import type { GameInstanceSummary, MinecraftLoader } from "../../src/lib/types";

const mocks = vi.hoisted(() => ({
  shaderSearch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../src/lib/queries", () => ({
  useShaderpacks: () => ({ data: [], isLoading: false }),
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
    mocks.shaderSearch.mockClear();
  });

  it("keeps Forge in installed-only management without offering shader discovery", () => {
    render(<ShadersTab instance={instance("forge")} mode="installed" />);

    expect(screen.getByText("No compatible shader engine available")).toBeInTheDocument();
    expect(screen.getByText(/Minecraft 1.21.5 with Forge 55.1.11/)).toBeInTheDocument();
    expect(screen.queryByText(/Iris/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Install Iris/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search Modrinth shaders/i)).not.toBeInTheDocument();
  });

  it("manages Fabric shader files without duplicating Search content", () => {
    render(<ShadersTab instance={instance("fabric")} mode="installed" />);

    expect(screen.queryByText("No compatible shader engine available")).not.toBeInTheDocument();
    expect(screen.getByText(/loaded by Iris/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search Modrinth shaders/i)).not.toBeInTheDocument();
  });
});
