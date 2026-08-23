import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SafeModePanel } from "../../src/components/instance/SafeModePanel";
import { I18nProvider } from "../../src/lib/i18n";

const mocks = vi.hoisted(() => ({
  state: { value: null as unknown },
  record: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../src/lib/queries", () => ({
  useSafeModeStatus: () => ({ data: mocks.state.value, isLoading: false }),
  useSafeModeStart: () => ({ mutate: mocks.start, isPending: false }),
  useSafeModeRecord: () => ({ mutate: mocks.record, isPending: false }),
  useSafeModeStop: () => ({ mutate: mocks.stop, isPending: false }),
  useMods: () => ({
    data: [
      { id: "mod-a", name: "Sodium" },
      { id: "mod-b", name: "Iris Shaders" },
    ],
  }),
}));

function renderPanel() {
  return render(
    <I18nProvider>
      <SafeModePanel instanceId="instance-a" />
    </I18nProvider>,
  );
}

describe("SafeModePanel", () => {
  beforeEach(() => {
    mocks.record.mockReset();
    mocks.start.mockReset();
    mocks.stop.mockReset();
  });

  it("offers to start a hunt when none is running", () => {
    mocks.state.value = null;
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Find the broken mod/i }));
    expect(mocks.start).toHaveBeenCalledWith({ instanceId: "instance-a" });
  });

  it("asks for the baseline launch with every mod off", () => {
    mocks.state.value = {
      step: { kind: "test_vanilla" },
      runs: 0,
      enabled: [],
      totalCandidates: 2,
    };
    renderPanel();

    expect(screen.getByText(/Every mod is off/i)).toBeInTheDocument();
    // Reporting a crash must reach the backend as a crash, not the opposite.
    fireEvent.click(screen.getByRole("button", { name: /It crashed/i }));
    expect(mocks.record).toHaveBeenCalledWith({ instanceId: "instance-a", crashed: true });
  });

  it("names the mods under test by their real name", () => {
    mocks.state.value = {
      step: { kind: "test_subset", value: ["mod-a"] },
      runs: 1,
      enabled: ["mod-a"],
      totalCandidates: 2,
    };
    renderPanel();

    // A mod id means nothing to the player; the catalogue name does.
    expect(screen.getByText("Sodium")).toBeInTheDocument();
  });

  it("names the culprit rather than showing its id", () => {
    mocks.state.value = {
      step: { kind: "culprit", value: "mod-b" },
      runs: 4,
      enabled: ["mod-b"],
      totalCandidates: 2,
    };
    renderPanel();

    expect(screen.getByText(/This mod crashes the game/i)).toBeInTheDocument();
    expect(screen.getByText("Iris Shaders")).toBeInTheDocument();
  });

  it("says plainly when the game itself is broken", () => {
    mocks.state.value = {
      step: { kind: "broken_without_mods" },
      runs: 1,
      enabled: ["mod-a", "mod-b"],
      totalCandidates: 2,
    };
    renderPanel();

    expect(screen.getByText(/The game crashes without any mod/i)).toBeInTheDocument();
    // Blaming a mod here would send the player down the wrong path.
    expect(screen.getByText(/Disabling mods will not help/i)).toBeInTheDocument();
  });
});
