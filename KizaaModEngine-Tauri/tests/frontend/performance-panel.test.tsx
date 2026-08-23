import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PerformancePanel } from "../../src/components/instance/PerformancePanel";
import { I18nProvider } from "../../src/lib/i18n";

const mocks = vi.hoisted(() => ({
  report: { value: null as unknown },
  measure: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("../../src/lib/queries", () => ({
  usePerformanceReport: () => ({ data: mocks.report.value, isLoading: false }),
  useMeasureNextLaunch: () => ({ mutate: mocks.measure, isPending: false }),
  useApplyAdvice: () => ({ mutate: mocks.apply, isPending: false }),
}));

const EMPTY = {
  advice: [],
  xmsMb: 6144,
  xmxMb: 6144,
  totalRamMb: 16384,
  javaMajor: 21,
  runs: [],
  comparison: null,
  measuringNextLaunch: false,
};

function renderPanel() {
  return render(
    <I18nProvider>
      <PerformancePanel instanceId="instance-a" />
    </I18nProvider>,
  );
}

describe("PerformancePanel", () => {
  beforeEach(() => {
    mocks.measure.mockReset();
    mocks.apply.mockReset();
    mocks.report.value = EMPTY;
  });

  it("says the instance is fine rather than inventing advice", () => {
    renderPanel();

    // Filler advice trains people to ignore the panel, which costs them the one
    // time it matters.
    expect(screen.getByText(/set up sensibly/i)).toBeInTheDocument();
  });

  it("offers to apply a settings change but never a mod change", () => {
    mocks.report.value = {
      ...EMPTY,
      advice: [
        {
          id: "heap-too-large-for-machine",
          severity: "critical",
          title: "More memory is reserved than this machine can spare",
          detail: "…",
          action: { kind: "set_max_memory", value: 4915 },
        },
        {
          id: "two-renderers",
          severity: "critical",
          title: "Two renderers are installed at once",
          detail: "…",
          // Installing or removing a mod goes through the flows that ask first
          // and record where the file came from.
          action: { kind: "remove_mod", value: "OptiFine.jar" },
        },
      ],
    };
    renderPanel();

    const buttons = screen.getAllByRole("button", { name: /Fix it/i });
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]);
    expect(mocks.apply).toHaveBeenCalledWith({
      instanceId: "instance-a",
      action: { kind: "set_max_memory", value: 4915 },
    });
  });

  it("turns measurement on for one launch and offers to cancel it", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Measure the next launch/i }));
    expect(mocks.measure).toHaveBeenCalledWith({ instanceId: "instance-a", wanted: true });

    mocks.report.value = { ...EMPTY, measuringNextLaunch: true };
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Cancel measurement/i }));
    expect(mocks.measure).toHaveBeenLastCalledWith({ instanceId: "instance-a", wanted: false });
  });

  it("stays silent about a comparison it could not make", () => {
    mocks.report.value = {
      ...EMPTY,
      runs: [
        {
          id: "run-1",
          instance_id: "instance-a",
          recorded_at: "2026-02-01T10:00:00Z",
          label: "",
          xmx_mb: 6144,
          java_major: 21,
          mod_count: 40,
          seconds_to_menu: 32,
        },
      ],
      comparison: {
        startup: "better",
        startup_delta_seconds: -20,
        // No garbage collection was measured in one of the two runs.
        worst_pause: "unknown",
        worst_pause_delta_ms: null,
        total_pause: "unknown",
        total_pause_delta_ms: null,
      },
    };
    renderPanel();

    expect(screen.getByText(/Startup: better/i)).toBeInTheDocument();
    // "Unknown" as a badge would be noise; the row simply is not there.
    expect(screen.queryByText(/Longest freeze:/i)).not.toBeInTheDocument();
  });
});
