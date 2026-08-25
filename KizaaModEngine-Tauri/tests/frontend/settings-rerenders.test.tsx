import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * What a settings page costs to change.
 *
 * The freeze people actually felt had two halves. The Rust half — commands
 * without `async` running on the thread that draws the window — is guarded by a
 * test in `lib.rs`. This is the other half: a settings page that rebuilt itself
 * on every keystroke because the callback it hands to every row was a new
 * function each time.
 *
 * Measured in renders rather than in milliseconds, because milliseconds on a
 * build machine say nothing about milliseconds on someone's laptop, and the
 * number of renders is the thing that was actually wrong.
 */

const invoke = vi.fn(async (command: string) => {
  if (command === "get_app_config") return { ...config };
  return undefined;
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args as never),
  convertFileSrc: (path: string) => path,
  isTauri: () => true,
}));

const config = {
  notify_windows: true,
  notify_in_app: true,
  notify_sound: false,
  notify_position: "bottom-right",
  download_concurrency: 3,
};

// Built once per test, not per render: a client created inside the wrapper's
// body would be a new cache on every re-render, which is exactly the thing
// these tests are counting.
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSettingsDraft", () => {
  beforeEach(() => {
    invoke.mockClear();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("hands out the same update function after a change", async () => {
    const { useSettingsDraft } = await import("../../src/lib/useSettingsDraft");

    const seen: Array<(patch: Record<string, unknown>) => void> = [];
    let apply: ((patch: Record<string, unknown>) => void) | null = null;

    function Probe() {
      const { draft, update } = useSettingsDraft();
      seen.push(update as never);
      apply = update as never;
      return <span>{draft ? "ready" : "loading"}</span>;
    }

    const view = render(<Probe />, { wrapper });
    await waitFor(() => expect(view.container.textContent).toBe("ready"));

    const before = seen.length;
    await act(async () => {
      apply?.({ notify_sound: true });
    });

    // The change must reach the draft...
    expect(seen.length).toBeGreaterThan(before);
    // ...without replacing the callback. It used to depend on the draft, so
    // every row on the page got a new `onChange` on every edit and re-rendered
    // even though nothing about it had changed.
    expect(seen[seen.length - 1]).toBe(seen[0]);
  });

  it("does not write to disk while the changes are still coming", async () => {
    vi.useFakeTimers();
    const { useSettingsDraft } = await import("../../src/lib/useSettingsDraft");

    let apply: ((patch: Record<string, unknown>) => void) | null = null;
    function Probe() {
      const { update } = useSettingsDraft();
      apply = update as never;
      return null;
    }

    render(<Probe />, { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    invoke.mockClear();
    // A slider dragged across its range, one change per frame.
    for (let index = 0; index < 40; index += 1) {
      act(() => {
        apply?.({ download_concurrency: (index % 8) + 1 });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16);
      });
    }

    expect(invoke.mock.calls.filter(([command]) => command === "save_app_config")).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const writes = invoke.mock.calls.filter(([command]) => command === "save_app_config");
    expect(writes).toHaveLength(1);

    vi.useRealTimers();
  });
});
