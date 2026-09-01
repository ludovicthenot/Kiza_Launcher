/**
 * What each component lets a designer change.
 *
 * A component exposes the handful of things somebody designing a theme would
 * reach for, and nothing else. Not because the rest is secret — because a
 * panel offering forty properties, most of which do nothing visible, is a
 * panel nobody trusts. Every entry here drives a custom property that the
 * stylesheet actually reads, and the fallback beside it is what Kiza looks
 * like today, so a theme that says nothing changes nothing.
 *
 * Loaded only by the Maker. Stable knows the *names* of the kinds, because a
 * component declares itself with one; it never learns what they mean.
 *
 * The shape has room for what comes after — order, alignment, size, grid span
 * are all "a property with a control and a variable" — so adding them later is
 * a new `kind` of property here and a control for it, not a new architecture.
 */

import type { ComponentKind } from "./editable";

/** How a property is edited, and how it reaches the stylesheet. */
export type PropertyKind =
  /** An HSL triple, written straight into `hsl(…)`. */
  | "colour"
  /** A number of pixels. */
  | "length"
  /** Nought to one, for an alpha or a strength. Shown as a percentage. */
  | "alpha";

export interface EditableProperty {
  /** Becomes `--kiza-<component>-<key>`. */
  key: string;
  label: string;
  kind: PropertyKind;
  /**
   * Exactly what the stylesheet falls back to, written as it appears there.
   *
   * Often another variable: a card's border follows the theme's border colour
   * until somebody decides it should not, which is the behaviour a designer
   * expects and the reason this is not a literal.
   */
  fallback: string;
  /**
   * The theme colour this follows while it is unset.
   *
   * Only so the panel can *show* a colour rather than the text `var(--border)`.
   * The stylesheet does the actual falling back; this is how the swatch knows
   * what to paint.
   */
  follows?: string;
  /** For a length: the range the slider offers. */
  min?: number;
  max?: number;
  /** A line under the label, when the name alone would not be enough. */
  hint?: string;
}

export interface EditableComponent {
  /** What the designer sees selected, and in the panel's heading. */
  name: string;
  /** One line saying what editing this touches. */
  scope: string;
  properties: EditableProperty[];
}

export const CATALOGUE: Record<ComponentKind, EditableComponent> = {
  card: {
    name: "Instance card",
    scope: "Every instance card in the library.",
    properties: [
      {
        key: "border",
        label: "Border",
        kind: "colour",
        fallback: "var(--border)",
        follows: "border",
        hint: "The edge when the card is not the one in hand.",
      },
      { key: "border-alpha", label: "Border strength", kind: "alpha", fallback: "0.6" },
      { key: "radius", label: "Corner rounding", kind: "length", fallback: "16px", min: 0, max: 40 },
      {
        key: "glow",
        label: "Glow",
        kind: "alpha",
        fallback: "0",
        hint: "A halo in the theme's primary colour. Off by default.",
      },
    ],
  },

  panel: {
    name: "Panel",
    scope: "The surfaces the launcher lays information on.",
    properties: [
      { key: "background", label: "Background", kind: "colour", fallback: "var(--card)", follows: "card" },
      {
        key: "opacity",
        label: "Opacity",
        kind: "alpha",
        fallback: "0.55",
        hint: "How solid the surface is over whatever is behind it.",
      },
      { key: "border", label: "Border", kind: "colour", fallback: "var(--border)", follows: "border" },
      { key: "radius", label: "Corner rounding", kind: "length", fallback: "16px", min: 0, max: 40 },
    ],
  },

  action: {
    name: "Main button",
    scope: "Play, Create, and the other buttons that carry the theme's colour.",
    properties: [
      {
        key: "glow",
        label: "Glow",
        kind: "alpha",
        fallback: "0.95",
        hint: "The halo under the button, in its own colour.",
      },
    ],
  },
};

/** The custom property a value is written to. */
export function variableFor(component: ComponentKind, property: string): string {
  return `--kiza-${component}-${property}`;
}

/** Whether a kind is one the Maker knows how to edit. */
export function isEditable(value: string | null): value is ComponentKind {
  return value !== null && value in CATALOGUE;
}
