/**
 * Themes somebody has added: the `.kizatheme` files a Maker exported.
 *
 * Kept with the engine rather than with the Maker, because choosing one is a
 * launcher matter. The Maker makes themes and the launcher wears them, and the
 * launcher must not need the Maker's code in its bundle to do so.
 */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { BUILT_IN_THEMES } from "./builtin";
import type { ThemeDefinition } from "./definition";
import { useThemeStore } from "./store";

/**
 * A theme as the backend writes it.
 *
 * The same values, named the way `kizatheme.rs` reads them. Kept as a
 * translation at the edge rather than by making the launcher's own type match
 * a file format: the format will gain fields the interface does not paint, and
 * the interface holds URLs where the file holds file names.
 */
export interface ThemeManifest {
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
  components?: Record<string, Record<string, string>> | null;
  layout?: Record<string, Record<string, string>> | null;
  assets: Record<string, string>;
}

export interface InstalledTheme {
  manifest: ThemeManifest;
  /** Slot name to the picture's path on disk. */
  assets: Record<string, string>;
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
    components: manifest.components ?? undefined,
    layout: manifest.layout ?? undefined,
    assets: assets as ThemeDefinition["assets"],
  };
}

/** Every theme that can be chosen: the bundled ones and any imported. */
export async function loadInstalledThemes(
  toUrl: (path: string) => string = convertFileSrc,
): Promise<void> {
  const installed = await invoke<InstalledTheme[]>("installed_themes");
  useThemeStore
    .getState()
    .setAvailable([...BUILT_IN_THEMES, ...installed.map((theme) => toDefinition(theme, toUrl))]);
}

/** Opens a `.kizatheme` and keeps it. Returns the theme, ready to choose. */
export async function importThemeFile(path: string): Promise<ThemeDefinition> {
  const installed = await invoke<InstalledTheme>("import_theme", { archivePath: path });
  await loadInstalledThemes();
  return toDefinition(installed, convertFileSrc);
}

/** Forgets an installed theme. A bundled one cannot be removed. */
export async function removeInstalledTheme(id: string): Promise<void> {
  if (BUILT_IN_THEMES.some((theme) => theme.id === id)) return;
  await invoke("remove_theme", { themeId: id });
  await loadInstalledThemes();
}

/** Whether a theme came with Kiza rather than from a file. */
export function isBuiltIn(id: string): boolean {
  return BUILT_IN_THEMES.some((theme) => theme.id === id);
}
