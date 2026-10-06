/**
 * Pointing at the real launcher.
 *
 * A transparent sheet over the launcher column, and two outlines drawn on top
 * of it. The sheet is what makes the tool safe: every click and hover lands on
 * it rather than on the launcher, so pointing at the Play button cannot launch
 * Minecraft and pointing at a card cannot select an instance. What is under
 * the cursor is found with `elementsFromPoint`, which reports the whole stack
 * regardless of what is swallowing the events.
 *
 * Nothing is duplicated and nothing is re-rendered somewhere else: the
 * outlines are two absolutely positioned boxes over components that are, and
 * stay, the launcher's own.
 *
 * The rectangles are re-measured on an animation frame while the tool is open.
 * A card can move for reasons no event announces — a list re-flowing, an image
 * arriving, a panel opening beside it — and an outline that lags behind the
 * thing it is outlining is worse than no outline. The loop runs only while the
 * tool is on, which is a mode somebody has deliberately entered.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CATALOGUE } from "../../lib/maker/catalogue";
import {
  EDITABLE_ATTRIBUTE,
  INSTANCE_ATTRIBUTE,
  type ComponentKind,
} from "../../lib/maker/editable";
import { useInspector, type Selection } from "../../lib/maker/inspector";
import { useThemeStore } from "../../lib/theme/store";
import { PART_ATTRIBUTE, partLabel } from "../../lib/theme/parts";
import { Handles } from "./Handles";
import { cn } from "../../lib/utils";

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
  /** The element's own corner, so the outline hugs a rounded card. */
  radius: number;
}

/**
 * An element's rectangle, in the sheet's own coordinates.
 *
 * `getBoundingClientRect` measures from the top-left of the window, and the
 * sheet does not start there: it covers the launcher column, which sits below
 * the title bar and beside the panel. Drawing viewport coordinates on it put
 * every outline exactly one title bar too low.
 */
function boxOf(element: Element, sheet: DOMRect): Box {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top - sheet.top,
    left: rect.left - sheet.left,
    width: rect.width,
    height: rect.height,
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
  };
}

/** Whether two rectangles are the same to the pixel. */
function identical(left: Box, right: Box): boolean {
  return (
    left.top === right.top &&
    left.left === right.left &&
    left.width === right.width &&
    left.height === right.height &&
    left.radius === right.radius
  );
}

/** The previous box when nothing moved, so React has no reason to re-render. */
function same(previous: Box | null, next: Box | null | undefined): Box | null {
  if (!next) return previous === null ? previous : null;
  return previous && identical(previous, next) ? previous : next;
}

/**
 * Every way an element can say what it is.
 *
 * Two, and the second one is the point. `data-kiza-editable` is for a
 * component that needs to name itself — a card that carries which instance it
 * is, so a move can say which card moved. But most of the launcher does not
 * need that, and asking every surface to carry an attribute *as well as* the
 * class that themes it meant two edits per component and a standing chance of
 * doing only one: an element tagged but not themed selects and then offers
 * properties that change nothing.
 *
 * So the class is the declaration. `kiza-panel` is what makes a panel read its
 * variables, and it is now also what makes a panel selectable. The two cannot
 * drift apart because they are the same fact.
 */
const SELECTOR = [
  `[${EDITABLE_ATTRIBUTE}]`,
  `[${PART_ATTRIBUTE}]`,
  ...Object.keys(CATALOGUE).map((kind) => `.kiza-${kind}`),
].join(",");

/** What kind an element declares, whichever way it declares it. */
function kindOf(element: HTMLElement): ComponentKind | null {
  const named = element.getAttribute(EDITABLE_ATTRIBUTE);
  if (named && named in CATALOGUE) return named as ComponentKind;
  for (const kind of Object.keys(CATALOGUE)) {
    if (element.classList.contains(`kiza-${kind}`)) return kind as ComponentKind;
  }
  return null;
}

/**
 * The editable component under a point, if there is one.
 *
 * An element qualifies by kind, by name, or by both. The second route is what
 * lets a designer reach what is not "one of" anything — the cube beside the
 * library title, the line of small text under it. Those have no class to style
 * as a group, and everything to place as themselves.
 */
function editableAt(x: number, y: number): Selection | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const found = element.closest(SELECTOR);
    if (!(found instanceof HTMLElement)) continue;
    const kind = kindOf(found);
    const own = found.getAttribute(PART_ATTRIBUTE);
    const wrapper = own ? null : namedWrapper(found);
    const named = own ?? wrapper?.getAttribute(PART_ATTRIBUTE) ?? null;
    if (kind || named) {
      const carrier = own ? found : wrapper;
      return {
        kind,
        part: named,
        element: found,
        instance: found.getAttribute(INSTANCE_ATTRIBUTE),
        offers: (carrier?.getAttribute("data-kiza-offers") ?? "").split(" ").filter(Boolean),
      };
    }
  }
  return null;
}

/**
 * The name of a placed wrapper that is exactly this element's size.
 *
 * Play is a styled button inside a named wrapper: the wrapper is what a
 * theme places, the button is what the pointer lands on. Taking the name
 * from a parent of the same box makes the button itself movable — and only
 * then, so a card inside a named grid does not pick up the grid's name and
 * drag the whole library along.
 */
function wrapperName(element: HTMLElement): string | null {
  return namedWrapper(element)?.getAttribute(PART_ATTRIBUTE) ?? null;
}

/** The named wrapper of exactly this element's size, if there is one. */
function namedWrapper(element: HTMLElement): HTMLElement | null {
  const wrapper = element.parentElement?.closest<HTMLElement>(`[${PART_ATTRIBUTE}]`);
  if (!wrapper) return null;
  const inner = element.getBoundingClientRect();
  const outer = wrapper.getBoundingClientRect();
  const fits =
    Math.abs(inner.left - outer.left) <= 2 &&
    Math.abs(inner.top - outer.top) <= 2 &&
    Math.abs(inner.width - outer.width) <= 4 &&
    Math.abs(inner.height - outer.height) <= 4;
  return fits ? wrapper : null;
}

/** A layout value as a number, with what the launcher does by default. */
function offset(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** How far the pointer travels before a press becomes a drag. */
const DRAG_THRESHOLD = 3;

export function Inspector() {
  const selecting = useInspector((state) => state.selecting);
  const selected = useInspector((state) => state.selected);
  const select = useInspector((state) => state.select);
  const clear = useInspector((state) => state.clear);
  const setSelecting = useInspector((state) => state.setSelecting);

  const [hover, setHover] = useState<{ label: string; box: Box; movable: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  // A press on something that can be placed: where it started, and whether
  // it has moved far enough to be a drag rather than a click.
  const drag = useRef<{ part: string; x: number; y: number; fromX: number; fromY: number; moved: boolean } | null>(null);
  // The click that ends a drag is not a click on what is under it.
  const justDragged = useRef(false);
  const [selectedBox, setSelectedBox] = useState<Box | null>(null);
  const [frame, setFrame] = useState<Box | null>(null);
  const hovered = useRef<HTMLElement | null>(null);
  const anchor = useRef<HTMLDivElement | null>(null);

  // Decorations take no clicks, except while picking: they are pointed at
  // through this attribute on <html>.
  useEffect(() => {
    if (!selecting) return;
    document.documentElement.dataset.kizaPicking = "";
    return () => {
      delete document.documentElement.dataset.kizaPicking;
    };
  }, [selecting]);

  // Escape is a staircase out: put the selection down, then put the tool down.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      // Layers, as in a drawing program: Ctrl+] forward, Ctrl+[ back, with
      // Shift all the way. On the code of the key, so it is the same keys on
      // an AZERTY keyboard, where ] and [ are typed with AltGr.
      const part = useInspector.getState().selected?.part;
      const bracket = event.code === "BracketRight" ? 1 : event.code === "BracketLeft" ? -1 : 0;
      if (part && bracket !== 0 && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const state = useThemeStore.getState();
        const current = Number(state.session?.draft.layout?.[part]?.layer ?? 0);
        const next = event.shiftKey ? bracket * 9 : Math.max(-9, Math.min(9, current + bracket));
        state.edit({ kind: "layout", part, property: "layer", value: String(next) });
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (useInspector.getState().selected) clear();
      else setSelecting(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, clear, setSelecting]);

  // Keep both outlines on the things they are outlining.
  useEffect(() => {
    if (!selecting) {
      setHover(null);
      setSelectedBox(null);
      return;
    }

    let tick = 0;
    const measure = () => {
      tick = requestAnimationFrame(measure);

      const frameRect = anchor.current?.getBoundingClientRect();
      if (!frameRect) return;
      // Where the sheet has to be. The launcher column moves whenever the
      // panel opens or the window is resized, and the sheet is no longer a
      // child of it — it is over everything, so that a dialogue the launcher
      // opened over itself can be pointed at too.
      setFrame((previous) =>
        same(previous, {
          top: frameRect.top,
          left: frameRect.left,
          width: frameRect.width,
          height: frameRect.height,
          radius: 0,
        }),
      );

      const current = useInspector.getState().selected;
      if (current && !current.element.isConnected) {
        // A card whose instance was deleted, a panel whose page was left: the
        // selection is of something that is no longer there to edit.
        clear();
      }

      // Only when it has actually moved. The loop runs at the refresh rate and
      // setting state from it unconditionally would re-render the outlines
      // sixty times a second for a launcher that is standing still — the sort
      // of cost that does not show on this desk and does on somebody's laptop.
      const stillThere = current?.element.isConnected ? current.element : null;
      setSelectedBox((previous) =>
        same(previous, stillThere && boxOf(stillThere, frameRect)),
      );

      const over = hovered.current?.isConnected ? hovered.current : null;
      setHover((previous) => {
        const box = over && boxOf(over, frameRect);
        if (!box || !over) return previous === null ? previous : null;
        const kind = kindOf(over);
        const named = over.getAttribute(PART_ATTRIBUTE) ?? wrapperName(over);
        const label = kind ? CATALOGUE[kind].name : partLabel(named);
        const movable = named !== null;
        if (previous && previous.label === label && previous.movable === movable && identical(previous.box, box)) {
          return previous;
        }
        return { label, box, movable };
      });
    };
    tick = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(tick);
  }, [selecting, clear]);

  // Always present, never visible, never in the way: this is only what the
  // sheet measures itself against.
  const anchorElement = (
    <div ref={anchor} aria-hidden className="pointer-events-none absolute inset-0" />
  );
  if (!selecting || !frame) return anchorElement;

  return (
    <>
      {anchorElement}
      {createPortal(
        <div
          data-anim="maker-inspector"
          style={{ top: frame.top, left: frame.left, width: frame.width, height: frame.height }}
          /* Over the launcher, and over anything the launcher opened over
             itself. Radix puts a dialogue at z-50 in the body, so a sheet
             inside the page could never have covered one however high its
             z-index went — and a dialogue nobody can point at is a dialogue
             nobody can restyle. */
          className={cn(
            "fixed z-[80]",
            dragging ? "cursor-grabbing" : hover?.movable ? "cursor-grab" : "cursor-crosshair",
          )}
          // Press on something that can be placed and drag: it is picked up
          // and follows the pointer in one gesture, as in a drawing program.
          // What is written is an offset from where the launcher put it, so
          // the layout underneath still does its work. Shift keeps one axis.
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const found = editableAt(event.clientX, event.clientY);
            if (!found?.part) return;
            select(found);
            const layout = useThemeStore.getState().session?.draft.layout?.[found.part];
            drag.current = {
              part: found.part,
              x: event.clientX,
              y: event.clientY,
              fromX: offset(layout?.x),
              fromY: offset(layout?.y),
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const held = drag.current;
            if (held) {
              const alongX = event.clientX - held.x;
              const alongY = event.clientY - held.y;
              if (!held.moved && Math.hypot(alongX, alongY) < DRAG_THRESHOLD) return;
              if (!held.moved) {
                held.moved = true;
                setDragging(true);
              }
              const horizontal = Math.abs(alongX) > Math.abs(alongY);
              const straight = event.shiftKey;
              const edit = useThemeStore.getState().edit;
              edit({ kind: "layout", part: held.part, property: "x", value: `${Math.round(held.fromX + (straight && !horizontal ? 0 : alongX))}px` });
              edit({ kind: "layout", part: held.part, property: "y", value: `${Math.round(held.fromY + (straight && horizontal ? 0 : alongY))}px` });
              return;
            }
            hovered.current = editableAt(event.clientX, event.clientY)?.element ?? null;
          }}
          onPointerUp={(event) => {
            if (drag.current?.moved) justDragged.current = true;
            drag.current = null;
            setDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerLeave={() => {
            if (!drag.current) hovered.current = null;
          }}
          onClick={(event) => {
            if (justDragged.current) {
              justDragged.current = false;
              return;
            }
            // The sheet already stopped this reaching the launcher; this
            // decides what it meant. A click on nothing puts the selection
            // down, which is what pointing at empty space means everywhere.
            const found = editableAt(event.clientX, event.clientY);
            if (found) select(found);
            else clear();
          }}
        >
          {/* Compared by element rather than by rectangle: two components can
              share an edge, and a hover outline drawn under the selected one
              is just a fuzzy border nobody can account for. */}
          {hover && !dragging && hovered.current !== selected?.element && (
            <Outline box={hover.box} label={hover.movable ? `${hover.label} · drag to move` : hover.label} tone="hover" />
          )}
          {selected && selectedBox && (
            <Outline
              box={selectedBox}
              label={selected.kind ? CATALOGUE[selected.kind].name : partLabel(selected.part)}
              tone="selected"
            />
          )}
          {/* The handles go over the outline, and only for something the theme
              can place: a component with no name has nowhere for a position to
              be written down. */}
          {selected?.part && selectedBox && !dragging && <Handles part={selected.part} box={selectedBox} />}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * One outline.
 *
 * Drawn outside the element's own edge rather than on it, so a card's own
 * border is still visible underneath — a designer adjusting a border needs to
 * see the border, not the tool's idea of where it is.
 */
function Outline({ box, label, tone }: { box: Box; label: string; tone: "hover" | "selected" }) {
  const selected = tone === "selected";
  return (
    <div
      className="pointer-events-none absolute"
      style={{ top: box.top - 2, left: box.left - 2, width: box.width + 4, height: box.height + 4 }}
    >
      <div
        className="absolute inset-0 transition-[background-color] duration-150"
        style={{
          // Two pixels out from the element, so its own corner plus two.
          borderRadius: box.radius ? box.radius + 2 : 6,
          boxShadow: selected
            ? "0 0 0 2px hsl(var(--primary)), 0 0 0 6px hsl(var(--primary) / 0.18)"
            : "0 0 0 1.5px hsl(var(--primary) / 0.6)",
          background: selected ? "hsl(var(--primary) / 0.06)" : "transparent",
        }}
      />
      <span
        className="absolute left-1 top-0 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-full px-2.5 py-[3px] text-[0.6875rem] font-semibold shadow-[0_4px_12px_-4px_hsl(0_0%_0%/0.6)]"
        style={{
          background: selected ? "hsl(var(--primary))" : "hsl(var(--popover) / 0.92)",
          color: selected ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
        }}
      >
        {label}
      </span>
    </div>
  );
}
