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
import { CATALOGUE } from "../../lib/maker/catalogue";
import { EDITABLE_ATTRIBUTE, type ComponentKind } from "../../lib/maker/editable";
import { useInspector } from "../../lib/maker/inspector";

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

/** The editable component under a point, if there is one. */
function editableAt(x: number, y: number): { kind: ComponentKind; element: HTMLElement } | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const found = element.closest(`[${EDITABLE_ATTRIBUTE}]`);
    if (!(found instanceof HTMLElement)) continue;
    const kind = found.getAttribute(EDITABLE_ATTRIBUTE);
    if (kind && kind in CATALOGUE) return { kind: kind as ComponentKind, element: found };
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
  const hovered = useRef<HTMLElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);

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

    let frame = 0;
    const measure = () => {
      frame = requestAnimationFrame(measure);

      const frameRect = sheet.current?.getBoundingClientRect();
      if (!frameRect) return;

      const current = useInspector.getState().selected;
      if (current) {
        // A card whose instance was deleted, a panel whose page was left: the
        // selection is of something that is no longer there to edit.
        if (!current.element.isConnected) {
          clear();
          setSelectedBox(null);
        } else {
          setSelectedBox(boxOf(current.element, frameRect));
        }
      } else {
        setSelectedBox(null);
      }

      const over = hovered.current;
      setHover(
        over && over.isConnected
          ? {
              kind: over.getAttribute(EDITABLE_ATTRIBUTE) as ComponentKind,
              box: boxOf(over, frameRect),
            }
          : null,
      );
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [selecting, clear]);

  if (!selecting) return null;

  return (
    <div
      ref={sheet}
      data-anim="maker-inspector"
      className="absolute inset-0 z-40 cursor-crosshair"
      onPointerMove={(event) => {
        hovered.current = editableAt(event.clientX, event.clientY)?.element ?? null;
      }}
      onPointerLeave={() => {
        hovered.current = null;
      }}
      onClick={(event) => {
        // The sheet already stopped this reaching the launcher; this decides
        // what it meant. A click on nothing puts the selection down, which is
        // what pointing at empty space means everywhere else.
        const found = editableAt(event.clientX, event.clientY);
        if (found) select(found);
        else clear();
      }}
    >
      {hover && (!selected || hover.box.top !== selectedBox?.top || hover.box.left !== selectedBox?.left) && (
        <Outline box={hover.box} label={CATALOGUE[hover.kind].name} tone="hover" />
      )}
      {selected && selectedBox && (
        <Outline box={selectedBox} label={CATALOGUE[selected.kind].name} tone="selected" />
      )}
    </div>
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
