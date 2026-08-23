// Interface preferences that are purely a matter of taste: density, text size,
// corner radius, and how much motion and translucency the launcher uses.
//
// Every one is applied as a CSS variable or a data attribute on <html>, so a
// change takes effect immediately and nothing has to re-render to obey it.
//
// Like the theme, these are read and written defensively: WebView2 provisions
// its storage folder on first launch, so localStorage can throw before it is
// ready. A preference that fails to persist is a shrug; a launcher that fails
// to boot is not.

export type Density = "compact" | "comfortable" | "spacious";
export type ColorScheme = "dark" | "light" | "system";

export interface Appearance {
  scheme: ColorScheme;
  density: Density;
  /** Percent of the base text size, 85–130. */
  textScale: number;
  /** Corner radius in pixels, 0–20. */
  radius: number;
  showInstanceArt: boolean;
  animations: boolean;
  translucency: boolean;
  backgroundBlur: boolean;
  /** Turns off the effects above in one move, for a modest machine. */
  reduceEffects: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  scheme: "dark",
  density: "comfortable",
  textScale: 100,
  radius: 12,
  showInstanceArt: true,
  animations: true,
  translucency: true,
  backgroundBlur: true,
  reduceEffects: false,
};

/** Row heights and paddings, in the order the interface reads them. */
const DENSITY_SCALE: Record<Density, number> = {
  compact: 0.88,
  comfortable: 1,
  spacious: 1.14,
};

const STORAGE_KEY = "kiza.appearance";

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Reads a stored preference set, repairing anything that is out of range.
 *
 * The file on disk is editable and survives upgrades, so a value from an older
 * build — or from a hand edit — must not be able to produce an unusable
 * interface. Unknown fields fall back to the default rather than propagating.
 */
export function normalise(raw: unknown): Appearance {
  const value = (raw ?? {}) as Partial<Appearance>;
  const density: Density =
    value.density === "compact" || value.density === "spacious" || value.density === "comfortable"
      ? value.density
      : DEFAULT_APPEARANCE.density;
  const scheme: ColorScheme =
    value.scheme === "light" || value.scheme === "system" || value.scheme === "dark"
      ? value.scheme
      : DEFAULT_APPEARANCE.scheme;

  return {
    scheme,
    density,
    textScale: Number.isFinite(value.textScale)
      ? clamp(Math.round(value.textScale as number), 85, 130)
      : DEFAULT_APPEARANCE.textScale,
    radius: Number.isFinite(value.radius)
      ? clamp(Math.round(value.radius as number), 0, 20)
      : DEFAULT_APPEARANCE.radius,
    showInstanceArt: value.showInstanceArt ?? DEFAULT_APPEARANCE.showInstanceArt,
    animations: value.animations ?? DEFAULT_APPEARANCE.animations,
    translucency: value.translucency ?? DEFAULT_APPEARANCE.translucency,
    backgroundBlur: value.backgroundBlur ?? DEFAULT_APPEARANCE.backgroundBlur,
    reduceEffects: value.reduceEffects ?? DEFAULT_APPEARANCE.reduceEffects,
  };
}

export function getStoredAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalise(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/**
 * The effects actually in force.
 *
 * "Reduce effects on modest machines" is one switch that stands in front of
 * three. Rather than silently rewriting those three — which would lose what
 * the user had chosen when they turn it back off — it is resolved here, at the
 * moment of use.
 */
export function effectiveEffects(appearance: Appearance): {
  animations: boolean;
  translucency: boolean;
  backgroundBlur: boolean;
} {
  if (appearance.reduceEffects) {
    return { animations: false, translucency: false, backgroundBlur: false };
  }
  return {
    animations: appearance.animations,
    translucency: appearance.translucency,
    backgroundBlur: appearance.backgroundBlur,
  };
}

/** Writes the preferences onto <html>, where the stylesheet reads them. */
export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  const effects = effectiveEffects(appearance);

  root.style.setProperty("--kiza-density", String(DENSITY_SCALE[appearance.density]));
  root.style.setProperty("--kiza-text-scale", `${appearance.textScale / 100}`);
  root.style.setProperty("--radius", `${appearance.radius}px`);

  root.dataset.density = appearance.density;
  root.dataset.animations = effects.animations ? "on" : "off";
  root.dataset.translucency = effects.translucency ? "on" : "off";
  root.dataset.blur = effects.backgroundBlur ? "on" : "off";
  root.dataset.instanceArt = appearance.showInstanceArt ? "on" : "off";

  // "System" follows the OS; the other two are a deliberate override.
  const prefersLight =
    appearance.scheme === "light" ||
    (appearance.scheme === "system" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: light)").matches);
  root.classList.toggle("dark", !prefersLight);
  root.classList.toggle("light", prefersLight);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Not persisting a preference is harmless; crashing at boot is not.
  }
}

export function initAppearance() {
  applyAppearance(getStoredAppearance());
}
