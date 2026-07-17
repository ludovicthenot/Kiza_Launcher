import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MinecraftInstallExperience,
  MinecraftPlayButton,
} from "../../src/components/instance/MinecraftInstallExperience";
import type { MinecraftInstallStatus } from "../../src/lib/queries";

function installStatus(overrides: Partial<MinecraftInstallStatus> = {}): MinecraftInstallStatus {
  return {
    stage: "idle",
    completed: 0,
    total: 0,
    overall_completed: 0,
    overall_total: 8,
    bytes_downloaded: 0,
    bytes_total: null,
    current_item: null,
    current_category: null,
    message: null,
    ready: false,
    ...overrides,
  };
}

describe("Minecraft installation experience", () => {
  it("shows human labels, real counters, bytes, and both progress levels", () => {
    render(
      <MinecraftInstallExperience
        status={installStatus({
          stage: "downloading_assets",
          completed: 25,
          total: 100,
          overall_completed: 4,
          bytes_downloaded: 12 * 1024 ** 2,
          bytes_total: 48 * 1024 ** 2,
          current_category: "Game assets",
          current_item: "minecraft/sounds/random/click.ogg",
        })}
        loaderLabel="Fabric 0.16.10"
        isActionPending={false}
        onInstallOrRepair={vi.fn()}
      />,
    );

    expect(screen.getByText("Downloading game assets")).toBeInTheDocument();
    expect(screen.getByText("25 / 100 files")).toBeInTheDocument();
    expect(screen.getByText("12.0 MB / 48.0 MB")).toBeInTheDocument();
    expect(screen.getByText("minecraft/sounds/random/click.ogg")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Overall progress" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("progressbar", { name: "Current step" })).toHaveAttribute("aria-valuenow", "25");
  });

  it("keeps a stage indeterminate when no real total exists", () => {
    render(
      <MinecraftInstallExperience
        status={installStatus({
          stage: "preparing",
          current_category: "Version manifest",
          current_item: "Minecraft 1.21.8",
        })}
        loaderLabel="Vanilla"
        isActionPending={false}
        onInstallOrRepair={vi.fn()}
      />,
    );

    expect(screen.getByText("Waiting for a real total")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Current step" })).not.toHaveAttribute("aria-valuenow");
  });

  it("keeps Play locked until the backend reports done and ready", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <MinecraftPlayButton
        status={installStatus({ stage: "error", message: "Incomplete" })}
        isLaunching={false}
        isRunning={false}
        isInstanceValid
        onClick={onClick}
      />,
    );

    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();

    rerender(
      <MinecraftPlayButton
        status={installStatus({ stage: "done", ready: false })}
        isLaunching={false}
        isRunning={false}
        isInstanceValid
        onClick={onClick}
      />,
    );
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();

    rerender(
      <MinecraftPlayButton
        status={installStatus({ stage: "done", ready: true })}
        isLaunching={false}
        isRunning={false}
        isInstanceValid
        onClick={onClick}
      />,
    );
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
  });

  it("surfaces a repair action and the backend installation error", () => {
    render(
      <MinecraftInstallExperience
        status={installStatus({
          stage: "error",
          message: "The Forge profile is incomplete.",
        })}
        loaderLabel="Forge 47.4.21"
        isActionPending={false}
        onInstallOrRepair={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("The Forge profile is incomplete.");
    expect(screen.getByRole("button", { name: "Retry / Repair" })).toBeEnabled();
  });
});
