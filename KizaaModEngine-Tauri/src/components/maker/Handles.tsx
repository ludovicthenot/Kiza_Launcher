/**
 * Moving, resizing and turning the thing you picked up.
 *
 * The gesture is the one from a drawing program — drag the middle to move,
 * drag a corner to resize, drag the handle above the top edge to turn — and
 * what it writes down is deliberately not what a drawing program writes down.
 *
 * A drawing program stores a position. Kiza stores an *offset*: how far this
 * element sits from wherever the launcher put it, applied with a transform. So
 * the flex and grid layout underneath goes on doing its work — the row still
 * wraps, the grid still reflows, the window still resizes — and the element
 * rides along with the place it belongs to instead of being nailed to a pixel
 * that only meant something on the desk where the theme was made.
 *
 * That is the whole trick, and it is why free placement and a launcher that
 * survives a different resolution are not in conflict here.
 *
 * Everything is written through the theme store, so a drag is undoable like
 * any other edit — and because a run of edits to the same property collapses
 * into one history entry, one drag is one Undo rather than four hundred.
 */

import { useRef } from "react";
import { RotateCw } from "lucide-react";
import { useThemeStore } from "../../lib/theme/store";

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** A layout value as a number, with what the launcher does by default. */
function number(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Where the four corners are, and which way each one resizes. */
const CORNERS = [
  { key: "nw", top: 0, left: 0, cursor: "nwse-resize" },
  { key: "ne", top: 0, left: 1, cursor: "nesw-resize" },
  { key: "sw", top: 1, left: 0, cursor: "nesw-resize" },
  { key: "se", top: 1, left: 1, cursor: "nwse-resize" },
] as const;

export function Handles({ part, box }: { part: string; box: Box }) {
  const edit = useThemeStore((state) => state.edit);
  const layout = useThemeStore((state) => state.session?.draft.layout?.[part]);

  const x = number(layout?.x, 0);
  const y = number(layout?.y, 0);
  const scale = number(layout?.scale, 1);
  const rotate = number(layout?.rotate, 0);

  // What the gesture started from. Read once at pointer-down and not again:
  // the element moves while it is being dragged, so measuring it mid-gesture
  // would feed the drag its own output and the thing would run away from the
  // pointer.
  const from = useRef({ x: 0, y: 0, value: 0, second: 0, centreX: 0, centreY: 0 });

  const centreOf = (event: React.PointerEvent) => {
    const rect = (event.currentTarget as HTMLElement)
      .closest("[data-kiza-handles]")
      ?.getBoundingClientRect();
    return rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: event.clientX, y: event.clientY };
  };

  const begin = (event: React.PointerEvent, value: number, second = 0) => {
    // Neither the launcher underneath nor the sheet's own click handler: this
    // is a gesture on something already selected, and a drag that ended up
    // selecting the element behind it would be maddening.
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const centre = centreOf(event);
    from.current = {
      x: event.clientX,
      y: event.clientY,
      value,
      second,
      centreX: centre.x,
      centreY: centre.y,
    };
  };

  const move = (event: React.PointerEvent, apply: (event: React.PointerEvent) => void) => {
    if (!(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return;
    apply(event);
  };

  return (
    <div
      data-kiza-handles
      className="absolute"
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
    >
      {/* The middle. Dragging it moves the element; Shift keeps it on one axis,
          which is how anybody nudges something without losing the alignment it
          already had. */}
      <div
        className="absolute inset-0 cursor-move"
        onPointerDown={(event) => begin(event, x, y)}
        onPointerMove={(event) =>
          move(event, () => {
            const alongX = event.clientX - from.current.x;
            const alongY = event.clientY - from.current.y;
            const straight = event.shiftKey;
            const horizontal = Math.abs(alongX) > Math.abs(alongY);
            edit({
              kind: "layout",
              part,
              property: "x",
              value: `${Math.round(from.current.value + (straight && !horizontal ? 0 : alongX))}px`,
            });
            edit({
              kind: "layout",
              part,
              property: "y",
              value: `${Math.round(from.current.second + (straight && horizontal ? 0 : alongY))}px`,
            });
          })
        }
        onClick={(event) => event.stopPropagation()}
      />

      {CORNERS.map((corner) => (
        <div
          key={corner.key}
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white bg-[hsl(var(--primary))] shadow"
          style={{
            top: `${corner.top * 100}%`,
            left: `${corner.left * 100}%`,
            cursor: corner.cursor,
          }}
          onPointerDown={(event) => begin(event, scale)}
          onPointerMove={(event) =>
            move(event, () => {
              // How much further from the middle the pointer is than when it
              // started. Uniform on purpose: a launcher component stretched on
              // one axis is a launcher component that looks broken, and the
              // things worth resizing here — a logo, a title, an icon — are
              // things whose proportions are the point.
              const was = Math.hypot(
                from.current.x - from.current.centreX,
                from.current.y - from.current.centreY,
              );
              const now = Math.hypot(
                event.clientX - from.current.centreX,
                event.clientY - from.current.centreY,
              );
              if (was < 4) return;
              const wanted = (from.current.value * now) / was;
              edit({
                kind: "layout",
                part,
                property: "scale",
                // Kept inside what a launcher can survive. Past four the
                // element is the page; under a fifth it is a dot nobody can
                // find to put back.
                value: Math.min(4, Math.max(0.2, wanted)).toFixed(3),
              });
            })
          }
          onClick={(event) => event.stopPropagation()}
        />
      ))}

      {/* Above the top edge, where a rotation handle is expected to be. */}
      <div
        className="absolute left-1/2 flex h-6 w-6 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow"
        style={{ top: -34 }}
        onPointerDown={(event) => begin(event, rotate)}
        onPointerMove={(event) =>
          move(event, () => {
            const started = Math.atan2(
              from.current.y - from.current.centreY,
              from.current.x - from.current.centreX,
            );
            const now = Math.atan2(
              event.clientY - from.current.centreY,
              event.clientX - from.current.centreX,
            );
            const degrees = from.current.value + ((now - started) * 180) / Math.PI;
            // Shift snaps to fifteen degrees, which is how somebody lands on a
            // right angle or a clean tilt instead of on -44.6.
            const wanted = event.shiftKey ? Math.round(degrees / 15) * 15 : Math.round(degrees);
            edit({ kind: "layout", part, property: "rotate", value: `${wanted}deg` });
          })
        }
        onClick={(event) => event.stopPropagation()}
      >
        <RotateCw className="h-3.5 w-3.5" />
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 h-[10px] w-px -translate-x-1/2 bg-[hsl(var(--primary))]"
        style={{ top: -10 }}
      />
    </div>
  );
}
