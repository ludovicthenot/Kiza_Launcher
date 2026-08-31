/**
 * What a Kiza theme is, as data.
 *
 * One shape for both kinds of theme. The four themes that ship with the
 * launcher are values of this type held in the bundle; a `.kizatheme` opened
 * from disk is parsed into the same type. Past that point nothing — not the
 * store, not the engine, not a single component — can tell where a theme came
 * from, which is the only way to avoid ending up with two theme systems.
 *
 * Colour values are HSL triplets without the `hsl()` wrapper — `"242 30% 5%"` —
 * because that is the form Tailwind's `hsl(var(--token))` reads and the form
 * every one of these values is already written in. Storing them any other way
 * would mean converting on every paint.
 */

/** Bumped when a change would make an older Kiza misread a theme. */
export const THEME_SCHEMA_VERSION = 1;

/**
 * Every colour the launcher paints with.
 *
 * These are the shadcn token names the whole component tree already consumes
 * through Tailwind. Adding one here without adding it to `App.css`'s defaults
 * would leave the launcher with a token nothing falls back to, which is why
 * the list is exhaustive rather than open.
 */
export const COLOR_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/** One of the two soft glows behind the whole window. */
export interface AmbientStop {
  /** An HSL triplet, without `hsl()`. */
  color: string;
  /** 0 to 1. The current themes sit between 0.06 and 0.10. */
  alpha: number;
}

/**
 * Pictures a theme may replace.
 *
 * Named slots rather than free-form paths: a theme says which picture goes
 * where, and the launcher decides what a slot means. That keeps a theme from
 * being able to reach at anything the launcher did not offer it.
 */
export const ASSET_SLOTS = ["logo", "logoCompact", "background"] as const;
export type AssetSlot = (typeof ASSET_SLOTS)[number];

export interface ThemeDefinition {
  schemaVersion: number;
  /** Stable, lowercase, used in storage and in a `.kizatheme` name. */
  id: string;
  name: string;
  description: string;
  author?: string;
  /** The theme's own version, not the launcher's. */
  version?: string;
  /**
   * True for the four that ship with Kiza.
   *
   * Not a permission the file carries — a `.kizatheme` claiming it would be
   * ignored — but a fact the launcher knows about its own themes, so the Maker
   * can offer "duplicate" instead of letting someone edit Nebula into
   * something that is no longer Nebula.
   */
  readOnly?: boolean;
  colors: Record<ColorToken, string>;
  ambient: readonly [AmbientStop, AmbientStop];
  /**
   * Pictures this theme replaces, by slot.
   *
   * A URL the launcher can draw: for a bundled theme that is a path Vite
   * resolved, and for a `.kizatheme` it is an object URL made from the bytes
   * that came out of the archive. A slot absent here keeps whatever Kiza ships.
   */
  assets?: Partial<Record<AssetSlot, string>>;
  /** Corner rounding in pixels. Omitted means the launcher's own default. */
  radius?: number;
}

/** Whether a value has every colour the launcher paints with. */
export function hasEveryColour(colors: Partial<Record<ColorToken, string>>): boolean {
  return COLOR_TOKENS.every((token) => typeof colors[token] === "string" && colors[token] !== "");
}
