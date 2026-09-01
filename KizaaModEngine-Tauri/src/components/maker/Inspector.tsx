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

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
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
  };
}

/** Whether two rectangles are the same to the pixel. */
function identical(left: Box, right: Box): boolean {
  return (
    left.top === right.top &&
    left.left === right.left &&
    left.width === right.width &&
    left.height === right.height
  );
}

/** The previous box when nothing moved, so React has no reason to re-render. */
function same(previous: Box | null, next: Box | null | undefined): Box | null {
  if (!next) return previous === null ? previous : null;
  return previous && identical(previous, next) ? previous : next;
}

/** The editable component under a point, if there is one. */
function editableAt(x: number, y: number): Selection | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const found = element.closest(`[${EDITABLE_ATTRIBUTE}]`);
    if (!(found instanceof HTMLElement)) continue;
    const kind = found.getAttribute(EDITABLE_ATTRIBUTE);
    if (kind && kind in CATALOGUE) {
      return {
        kind: kind as ComponentKind,
        element: found,
        instance: found.getAttribute(INSTANCE_ATTRIBUTE),
      };
    }
  }
  return null;
}

export function Inspector() {
  const selecting = useInspector((state) => state.selecting);
  const selected = useInspector((state) => state.selected);
  const select = useInspector((state) => state.select);
  const clear = useInspector((state) => state.clear);
  const setSelecting = useInspector((state) => state.setSelecting);

  const [hover, setHover] = useState<{ kind: ComponentKind; box: Box } | null>(null);
  const [selectedBox, setSelectedBox] = useState<Box | null>(null);
  const [frame, setFrame] = useState<Box | null>(null);
  const hovered = useRef<HTMLElement | null>(null);
  const anchor = useRef<HTMLDivElement | null>(null);

  // Escape is a staircase out: put the selection down, then put the tool down.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
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
        const kind = over.getAttribute(EDITABLE_ATTRIBUTE) as ComponentKind;
        if (previous && previous.kind === kind && identical(previous.box, box)) return previous;
        return { kind, box };
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
          className="fixed z-[80] cursor-crosshair"
          onPointerMove={(event) => {
            hovered.current = editableAt(event.clientX, event.clientY)?.element ?? null;
          }}
          onPointerLeave={() => {
            hovered.current = null;
          }}
          onClick={(event) => {
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
          {hover && hovered.current !== selected?.element && (
            <Outline box={hover.box} label={CATALOGUE[hover.kind].name} tone="hover" />
          )}
          {selected && selectedBox && (
            <Outline box={selectedBox} label={CATALOGUE[selected.kind].name} tone="selected" />
          )}
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
        className="absolute inset-0 rounded-[inherit]"
        style={{
          outline: selected
            ? "2px solid hsl(var(--primary))"
            : "2px dashed hsl(var(--primary) / 0.55)",
          outlineOffset: 0,
          borderRadius: 6,
          background: selected ? "hsl(var(--primary) / 0.06)" : "transparent",
        }}
      />
      <span
        className="absolute left-0 -translate-y-full whitespace-nowrap rounded-t-md px-2 py-0.5 text-[11px] font-medium"
        style={{
          top: 0,
          background: selected ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.55)",
          color: "hsl(var(--primary-foreground))",
        }}
      >
        {label}
      </span>
    </div>
  );
}
