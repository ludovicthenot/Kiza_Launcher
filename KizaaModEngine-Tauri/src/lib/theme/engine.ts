/**
 * The one way Kiza applies a theme.
 *
 * A `ThemeDefinition` becomes a set of CSS custom properties on the document
 * element. That is all. Every component already reads those properties through
 * Tailwind, so changing one repaints the launcher without a rerender, without a
 * reload and without anything knowing a theme changed — which is what makes
 * live editing in the Maker possible at all.
 *
 * Before this existed the four bundled themes were stylesheet rules selected by
 * a `data-theme` attribute. That worked, but it was a second way of applying a
 * theme that a `.kizatheme` could never use, and two theme systems is the thing
 * this file exists to prevent.
 *
 * The user's own appearance settings — a custom accent, a radius — are applied
 * *after* a theme and deliberately win over it. A theme is a starting point;
 * what somebody chose in Settings is a decision.
 */

import { COLOR_TOKENS, type ThemeDefinition } from "./definition";
import { layoutStylesheet } from "./parts";

/** The variable the stylesheet reads for the glow behind the window. */
export const AMBIENT_VARIABLE = "--kiza-ambient";

/**
 * The two radial glows, written exactly as the stylesheet used to.
 *
 * The geometry is fixed and the colours come from the theme: every one of the
 * four bundled themes used these same sizes and positions, so keeping them here
 * is what makes the migration invisible rather than a redesign.
 */
export function ambientImage(theme: ThemeDefinition): string {
  const [first, second] = theme.ambient;
  return [
    `radial-gradient(60rem 32rem at 12% -12%, hsl(${first.color} / ${first.alpha}), transparent 60%)`,
    `radial-gradient(48rem 28rem at 108% 8%, hsl(${second.color} / ${second.alpha}), transparent 65%)`,
  ].join(",\n      ");
}

/**
 * Every custom property a theme sets, as a plain object.
 *
 * Separated from the writing so it can be compared in a test without a DOM,
 * and so the Maker can show what a change will produce before it is applied.
 */
export function themeVariables(theme: ThemeDefinition): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const token of COLOR_TOKENS) {
    variables[`--${token}`] = theme.colors[token];
  }
  variables["--primary-strong"] = darker(theme.colors.primary, 8);
  variables[AMBIENT_VARIABLE] = ambientImage(theme);
  if (typeof theme.radius === "number") {
    variables["--radius"] = `${theme.radius}px`;
  }

  // What a designer changed on a component, as `--kiza-<component>-<property>`.
  // The stylesheet reads each one with the launcher's own value as a fallback,
  // so a theme that mentions no component paints exactly as it did before any
  // of this existed. Values are written through untouched: this file does not
  // know what a card is, and does not need to.
  for (const [component, properties] of Object.entries(theme.components ?? {})) {
    for (const [property, value] of Object.entries(properties)) {
      variables[`--kiza-${component}-${property}`] = value;
    }
  }

  return variables;
}

/**
 * The same colour, further down.
 *
 * The launcher's main buttons are a gradient rather than a flat fill, and a
 * gradient needs two colours where a theme gives one. Taking eight points of
 * lightness off the primary is what the hand-picked violet pair was doing:
 * `violet-600` to `violet-500` is exactly that step, and deriving it means a
 * theme changing its primary changes the buttons too.
 *
 * Clamped, so a primary that is already almost black does not wrap around into
 * a lighter colour at the dark end of the gradient.
 */
function darker(triple: string, by: number): string {
  const parts = triple.trim().split(/\s+/);
  if (parts.length !== 3) return triple;
  const lightness = Number.parseFloat(parts[2]);
  if (Number.isNaN(lightness)) return triple;
  return `${parts[0]} ${parts[1]} ${Math.max(0, lightness - by)}%`;
}

/**
 * Where a theme's placement is written.
 *
 * A stylesheet rather than inline styles, because placement belongs to an
 * element the engine has no reference to — the launcher renders it, React owns
 * it, and reaching in to set a style attribute would mean the engine holding
 * on to nodes and racing every rerender. One rule per named part, replaced
 * whole when the theme changes: nothing to clean up and nothing to leak.
 */
let placement: HTMLStyleElement | null = null;

function applyLayout(theme: ThemeDefinition): void {
  const css = layoutStylesheet(theme.layout);
  if (!css) {
    placement?.remove();
    placement = null;
    return;
  }
  if (!placement) {
    placement = document.createElement("style");
    placement.dataset.kiza = "layout";
    document.head.append(placement);
  }
  placement.textContent = css;
}

/** Custom properties this engine owns, so a theme change can clear the last one. */
let applied: string[] = [];

/** The theme currently painted, for the layer that overrides it. */
let active: ThemeDefinition | null = null;

/** Everything waiting to hear that the theme changed. */
const listeners = new Set<() => void>();

/**
 * Watches for a theme change.
 *
 * The colours need no subscriber — they are custom properties and the browser
 * repaints on its own. Pictures do: an `<img src>` is a React prop, and
 * something has to tell React the answer changed. This is that, and it is
 * deliberately the smallest thing that works rather than a state library.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The theme on screen right now.
 *
 * The appearance settings paint on top of a theme — a custom accent, a chosen
 * radius — and need to know what they are painting over. Before the engine, a
 * theme was a stylesheet rule and "stop overriding" meant deleting an inline
 * property so the rule showed through. Now the theme *is* the inline property,
 * so stopping means putting the theme's own value back, and that needs this.
 */
export function activeTheme(): ThemeDefinition | null {
  return active;
}

/**
 * Paints a theme.
 *
 * Properties from the previous theme are removed first. Without that, moving
 * from a theme that sets a radius to one that does not would leave the first
 * one's radius behind — the kind of drift that only shows up after somebody has
 * clicked through four themes.
 */
export function applyTheme(theme: ThemeDefinition): void {
  const root = document.documentElement;
  const next = themeVariables(theme);

  for (const property of applied) {
    if (!(property in next)) root.style.removeProperty(property);
  }
  for (const [property, value] of Object.entries(next)) {
    root.style.setProperty(property, value);
  }
  applied = Object.keys(next);
  active = theme;
  applyLayout(theme);

  // Kept for the handful of stylesheet rules that still key on the theme, and
  // because it is the fastest way to see which theme is live in devtools.
  root.dataset.theme = theme.id;

  for (const listener of listeners) listener();
}
