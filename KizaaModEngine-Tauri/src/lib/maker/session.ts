/**
 * Opening and closing the Maker.
 *
 * The launcher is not replaced, previewed or re-rendered somewhere else: the
 * window gets wider, the launcher keeps the space it had, and the panel takes
 * the new space beside it. Everything on the left is the real Kiza, still
 * navigable, still running, and painted by the draft.
 *
 * Only the Maker edition ever imports this file. In a Stable build `IS_MAKER`
 * is the literal `false`, the panel is never rendered and the bundler drops all
 * of it.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { hexToHslTriple } from "../appearance";
import { hslToHex } from "../colour";
import { BUILT_IN_THEMES } from "../theme/builtin";
import type { ThemeDefinition } from "../theme/definition";
import { effectiveTheme, useThemeStore } from "../theme/store";

/** How much room the panel takes. Matches the width in `MakerPanel`. */
export const PANEL_WIDTH = 380;

/**
 * The smallest the launcher is allowed to be on its own.
 *
 * The same numbers as `tauri.conf.json`, and a test holds them to it. They are
 * repeated here because the Maker raises the floor while the panel is open and
 * has to know what to put it back to; Tauri will tell you a window's size but
 * not its minimum.
 */
export const MIN_LAUNCHER_WIDTH = 960;
export const MIN_LAUNCHER_HEIGHT = 600;

/**
 * A theme as the backend writes it.
 *
 * The same values, named the way `kizatheme.rs` reads them. Kept as a
 * translation at the edge rather than by making the launcher's own type match
 * a file format: the format will gain fields the interface does not paint, and
 * the interface holds URLs where the file holds file names.
 */
interface ThemeManifest {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  author: string | null;
  version: string | null;
  colors: Record<string, string>;
  ambient: { color: string; alpha: number }[];
  radius: number | null;
  effects?: { translucency?: boolean; backgroundBlur?: boolean } | null;
  assets: Record<string, string>;
}

export interface InstalledTheme {
  manifest: ThemeManifest;
  /** Slot name to the picture's path on disk. */
  assets: Record<string, string>;
}

/** An HSL triplet as a hex colour, for a picker that only speaks hex. */
export function tripleToHex(triple: string): string {
  const parts = triple.split(/\s+/);
  const hue = Number.parseFloat(parts[0] ?? "");
  const saturation = Number.parseFloat((parts[1] ?? "").replace("%", ""));
  const lightness = Number.parseFloat((parts[2] ?? "").replace("%", ""));
  if ([hue, saturation, lightness].some(Number.isNaN)) return "#000000";
  return hslToHex(hue, saturation, lightness);
}

/** A hex colour as the HSL triplet the theme stores. */
export function hexToTriple(hex: string): string | null {
  return hexToHslTriple(hex);
}

/** Whether a string is a colour the engine can paint with. */
export function isTriple(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3) return false;
  const hue = Number.parseFloat(parts[0]);
  const saturation = Number.parseFloat(parts[1].replace("%", ""));
  const lightness = Number.parseFloat(parts[2].replace("%", ""));
  return (
    parts[1].endsWith("%") &&
    parts[2].endsWith("%") &&
    hue >= 0 &&
    hue <= 360 &&
    saturation >= 0 &&
    saturation <= 100 &&
    lightness >= 0 &&
    lightness <= 100
  );
}

/** Turns what the backend read into the theme the launcher paints. */
export function toDefinition(installed: InstalledTheme, toUrl: (path: string) => string): ThemeDefinition {
  const { manifest } = installed;
  const assets: Record<string, string> = {};
  for (const [slot, path] of Object.entries(installed.assets)) {
    assets[slot] = toUrl(path);
  }
  return {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    author: manifest.author ?? undefined,
    version: manifest.version ?? undefined,
    colors: manifest.colors as ThemeDefinition["colors"],
    ambient: [manifest.ambient[0], manifest.ambient[1]],
    radius: manifest.radius ?? undefined,
    effects: manifest.effects ?? undefined,
    assets: assets as ThemeDefinition["assets"],
  };
}

/**
 * Turns a theme into the manifest the backend validates and writes.
 *
 * The file names come from the picture paths, not from the theme: a theme holds
 * URLs the window can draw, and a `.kizatheme` holds files. Export hands the
 * backend both, and the backend is the only thing that decides whether the
 * result is a theme it would open.
 */
export function toManifest(
  theme: ThemeDefinition,
  assetPaths: Record<string, string>,
): ThemeManifest {
  const assets: Record<string, string> = {};
  for (const [slot, path] of Object.entries(assetPaths)) {
    // The name inside the archive is the slot's, not the staged file's. What
    // sits on disk carries the moment it was taken so the window reloads it;
    // a theme somebody opens in a year should just say `logo.webp`.
    const extension = path.split(".").pop()?.toLowerCase();
    if (extension) assets[slot] = `${slot}.${extension}`;
  }
  return {
    schemaVersion: 1,
    id: theme.id,
    name: theme.name,
    description: theme.description,
    author: theme.author ?? null,
    version: theme.version ?? null,
    colors: theme.colors,
    ambient: [theme.ambient[0], theme.ambient[1]],
    radius: theme.radius ?? null,
    effects: theme.effects ?? null,
    assets,
  };
}

/**
 * How much the window actually grew when the Maker opened.
 *
 * Not assumed to be `PANEL_WIDTH`. A window against the right edge of a small
 * screen may only have had room for part of it, and closing has to give back
 * what was taken rather than a number that was hoped for — otherwise the Maker
 * shrinks the launcher a little every time it is opened and closed.
 */
let borrowed = 0;

/**
 * Where the window was standing, and where opening the Maker put it.
 *
 * Only set when the Maker actually moved it, which happens near the right
 * edge. Closing puts it back — but only if it is still where the Maker left
 * it. Somebody who dragged the window themselves while editing has said where
 * they want it, and shoving it back afterwards would be the launcher arguing.
 */
let moved: { from: number; to: number } | null = null;

/** Where a window is and how big it is, in physical pixels. */
export interface WindowPlace {
  x: number;
  width: number;
}

/** The part of a screen a window may actually occupy, in physical pixels. */
export interface WorkArea {
  x: number;
  width: number;
}

/**
 * How much a window can grow, and where it has to stand to do it.
 *
 * Pulled out of the resizing so it can be checked without a desk full of
 * monitors: the interesting cases are a window against the right edge, a screen
 * too narrow for both the launcher and the panel, and a taskbar down one side.
 * All physical pixels — monitors need not share a scale factor, and physical
 * coordinates are the one space they all agree on.
 */
export function roomFor(
  window: WindowPlace,
  area: WorkArea | null,
  wanted: number,
): { room: number; x: number } {
  if (!area) return { room: Math.max(0, wanted), x: window.x };

  // Never wider than the space it is in.
  const room = Math.max(0, Math.min(wanted, area.width - window.width));
  const right = area.x + area.width;
  const overflow = window.x + window.width + room - right;
  // Growing rightwards would go off the screen, so take the space from the
  // left instead — as far as the left edge allows, and no further.
  const x = overflow > 0 ? Math.max(area.x, window.x - overflow) : window.x;
  return { room, x };
}

/**
 * Makes room for the panel.
 *
 * The launcher keeps every pixel it had: the window grows, rather than the
 * content on the left reflowing into less space.
 *
 * Three things a browser never shows and Windows does. A window near the right
 * edge cannot grow rightwards, so it moves left by as much as it needs and can
 * take. A window on a screen too narrow for both takes what room there is. And
 * a maximised window cannot grow at all, so the launcher shares the width it
 * has — the honest outcome, and the reason the panel is a fixed 380 rather than
 * a fraction of the window.
 */
async function makeRoom(wanted: number): Promise<number> {
  try {
    const window = getCurrentWindow();
    if (await window.isMaximized()) return 0;

    const factor = await window.scaleFactor();
    const inner = await window.innerSize();
    const outer = await window.outerSize();
    const position = await window.outerPosition();
    const monitor = await currentMonitor();

    // The work area rather than the whole screen: a taskbar is not room.
    const area = monitor
      ? { x: monitor.workArea.position.x, width: monitor.workArea.size.width }
      : null;
    const { room, x } = roomFor(
      { x: position.x, width: outer.width },
      area,
      Math.round(wanted * factor),
    );

    if (x !== position.x) {
      await window.setPosition(new PhysicalPosition(x, position.y));
      moved = { from: position.x, to: x };
    }
    if (room <= 0) return 0;
    await window.setSize(new PhysicalSize(inner.width + room, inner.height));
    return room / factor;
  } catch {
    // A window that will not resize is not a reason to refuse to open the
    // Maker; the panel simply shares the width that is there.
    return 0;
  }
}

/** What the Maker still owes the window when it closes. */
interface Debt {
  /** Logical pixels of width to hand back. */
  width: number;
  /** Where the window stood before the Maker shifted it, and where it put it. */
  position: { from: number; to: number } | null;
}

/** A debt that could not be paid because the window was maximised. */
let pending: (() => void) | null = null;

/** Stops waiting for an unmaximise, if anything is waiting. */
function stopWaiting(): void {
  const stop = pending;
  pending = null;
  if (stop) stop();
}

/**
 * Gives back exactly what was borrowed.
 *
 * A maximised window cannot be resized, and that is not an edge case somebody
 * has to be warned about: maximise with the Maker open, close the Maker, and
 * the width Windows restores to would still carry the panel — the launcher
 * quietly 380 pixels wider than the person left it, for good. So the debt
 * waits for the window to come back down and is paid then. It is one listener,
 * it detaches the moment it has settled, and reopening the Maker cancels it
 * because the panel needs that width again.
 */
async function settle(debt: Debt): Promise<void> {
  if (debt.width <= 0 && !debt.position) return;
  try {
    const window = getCurrentWindow();
    if (await window.isMaximized()) {
      await waitForRestore(debt);
      return;
    }

    if (debt.width > 0) {
      const factor = await window.scaleFactor();
      const size = (await window.innerSize()).toLogical(factor);
      await window.setSize(new LogicalSize(Math.max(1, size.width - debt.width), size.height));
    }
    if (debt.position) {
      const position = await window.outerPosition();
      // Within a pixel: the compositor is allowed to round, a person dragging
      // a window is not going to land on the same pixel by accident. If they
      // have moved it, they have said where they want it and it stays there.
      if (Math.abs(position.x - debt.position.to) <= 1) {
        await window.setPosition(new PhysicalPosition(debt.position.from, position.y));
      }
    }
  } catch {
    // Nothing to do about a window that will not resize.
  }
}

/** Pays the debt the next time the window is not maximised. */
async function waitForRestore(debt: Debt): Promise<void> {
  stopWaiting();
  try {
    const window = getCurrentWindow();
    const unlisten = await window.onResized(() => {
      void (async () => {
        // Resizing fires while maximised too, and on the way out of it.
        if (!pending || (await window.isMaximized())) return;
        stopWaiting();
        await settle(debt);
      })();
    });
    pending = () => {
      // Detaching is asynchronous, and an unhandled rejection here would take
      // the window down over a resize nobody is watching any more.
      void Promise.resolve(unlisten()).catch(() => {});
    };
  } catch {
    // Without the event there is nothing to wait for; the window keeps the
    // width, which is the outcome this whole function exists to avoid but is
    // still better than failing to close the Maker.
  }
}

/**
 * Keeps the launcher usable while the panel is beside it.
 *
 * The window's own minimum is what the launcher needs on its own; with the
 * panel beside it that floor has to rise, or somebody dragging the edge can
 * squeeze the launcher to almost nothing and wonder what broke.
 *
 * Raised by what the window actually got rather than by the panel's full
 * width. Those differ on a screen that had no 380 to give, and a minimum wider
 * than the window Windows just allowed would have Windows widen it right back
 * — past the edge that makeRoom had carefully kept it inside.
 */
async function raiseFloor(by: number): Promise<void> {
  try {
    const window = getCurrentWindow();
    await window.setMinSize(new LogicalSize(MIN_LAUNCHER_WIDTH + by, MIN_LAUNCHER_HEIGHT));
  } catch {
    // Left at whatever the manifest asked for.
  }
}

/** Opens the Maker on a theme. */
export async function openMaker(from?: ThemeDefinition): Promise<void> {
  const state = useThemeStore.getState();
  if (state.session) return;
  // Whatever was owed from a previous close is owed no longer: the panel is
  // back, and it needs that width again.
  stopWaiting();
  state.beginSession(from ?? effectiveTheme(state));
  moved = null;
  borrowed = await makeRoom(PANEL_WIDTH);
  await raiseFloor(borrowed);
}

/**
 * Closes the Maker.
 *
 * Returns false when there is unsaved work and it was not told to discard, so
 * the panel can ask. The store is what refuses; this only carries the answer.
 */
export async function closeMaker(options?: { discard?: boolean }): Promise<boolean> {
  const closed = useThemeStore.getState().endSession(options);
  if (!closed) return false;
  // The floor comes down first: giving back the width while the minimum still
  // includes the panel would leave the window stuck at the wider size.
  await raiseFloor(0);
  const debt: Debt = { width: borrowed, position: moved };
  borrowed = 0;
  moved = null;
  await settle(debt);
  return true;
}

/** Every theme that can be chosen: the bundled ones and any imported. */
export async function loadInstalled(toUrl: (path: string) => string): Promise<void> {
  const installed = await invoke<InstalledTheme[]>("installed_themes");
  useThemeStore
    .getState()
    .setAvailable([...BUILT_IN_THEMES, ...installed.map((theme) => toDefinition(theme, toUrl))]);
}
