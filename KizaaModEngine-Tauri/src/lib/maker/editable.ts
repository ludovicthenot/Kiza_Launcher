/**
 * How a launcher component says it can be edited.
 *
 * This is the whole of what the launcher knows about the Maker: a component
 * spreads `editable("card")` and is done. It does not import the Maker, it
 * does not know what a card exposes, and it does not change behaviour — the
 * attribute is a label the inspector reads off the DOM, nothing more.
 *
 * The meaning of "card" lives in the Maker's own catalogue, which Stable never
 * loads. That split is deliberate: the launcher carries a string, the Maker
 * carries what the string means. A component declaring itself editable costs
 * Stable one dead branch that the bundler folds away, because `IS_MAKER` is a
 * literal by then.
 */

import { IS_MAKER } from "../edition";

/**
 * The components a designer may edit.
 *
 * Deliberately few. Every kind here is a promise that the properties it
 * exposes really drive what is on screen, and a kind that half works is worse
 * than one that is not offered — so the list grows only when the styling
 * behind it has actually been routed through the variables.
 */
export const COMPONENT_KINDS = [
  "card",
  "panel",
  "action",
  "secondary",
  "button",
  "input",
  "badge",
  "dialog",
  "heading",
  "nav",
  "sidebar",
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** The attribute the inspector looks for. Exported so tests can agree on it. */
export const EDITABLE_ATTRIBUTE = "data-kiza-editable";

/**
 * Which one, for a component the launcher shows several of.
 *
 * Styling a card styles every card; moving one moves that one. The second
 * needs a name for the card that was picked up, and the only moment that name
 * is known for certain is when the component renders itself.
 */
export const INSTANCE_ATTRIBUTE = "data-kiza-instance";

const NOTHING = {} as const;

/**
 * Marks an element as something the Maker may select.
 *
 * Spread onto the element that *is* the component — the one whose border and
 * corners a designer would point at — not a wrapper around it. The inspector
 * outlines exactly what this is spread on.
 */
export function editable(kind: ComponentKind, instance?: string): Record<string, string> {
  if (!IS_MAKER) return NOTHING;
  return instance === undefined
    ? { [EDITABLE_ATTRIBUTE]: kind }
    : { [EDITABLE_ATTRIBUTE]: kind, [INSTANCE_ATTRIBUTE]: instance };
}
