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

import { effectsOf, type ThemeDefinition, type ThemeEffects } from "./theme/definition";
import { activeTheme } from "./theme/engine";

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
  /**
   * Whether panels are see-through, or null to follow the theme.
   *
   * Three states rather than two, and the third is the point. A theme knows
   * whether it was designed frosted or flat; a person who has actually flicked
   * this switch knows better still. Null means nobody has said, so the theme's
   * recommendation stands — and switching themes then changes the look, which
   * is what a theme is for. Once somebody touches the switch it is a decision
   * and no theme overrides it.
   */
  translucency: boolean | null;
  /** Whether what is behind a translucent panel is blurred, or null as above. */
  backgroundBlur: boolean | null;
  /** Turns off the effects above in one move, for a modest machine. */
  reduceEffects: boolean;
  /**
   * A hex accent colour that overrides the theme's primary, or null to follow
   * whichever theme is selected.
   */
  accent: string | null;
}

export const DEFAULT_APPEARANCE: Appearance = {
  scheme: "dark",
  density: "comfortable",
  textScale: 100,
  radius: 12,
  showInstanceArt: true,
  animations: true,
  translucency: null,
  backgroundBlur: null,
  reduceEffects: false,
  accent: null,
};

/** The accents offered on the page. Any hex is accepted; these are shortcuts. */
export const ACCENT_PRESETS = [
  "#8B5CF6",
  "#3B82F6",
  "#06B6D4",
  "#22C55E",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
] as const;

/**
 * A hex colour as the "H S% L%" triple the stylesheet expects.
 *
 * The theme variables hold bare numbers rather than a finished colour so that
 * Tailwind can build `hsl(var(--primary) / 0.5)` from them. An override has to
 * be written in the same shape or every translucent use of the accent breaks
 * while the solid ones look fine — which is the sort of bug that survives a
 * screenshot review.
 *
 * Returns null for anything that is not a colour, so a bad value falls back to
 * the theme rather than blanking the interface.
 */
export function hexToHslTriple(hex: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;

  let body = match[1];
  if (body.length === 3) {
    body = body
      .split("")
      .map((character) => character + character)
      .join("");
  }

  const r = parseInt(body.slice(0, 2), 16) / 255;
  const g = parseInt(body.slice(2, 4), 16) / 255;
  const b = parseInt(body.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    // A grey has no hue to speak of; picking one at random would make the
    // slider jump the moment someone chose white or black.
    return `0 0% ${Math.round(lightness * 100)}%`;
  }

  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;

  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  return `${hue} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

/**
 * Whether white or black reads better on top of a colour.
 *
 * Relative luminance rather than plain lightness: a saturated yellow and a
 * saturated blue can share an HSL lightness and need opposite text.
 */
export function foregroundFor(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "0 0% 100%";

  const channel = (start: number) => {
    const value = parseInt(match[1].slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.45 ? "0 0% 8%" : "0 0% 100%";
}

/** Row heights and paddings, in the order the interface reads them. */
const DENSITY_SCALE: Record<Density, number> = {
  compact: 0.88,
  comfortable: 1,
  spacious: 1.14,
};

const STORAGE_KEY = "kiza.appearance";

// Set by `applyAppearance`, drained by `writeNow`. Declared here rather than
// beside them because `getStoredAppearance` above has to consult it.
let rememberTimer: ReturnType<typeof setTimeout> | null = null;
let rememberPending: Appearance | null = null;

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
    // Only a real boolean is a decision. Anything else — absent, or a value
    // from a build before these could be left to the theme — means nobody has
    // said, and the theme is asked instead.
    translucency: typeof value.translucency === "boolean" ? value.translucency : null,
    backgroundBlur: typeof value.backgroundBlur === "boolean" ? value.backgroundBlur : null,
    reduceEffects: value.reduceEffects ?? DEFAULT_APPEARANCE.reduceEffects,
    // Validated on the way in: a stored value that is not a colour must not
    // reach the stylesheet.
    accent:
      typeof value.accent === "string" && hexToHslTriple(value.accent)
        ? value.accent
        : null,
  };
}

export function getStoredAppearance(): Appearance {
  // A preference that has been applied but not yet written down is still the
  // current preference; reading around it would hand back the colour from
  // before the last drag.
  if (rememberPending) return { ...rememberPending };
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
 * Three layers, resolved here rather than written into each other:
 *
 *     reduce effects  ─ off, and nothing else is asked
 *     the user's own  ─ a switch they have actually touched
 *     the theme's     ─ what the designer built the theme around
 *
 * "Reduce effects on modest machines" is one switch standing in front of the
 * rest. It could rewrite them, but then turning it back off would have lost
 * what the user had chosen, so it is resolved at the moment of use instead —
 * and the same reasoning is why a theme's recommendation never overwrites a
 * stored preference.
 *
 * The theme is read from the engine when one is not passed, so callers that do
 * not care about themes — most of them — need not know this layer exists.
 */
export function effectiveEffects(
  appearance: Appearance,
  theme: ThemeDefinition | null = activeTheme(),
): ThemeEffects & { animations: boolean } {
  if (appearance.reduceEffects) {
    return { animations: false, translucency: false, backgroundBlur: false };
  }
  const wanted = effectsOf(theme);
  return {
    animations: appearance.animations,
    translucency: appearance.translucency ?? wanted.translucency,
    backgroundBlur: appearance.backgroundBlur ?? wanted.backgroundBlur,
  };
}

/** Writes the preferences onto <html>, where the stylesheet reads them. */
export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  const theme = activeTheme();
  const effects = effectiveEffects(appearance, theme);

  root.style.setProperty("--kiza-density", String(DENSITY_SCALE[appearance.density]));
  root.style.setProperty("--kiza-text-scale", `${appearance.textScale / 100}`);
  root.style.setProperty("--radius", `${appearance.radius}px`);

  root.dataset.density = appearance.density;
  root.dataset.animations = effects.animations ? "on" : "off";
  root.dataset.translucency = effects.translucency ? "on" : "off";
  root.dataset.blur = effects.backgroundBlur ? "on" : "off";
  root.dataset.instanceArt = appearance.showInstanceArt ? "on" : "off";

  // A custom accent is painted over whatever theme is on screen, and letting go
  // of it puts that theme's own primary back.
  //
  // This used to delete the property and let the stylesheet show through, which
  // was right while a theme was a stylesheet rule. The theme engine writes the
  // theme onto the document instead, so deleting would not reveal Cyber's cyan
  // — it would reveal the default dark block underneath every theme, and put
  // Nebula's violet on all four of them.
  const accent = appearance.accent ? hexToHslTriple(appearance.accent) : null;
  if (accent) {
    root.style.setProperty("--primary", accent);
    root.style.setProperty("--primary-foreground", foregroundFor(appearance.accent!));
    root.style.setProperty("--ring", accent);
  } else if (theme) {
    root.style.setProperty("--primary", theme.colors.primary);
    root.style.setProperty("--primary-foreground", theme.colors["primary-foreground"]);
    root.style.setProperty("--ring", theme.colors.ring);
  } else {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
    root.style.removeProperty("--ring");
  }

  // "System" follows the OS; the other two are a deliberate override.
  const prefersLight =
    appearance.scheme === "light" ||
    (appearance.scheme === "system" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: light)").matches);
  root.classList.toggle("dark", !prefersLight);
  root.classList.toggle("light", prefersLight);

  rememberSoon(appearance);
}

/**
 * How long the accent may move before it is written down.
 *
 * `localStorage.setItem` is synchronous and disk-backed. Dragging the accent
 * pad fires a pointermove per frame, and writing the whole preferences object
 * on each one put a blocking write between every two frames of a live preview —
 * which is why choosing a colour felt like the launcher had stopped.
 *
 * The document is still updated on every move, because the document *is* the
 * preview. Only the record of it waits.
 */
const REMEMBER_DELAY_MS = 250;

function writeNow() {
  if (rememberTimer !== null) {
    clearTimeout(rememberTimer);
    rememberTimer = null;
  }
  const due = rememberPending;
  rememberPending = null;
  if (!due) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(due));
  } catch {
    // Not persisting a preference is harmless; crashing at boot is not.
  }
}

function rememberSoon(appearance: Appearance) {
  rememberPending = appearance;
  if (rememberTimer !== null) clearTimeout(rememberTimer);
  rememberTimer = setTimeout(writeNow, REMEMBER_DELAY_MS);
}

/** Writes any waiting preference immediately. */
export function flushAppearance() {
  writeNow();
}

export function initAppearance() {
  applyAppearance(getStoredAppearance());

  // A window closed while the accent was still being dragged must not lose the
  // colour that is visibly already applied.
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flushAppearance);
    window.addEventListener("beforeunload", flushAppearance);
  }
}
