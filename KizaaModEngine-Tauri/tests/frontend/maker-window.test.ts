/**
 * Where the window goes when the Maker opens.
 *
 * The panel is 380 pixels the window did not have, and Windows has opinions
 * about that a browser never shows: a window against the right edge cannot
 * grow rightwards, a small screen may not have 380 spare at all, and a taskbar
 * down one side is not room. The geometry is a pure function so the awkward
 * cases can be checked here rather than by dragging a window around a desk.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MIN_LAUNCHER_HEIGHT,
  MIN_LAUNCHER_WIDTH,
  roomFor,
} from "../../src/lib/maker/session";

/** A 1920×1080 screen with the taskbar at the bottom: full width available. */
const screen = { x: 0, width: 1920 };

describe("making room for the panel", () => {
  it("grows in place when there is room to the right", () => {
    const { room, x } = roomFor({ x: 200, width: 1280 }, screen, 380);
    expect(room).toBe(380);
    expect(x).toBe(200);
  });

  it("moves left rather than off the right edge", () => {
    // 1600 + 1280 would end at 2880 on a screen that stops at 1920.
    const { room, x } = roomFor({ x: 600, width: 1280 }, screen, 380);
    expect(room).toBe(380);
    // Exactly flush with the right edge, and no further left than it must go.
    expect(x + 1280 + room).toBe(1920);
    expect(x).toBe(260);
  });

  it("stops at the left edge instead of going off the other side", () => {
    // A window nearly as wide as the screen cannot fit the panel and is not
    // dragged off the left trying: it takes what the screen actually has.
    const { room, x } = roomFor({ x: 40, width: 1800 }, screen, 380);
    expect(room).toBe(120);
    expect(x).toBe(0);
    expect(x + 1800 + room).toBeLessThanOrEqual(1920);
  });

  it("takes nothing when the window already fills the screen", () => {
    expect(roomFor({ x: 0, width: 1920 }, screen, 380)).toEqual({ room: 0, x: 0 });
  });

  it("respects a taskbar down the side", () => {
    // The work area starts at 80 and ends at 1920: growing must not slide the
    // window under the taskbar.
    const docked = { x: 80, width: 1840 };
    const { room, x } = roomFor({ x: 100, width: 1700 }, docked, 380);
    expect(room).toBe(140);
    expect(x).toBe(80);
    expect(x + 1700 + room).toBe(1920);
  });

  it("works on a second monitor, which does not start at zero", () => {
    const right = { x: 1920, width: 1920 };
    const { room, x } = roomFor({ x: 3400, width: 400 }, right, 380);
    expect(room).toBe(380);
    expect(x + 400 + room).toBe(3840);
  });

  /** A desk that will not say where the screen ends still gets its panel. */
  it("grows anyway when the monitor is unknown", () => {
    expect(roomFor({ x: 200, width: 1280 }, null, 380)).toEqual({ room: 380, x: 200 });
  });
});

/**
 * While the panel is open the window's minimum has to include it, or dragging
 * the edge squeezes the launcher to nothing. Closing puts the minimum back —
 * back to the number in `tauri.conf.json`, which is the one repeated here.
 */
describe("the smallest the launcher may be", () => {
  it("matches the window the app actually opens", () => {
    const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const window = config.app.windows[0];
    expect(MIN_LAUNCHER_WIDTH).toBe(window.minWidth);
    expect(MIN_LAUNCHER_HEIGHT).toBe(window.minHeight);
  });
});
