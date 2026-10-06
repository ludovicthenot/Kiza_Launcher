// Launcher theme system.
//
// A theme is a `ThemeDefinition` — see `theme/definition.ts` — and there is
// exactly one way to apply one: the engine writes its colours onto the document
// as custom properties. The four themes Kiza ships with are values of that same
// type held in the bundle, so a `.kizatheme` somebody makes is applied by the
// identical code path and nothing downstream can tell the two apart.
//
// It used to be a set of stylesheet rules picked by a `data-theme` attribute.
// That worked for the four that were written by hand and could never have
// worked for a theme loaded from a file.

import { useMemo } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "./theme/builtin";
import type { ThemeDefinition } from "./theme/definition";
import { loadInstalledThemes } from "./theme/installed";
import { startPainting, useThemeStore } from "./theme/store";

export type ThemeId = string;

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  description: string;
  /** Representative swatches shown on the theme card: [background, primary, accent]. */
  swatches: [string, string, string];
}

/** The swatches a theme card shows, taken from the theme rather than repeated. */
function swatchesOf(theme: ThemeDefinition): [string, string, string] {
  return [
    `hsl(${theme.colors.background})`,
    `hsl(${theme.colors.primary})`,
    `hsl(${theme.colors.accent})`,
  ];
}

function infoOf(theme: ThemeDefinition): ThemeInfo {
  return {
    id: theme.id,
    name: theme.name,
    description: theme.description,
    swatches: swatchesOf(theme),
  };
}

export const THEMES: ThemeInfo[] = BUILT_IN_THEMES.map(infoOf);

/** Every theme that can be chosen right now: Kiza's own, then any imported. */
export function useThemes(): ThemeInfo[] {
  const available = useThemeStore((state) => state.available);
  return useMemo(() => available.map(infoOf), [available]);
}

/**
 * The theme actually on screen, which is not always the one stored.
 *
 * A stored theme that has since been removed, or one whose file has not been
 * read yet, is painted as Kiza's default, and the page should say so rather
 * than highlight nothing.
 */
export function useAppliedThemeId(): ThemeId {
  return useThemeStore((state) =>
    state.available.some((theme) => theme.id === state.appliedId) ? state.appliedId : DEFAULT_THEME_ID,
  );
}

export function themeById(id: ThemeId): ThemeDefinition {
  return BUILT_IN_THEMES.find((theme) => theme.id === id) ?? BUILT_IN_THEMES[0];
}

const STORAGE_KEY = "kiza.theme";

// WebView2 provisions its storage folder on first launch, so localStorage can
// throw before it is ready. Startup must never depend on it: a failure here
// would take down the whole module and leave a blank window.
function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: ThemeId) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not persisting the theme is harmless; crashing at boot is not.
  }
}

/**
 * The theme that was chosen, as it was stored.
 *
 * Not checked against the bundled four any more: an imported theme is chosen
 * the same way, and its file is only read once the launcher is running. Until
 * then, and if it is gone, the store paints the default in its place; the
 * choice itself is kept, so the theme comes back the moment it is found.
 */
export function getStoredTheme(): ThemeId {
  const stored = readStored()?.trim();
  return stored ? stored : DEFAULT_THEME_ID;
}

/**
 * Chooses the theme the launcher runs with.
 *
 * Goes through the store rather than straight to the engine: while somebody is
 * editing in the Maker the window is painting a draft, and choosing a theme in
 * Settings must not paint over their work. The store decides what is on screen;
 * this only says which theme is the chosen one.
 */
export function applyTheme(id: ThemeId) {
  useThemeStore.getState().setApplied(id);
  writeStored(id);
}

/** Apply the persisted theme at startup (main and console windows). */
export function initTheme() {
  useThemeStore.getState().setApplied(getStoredTheme());
  startPainting();
  // The imported themes, read once the window is up. The one chosen last time
  // is painted as soon as it arrives; the default stands in until then.
  if (isTauri()) void loadInstalledThemes().catch(() => undefined);

  // The log window is a second page on the same storage. Choosing a theme in
  // the launcher wrote it down there too, and the log window went on in the
  // old one until it was closed; `storage` is the browser saying the other
  // page wrote, which is exactly when to follow.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY) return;
      useThemeStore.getState().setApplied(getStoredTheme());
      // A theme imported in the other window is a file this one has not read.
      if (isTauri()) void loadInstalledThemes().catch(() => undefined);
    });
  }
}
