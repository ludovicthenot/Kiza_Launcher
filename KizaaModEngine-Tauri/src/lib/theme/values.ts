/**
 * The values a theme may give, checked where they are written.
 *
 * A theme is read and checked in the backend (`kizatheme.rs`), which is the
 * authority. This is the same rule a second time, at the one place a value
 * becomes CSS: placement is written into a stylesheet and components into
 * custom properties, and a value that reached either by any other road — a
 * draft, a test, a future import path — must still be a number or a colour,
 * never a piece of stylesheet. `x: "0px}*{background:url(…)}x{"` is the
 * sentence this file exists to refuse.
 */

import { COMPONENT_KINDS } from "../maker/editable";

/** A plain decimal: no exponent, no `NaN`, no `Infinity`. */
function decimal(text: string): number | null {
  if (!/^-?\d{1,6}(\.\d{1,4})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function measured(value: string, unit: string, low: number, high: number): boolean {
  if (!value.endsWith(unit)) return false;
  const number = decimal(value.slice(0, -unit.length));
  return number !== null && number >= low && number <= high;
}

function bounded(value: string, low: number, high: number): boolean {
  const number = decimal(value);
  return number !== null && number >= low && number <= high;
}

/** An HSL triple as Kiza writes colours: `258 90% 66%`. */
export function isColourTriple(value: string): boolean {
  const match = /^(\d{1,3}(?:\.\d+)?) (\d{1,3}(?:\.\d+)?)% (\d{1,3}(?:\.\d+)?)%$/.exec(value.trim());
  if (!match) return false;
  const [hue, saturation, lightness] = match.slice(1).map(Number);
  return hue <= 360 && saturation <= 100 && lightness <= 100;
}

/** Whether a placement value is the kind of value its key takes. */
export function isPlacementValue(key: string, value: string): boolean {
  switch (key) {
    case "x":
    case "y":
      return measured(value, "px", -2000, 2000);
    case "rotate":
      return measured(value, "deg", -360, 360);
    case "scale":
      return bounded(value, 0.2, 4);
    case "hidden":
      return value === "true" || value === "false";
    case "colour":
      return isColourTriple(value);
    case "size":
      return measured(value, "px", 6, 120);
    default:
      return false;
  }
}

/** Elements a theme may move and restyle but never take away. */
export const LOCKED_PARTS: readonly string[] = ["library.create", "library.import", "host.create"];

/** The components a theme may set variables for. */
const COMPONENTS = new Set<string>([...COMPONENT_KINDS, "backdrop"]);

/**
 * Whether a component value may be written as `--kiza-<component>-<property>`.
 *
 * The launcher does not carry the Maker's catalogue, so a value is accepted
 * if it is any of the shapes a property takes — a colour, a length, a
 * fraction, a switch — and refused if it is anything else. The backend holds
 * the exact table.
 */
export function isComponentValue(component: string, property: string, value: string): boolean {
  if (!COMPONENTS.has(component)) return false;
  if (!/^[a-z]+(-[a-z]+)*$/.test(property)) return false;
  return (
    isColourTriple(value) ||
    measured(value, "px", 0, 200) ||
    bounded(value, 0, 1) ||
    value === "on" ||
    value === "off"
  );
}
