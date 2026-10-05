/**
 * What a theme may say about the launcher as a whole, beyond its colours.
 *
 * Three groups, each stored as a component — `components.text`, `.motion`,
 * `.layout` — beside `components.backdrop` (see `backdrop.ts`): the bag of
 * values every Kiza reads and the backend checks key by key. These are not
 * elements a designer points at; the Maker edits them in its Effects tab.
 *
 * - text.font          one of FONTS, a stack every Windows machine has
 * - text.title-weight  how heavy page titles are
 * - motion.animations  "off" to hold the launcher still (a person's own
 *                      setting still wins when it says off)
 * - motion.pace        how quickly entrances play
 * - layout.sidebar     which side of an instance its sidebar sits on
 * - layout.card-width  the narrowest a library card may be, in pixels
 * - layout.spacing     how far apart the library's cards sit
 *
 * The values are words from short lists rather than free text: each one is
 * turned into CSS here, never written as given.
 */

/** Fonts a theme may choose, and the stack each one becomes. All local. */
export const FONTS = {
  segoe: { label: "Segoe UI", stack: '"Segoe UI", "Inter", system-ui, sans-serif' },
  bahnschrift: { label: "Bahnschrift", stack: '"Bahnschrift", "Segoe UI", system-ui, sans-serif' },
  trebuchet: { label: "Trebuchet", stack: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif' },
  verdana: { label: "Verdana", stack: '"Verdana", "Segoe UI", system-ui, sans-serif' },
  georgia: { label: "Georgia", stack: '"Georgia", "Times New Roman", serif' },
  consolas: { label: "Consolas", stack: '"Consolas", "Cascadia Mono", ui-monospace, monospace' },
} as const;
export type FontChoice = keyof typeof FONTS;

export const TITLE_WEIGHTS = ["500", "600", "700", "800"] as const;

export const PACES = { calm: 0.75, normal: 1, lively: 1.35 } as const;
export type Pace = keyof typeof PACES;

export const SIDEBAR_SIDES = ["left", "right"] as const;

/** Gaps between the library's cards, across and down. */
export const SPACINGS = {
  compact: { x: 12, y: 18 },
  comfortable: { x: 20, y: 28 },
  spacious: { x: 30, y: 38 },
} as const;
export type Spacing = keyof typeof SPACINGS;

/** The keys of each group, as the backend's table lists them. */
export const GLOBAL_KEYS = {
  text: ["font", "title-weight"],
  motion: ["animations", "pace"],
  layout: ["sidebar", "card-width", "spacing"],
} as const;

/**
 * The custom properties these settings become.
 *
 * Only for values that are one of the words above; anything else is left
 * out and the launcher's own value stands.
 */
export function globalVariables(components: Record<string, Record<string, string>> | undefined): Record<string, string> {
  const variables: Record<string, string> = {};
  const text = components?.text ?? {};
  const layout = components?.layout ?? {};

  const font = FONTS[text.font as FontChoice];
  if (font) variables["--kiza-font"] = font.stack;
  if ((TITLE_WEIGHTS as readonly string[]).includes(text["title-weight"] ?? "")) {
    variables["--kiza-title-weight"] = text["title-weight"];
  }

  if (layout.sidebar === "right") variables["--kiza-sidebar-order"] = "2";
  const width = /^(\d{2,3})px$/.exec(layout["card-width"] ?? "");
  if (width && Number(width[1]) >= 120 && Number(width[1]) <= 320) {
    variables["--kiza-card-width"] = `${width[1]}px`;
  }
  const spacing = SPACINGS[layout.spacing as Spacing];
  if (spacing) {
    variables["--kiza-library-gap-x"] = `${spacing.x}px`;
    variables["--kiza-library-gap-y"] = `${spacing.y}px`;
  }
  return variables;
}
