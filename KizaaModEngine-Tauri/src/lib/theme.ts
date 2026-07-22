// Launcher theme system. Themes are CSS variable sets scoped by a
// data-theme attribute on <html> (see App.css); "nebula" is the default
// Kiza look and needs no attribute.

export type ThemeId = "nebula" | "cyber" | "toxic" | "chinese-road";

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  description: string;
  /** Representative swatches shown on the theme card: [background, primary, accent]. */
  swatches: [string, string, string];
}

export const THEMES: ThemeInfo[] = [
  {
    id: "nebula",
    name: "Kiza Nebula",
    description: "Deep violet void with an electric violet primary. The signature Kiza look.",
    swatches: ["hsl(242 30% 5%)", "hsl(258 90% 66%)", "hsl(224 90% 60%)"],
  },
  {
    id: "cyber",
    name: "Cyber",
    description: "Saturated neons on a near-black night: electric cyan and magenta.",
    swatches: ["hsl(228 40% 6%)", "hsl(184 96% 46%)", "hsl(341 100% 58%)"],
  },
  {
    id: "toxic",
    name: "Toxic",
    description: "Carbon black, industrial grey, and a sharp radioactive green.",
    swatches: ["#181918", "#00ff43", "#484c51"],
  },
  {
    id: "chinese-road",
    name: "Chinese Road",
    description: "Deep black lacquer with imperial red and warm antique gold.",
    swatches: ["#121312", "#ad0013", "#a67d43"],
  },
];

const STORAGE_KEY = "kiza.theme";

export function getStoredTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY);
  return THEMES.some((theme) => theme.id === stored) ? (stored as ThemeId) : "nebula";
}

export function applyTheme(id: ThemeId) {
  if (id === "nebula") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = id;
  }
  localStorage.setItem(STORAGE_KEY, id);
}

/** Apply the persisted theme at startup (main and console windows). */
export function initTheme() {
  applyTheme(getStoredTheme());
}
