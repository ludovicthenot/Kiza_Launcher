import { describe, expect, it } from "vitest";
import {
  isDue,
  SAVE_DELAY_MS,
  schedule,
  shouldAdopt,
  type PendingSave,
} from "../../src/lib/settingsDraft";

interface Config {
  concurrency: number;
  attempts: number;
  channel: string;
}

const saved: Config = { concurrency: 3, attempts: 4, channel: "stable" };

describe("folding changes into one write", () => {
  it("carries the previous pending value forward instead of the saved one", () => {
    // A slider dragged through six positions must write the sixth. Applying
    // each patch to the last *saved* value instead would write the sixth
    // change on top of the state from before the drag, losing the five in
    // between whenever they touched different fields.
    let pending: PendingSave<Config> | null = null;
    pending = schedule(pending, saved, { concurrency: 4 }, 0);
    pending = schedule(pending, saved, { attempts: 6 }, 10);
    pending = schedule(pending, saved, { concurrency: 8 }, 20);

    expect(pending.value).toEqual({ concurrency: 8, attempts: 6, channel: "stable" });
  });

  it("pushes the write back on every change, so a drag writes once", () => {
    let pending: PendingSave<Config> | null = null;
    let now = 0;
    let lastChangeAt = 0;

    // Sixty change events, one every 16 ms — roughly a one-second drag at
    // sixty frames a second.
    for (let index = 0; index < 60; index += 1) {
      pending = schedule(pending, saved, { concurrency: index % 8 }, now);
      lastChangeAt = now;
      now += 16;
      // Not once during the drag is a write due.
      expect(isDue(pending, now)).toBe(false);
    }

    // And it becomes due only after the changes stop, timed from the last one.
    expect(isDue(pending, lastChangeAt + SAVE_DELAY_MS - 1)).toBe(false);
    expect(isDue(pending, lastChangeAt + SAVE_DELAY_MS)).toBe(true);
  });

  it("leaves untouched fields alone", () => {
    const pending = schedule(null, saved, { channel: "beta" }, 0);
    expect(pending.value.concurrency).toBe(3);
    expect(pending.value.attempts).toBe(4);
  });
});

describe("when a write is due", () => {
  it("is not due before its time", () => {
    const pending = schedule(null, saved, { attempts: 2 }, 1_000);
    expect(isDue(pending, 1_000)).toBe(false);
    expect(isDue(pending, 1_000 + SAVE_DELAY_MS - 1)).toBe(false);
  });

  it("is due at its time and after", () => {
    const pending = schedule(null, saved, { attempts: 2 }, 1_000);
    expect(isDue(pending, 1_000 + SAVE_DELAY_MS)).toBe(true);
    expect(isDue(pending, 9_999_999)).toBe(true);
  });

  it("is never due when there is nothing waiting", () => {
    expect(isDue(null, 9_999_999)).toBe(false);
  });
});

describe("a configuration arriving from disk", () => {
  it("is adopted when nothing is waiting to be written", () => {
    expect(shouldAdopt(null, true)).toBe(true);
  });

  it("is refused while a write is still pending", () => {
    // The value coming back is the one from before the change. Letting it win
    // makes a switch flick back to where it was a moment after being pressed —
    // which is exactly what it looks like when a settings page is broken.
    const pending = schedule(null, saved, { channel: "beta" }, 0);
    expect(shouldAdopt(pending, true)).toBe(false);
  });

  it("is adopted anyway when there is no draft yet", () => {
    // The first load has to get through, pending write or not, or the page
    // renders nothing.
    const pending = schedule(null, saved, { channel: "beta" }, 0);
    expect(shouldAdopt(pending, false)).toBe(true);
  });
});
