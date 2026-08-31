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
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { hexToHslTriple } from "../appearance";
import { hslToHex } from "../colour";
import { BUILT_IN_THEMES } from "../theme/builtin";
import type { ThemeDefinition } from "../theme/definition";
import { effectiveTheme, useThemeStore } from "../theme/store";

/** How much room the panel takes. Matches the width in `MakerPanel`. */
export const PANEL_WIDTH = 380;

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
    const name = path.split(/[\\/]/).pop();
    if (name) assets[slot] = name;
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
    assets,
  };
}

/**
 * Makes room for the panel.
 *
 * The launcher keeps every pixel it had; the window grows by the panel's width
 * so nothing on the left has to reflow into less space. A maximised window is
 * left alone — it cannot grow, and the launcher giving up 380 pixels is the
 * honest outcome there.
 */
async function widen(by: number): Promise<void> {
  try {
    const window = getCurrentWindow();
    if (await window.isMaximized()) return;
    const size = await window.innerSize();
    const factor = await window.scaleFactor();
    const logical = size.toLogical(factor);
    await window.setSize(new LogicalSize(logical.width + by, logical.height));
  } catch {
    // A window that will not resize is not a reason to refuse to open the
    // Maker; the panel simply shares the width that is there.
  }
}

/** Opens the Maker on a theme. */
export async function openMaker(from?: ThemeDefinition): Promise<void> {
  const state = useThemeStore.getState();
  if (state.session) return;
  state.beginSession(from ?? effectiveTheme(state));
  await widen(PANEL_WIDTH);
}

/**
 * Closes the Maker.
 *
 * Returns false when there is unsaved work and it was not told to discard, so
 * the panel can ask. The store is what refuses; this only carries the answer.
 */
export async function closeMaker(options?: { discard?: boolean }): Promise<boolean> {
  const closed = useThemeStore.getState().endSession(options);
  if (closed) await widen(-PANEL_WIDTH);
  return closed;
}

/** Every theme that can be chosen: the bundled ones and any imported. */
export async function loadInstalled(toUrl: (path: string) => string): Promise<void> {
  const installed = await invoke<InstalledTheme[]>("installed_themes");
  useThemeStore
    .getState()
    .setAvailable([...BUILT_IN_THEMES, ...installed.map((theme) => toDefinition(theme, toUrl))]);
}
