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

import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "./theme/builtin";
import type { ThemeDefinition } from "./theme/definition";
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

export const THEMES: ThemeInfo[] = BUILT_IN_THEMES.map((theme) => ({
  id: theme.id,
  name: theme.name,
  description: theme.description,
  swatches: swatchesOf(theme),
}));

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

export function getStoredTheme(): ThemeId {
  const stored = readStored();
  return BUILT_IN_THEMES.some((theme) => theme.id === stored)
    ? (stored as ThemeId)
    : DEFAULT_THEME_ID;
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
}
