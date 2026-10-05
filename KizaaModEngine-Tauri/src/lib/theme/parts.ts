/**
 * Naming one element, so a theme can say something about that one.
 *
 * Everything else in the theme system speaks about *kinds*: cards, panels,
 * fields. That is right for styling — a designer who rounds the cards means
 * all of them — and useless for placement, because "move the card" is a
 * sentence about one card. A part is the missing half: a stable name for a
 * single element in the launcher, which a theme can attach a position, a size,
 * an angle, or a plain "hide this" to.
 *
 * The name is a path — `library.title` — and it is written in the launcher,
 * not derived from the tree. A generated name would be a name that changes the
 * next time somebody wraps a div around something, and every theme that had
 * moved that element would quietly stop working.
 *
 * This lives in the launcher rather than in the Maker: a theme carrying
 * placement has to apply in Stable, or a designer would be arranging a
 * launcher nobody else ever sees. What the Maker adds is the tool that writes
 * it, not the ability to read it.
 */

/** The attribute the engine styles and the inspector looks for. */
import { isPlacementValue, LOCKED_PARTS } from "./values";

export const PART_ATTRIBUTE = "data-kiza-part";

/**
 * What a theme may say about one element.
 *
 * Deliberately loose — strings, and a bag of them — for the same reason the
 * component values are: what is worth saying about an element is the Maker's
 * business, and a theme written for a later Kiza should be readable by an
 * earlier one rather than refused. An older launcher applies the keys it
 * knows and ignores the rest.
 *
 * The keys in use today:
 *
 * - `x`, `y`      how far from where it belongs, in pixels
 * - `scale`       a multiplier, 1 being its own size
 * - `rotate`      degrees, positive clockwise
 * - `hidden`      "true" to take it off the page
 * - `colour`      an HSL triple, for text and icons
 * - `size`        a font size, for the same
 * - `layer`       -9 to 9: in front of other elements, or behind them
 * - `order`       -9 to 9: earlier or later in its row
 * - `label`       its words, for an element that offers them
 * - `icon`        its icon, by a name from `icons.ts`
 */
export type PartLayout = Record<string, string>;

/**
 * Marks an element as one a theme may place.
 *
 * Spread onto the element itself: `<h1 {...part("library.title")}>`. Costs a
 * single attribute in every edition, which is what makes a theme that moves it
 * work everywhere rather than only where the tools are.
 */
export function part(id: string, offers?: { label?: boolean; icon?: boolean }): Record<string, string> {
  const marks: Record<string, string> = { [PART_ATTRIBUTE]: id };
  // What else a theme may change on it, so the Maker can offer it: words for
  // an element drawn with `PartLabel`, an icon for one drawn with `PartIcon`.
  const can = [offers?.label && "label", offers?.icon && "icon"].filter(Boolean).join(" ");
  if (can) marks["data-kiza-offers"] = can;
  return marks;
}

/**
 * Whether a name is one we are willing to put in a stylesheet.
 *
 * The rule is generated as `[data-kiza-part="…"]`, so a name is a value that
 * ends up inside a selector. Letters, digits, dots and dashes cannot close a
 * string or open a declaration; anything else is refused rather than escaped,
 * because a theme has no reason to want it and an escaping bug here would be a
 * stylesheet written by whoever wrote the file.
 */
export function isPartName(name: string): boolean {
  return /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(name);
}

/**
 * One element's placement, as CSS declarations.
 *
 * A transform rather than a position. A translated element leaves its space
 * behind it and nothing else on the page moves, so a theme that nudges the
 * title cannot collapse the row it sits in, and the same theme at another
 * window size still lays out the way the launcher intended. That is the whole
 * argument for doing it this way instead of the obvious one: the designer
 * drags freely, and what is stored is an offset from wherever the element
 * legitimately belongs.
 *
 * `translate`, `rotate` and `scale` as properties in their own right, not as
 * one `transform`. The launcher animates its entrance with GSAP, which writes
 * `transform` inline — and an inline style beats a stylesheet, so a theme that
 * moved something would be recorded, applied, and invisible. These three
 * compose with `transform` instead of colliding with it, so the placement
 * holds and the animation still plays.
 */
export function declarationsFor(layout: PartLayout, part?: string): string {
  const rules: string[] = [];
  // Only values that are what their key takes: this text goes into a
  // stylesheet, and a value that is not a number or a colour is a rule.
  layout = Object.fromEntries(
    Object.entries(layout).filter(([key, value]) => isPlacementValue(key, value)),
  );
  if (part && LOCKED_PARTS.includes(part)) delete layout.hidden;

  const x = layout.x ?? "0px";
  const y = layout.y ?? "0px";
  const rotate = layout.rotate ?? "0deg";
  const scale = layout.scale ?? "1";
  if (x !== "0px" || y !== "0px") rules.push(`translate:${x} ${y}`);
  if (rotate !== "0deg") rules.push(`rotate:${rotate}`);
  if (scale !== "1") rules.push(`scale:${scale}`);
  const moved = rules.length > 0;
  if (moved) {
    // Around the middle, which is what a rotation handle above the top edge
    // implies. The default is the same, but a component that set its own
    // origin for an animation would otherwise turn around a corner.
    rules.push("transform-origin:center");
  }
  // Which layer it is on, as in a drawing program. A moved element comes to
  // the front by default — without that, a button dragged onto the library
  // was drawn under the cards that come after it and seemed to vanish. A
  // layer above nought is further in front; below nought is behind the page's
  // own content, though never behind the window's background (the waves sit
  // at -10, and the lowest layer is -9).
  const layer = layout.layer === undefined ? null : Number(layout.layer);
  if (layer !== null) rules.push(`z-index:${layer >= 0 ? 30 + layer : layer}`);
  else if (moved) rules.push("z-index:30");

  // Earlier or later among the things beside it, for an element in a row.
  if (layout.order !== undefined && layout.order !== "0") rules.push(`order:${layout.order}`);
  if (layout.hidden === "true") rules.push("display:none");
  if (layout.colour) rules.push(`color:hsl(${layout.colour})`);
  if (layout.size) rules.push(`font-size:${layout.size}`);

  return rules.join(";");
}

/**
 * What to call a part, for somebody pointing at it.
 *
 * `library.count` reads as "Count". The names were written to be read, so the
 * last segment is the label; better than the raw path and far better than
 * "Element".
 */
export function partLabel(id: string | null): string {
  if (!id) return "Element";
  const last = id.split(".").pop() ?? id;
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, " ");
}

/** Every part's placement, as one stylesheet. */
export function layoutStylesheet(layout: Record<string, PartLayout> | undefined): string {
  if (!layout) return "";
  const rules: string[] = [];
  for (const [name, values] of Object.entries(layout)) {
    if (!isPartName(name)) continue;
    const declarations = declarationsFor(values, name);
    if (!declarations) continue;
    rules.push(`[${PART_ATTRIBUTE}="${name}"]{${declarations}}`);
    // A z-index needs a positioned element (or a flex or grid child). Made
    // relative only when it is not already placed some other way: a sticky
    // footer turned relative would stop sticking.
    if (declarations.includes("z-index")) {
      rules.push(`[${PART_ATTRIBUTE}="${name}"]:not(.sticky):not(.absolute):not(.fixed){position:relative}`);
    }
  }
  return rules.join("\n");
}
