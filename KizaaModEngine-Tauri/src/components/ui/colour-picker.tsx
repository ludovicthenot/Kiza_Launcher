import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, Pipette } from "lucide-react";
import { hexToHsl, hslToHex, normaliseHex } from "../../lib/colour";
import { cn } from "../../lib/utils";

/**
 * A colour picker that belongs to the launcher.
 *
 * The accent used a plain `<input type="color">`, which on Windows opens the
 * operating system's own dialogue: a white panel with R, G and B spin boxes,
 * sitting on top of a dark launcher and looking like it escaped from another
 * program. It is also modal, so the live preview behind it cannot be seen while
 * the colour is being chosen — which is the one thing that picker was for.
 *
 * This is a popover instead. Saturation and lightness on the pad, hue on the
 * bar, hex in the field, and the launcher repaints underneath as you drag.
 */

/** Where in the pad a saturation/lightness pair sits, as fractions. */
function padPosition(s: number, l: number) {
  return { x: s / 100, y: 1 - l / 100 };
}

export function ColourPicker({
  value,
  onChange,
  label,
}: {
  /** The current colour as hex, or null to mean "following the theme". */
  value: string | null;
  onChange: (hex: string) => void;
  label: string;
}) {
  const current = value ?? "#8B5CF6";
  const hsl = hexToHsl(current) ?? { h: 258, s: 90, l: 66 };

  const [text, setText] = useState(current);
  const hexRef = useRef<HTMLInputElement>(null);

  // The field follows the colour only while nobody is typing into it. Without
  // that guard the two fight: every keystroke that forms a colour applies it,
  // which changes `current`, which rewrites the field under the cursor.
  useEffect(() => {
    if (document.activeElement !== hexRef.current) setText(current);
  }, [current]);

  const padRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const applyFromPad = (event: { clientX: number; clientY: number }) => {
    const pad = padRef.current;
    if (!pad) return;
    const box = pad.getBoundingClientRect();
    // Clamped so a pointer dragged outside the pad pins to its edge rather
    // than producing a colour that is not on it.
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    onChange(hslToHex(hsl.h, Math.round(x * 100), Math.round((1 - y) * 100)));
  };

  // Bound to the window rather than to the pad: a drag that leaves the pad
  // must keep working, and must still end when the button comes up outside it.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (dragging.current) applyFromPad(event);
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  const position = padPosition(hsl.s, hsl.l);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex items-center gap-2 rounded-lg border border-border/70 bg-secondary/25 px-2 py-1.5 transition hover:border-primary/40"
        >
          <span
            className="h-5 w-7 rounded border border-white/15"
            style={{ background: current }}
          />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {value ? value.toUpperCase() : "—"}
          </span>
        </button>
      </Popover.Trigger>

      {/* Deliberately not portalled to the document body. The picker lives
          inside the settings dialogue, and Radix's dialog treats everything
          outside its own subtree as behind the overlay — so a portalled
          popover renders in the right place, looks correct, and swallows every
          click. Keeping it in the subtree keeps it usable. */}
      <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          className="z-50 w-64 rounded-xl border border-border/80 bg-background p-3 shadow-2xl"
        >
          <div
            ref={padRef}
            role="application"
            aria-label={label}
            onPointerDown={(event) => {
              dragging.current = true;
              // So the pointer keeps reporting to this element even once it
              // leaves the pad.
              event.currentTarget.setPointerCapture(event.pointerId);
              applyFromPad(event);
            }}
            className="relative h-36 w-full cursor-crosshair rounded-lg border border-border/60"
            style={{
              background: `
                linear-gradient(to bottom, hsl(${hsl.h} 100% 100%), hsl(${hsl.h} 100% 50%), hsl(${hsl.h} 100% 0%)),
                linear-gradient(to right, hsl(${hsl.h} 0% 50%), transparent)
              `,
              backgroundBlendMode: "multiply, normal",
            }}
          >
            <span
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{
                left: `${position.x * 100}%`,
                top: `${position.y * 100}%`,
                background: current,
              }}
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span
              className="h-7 w-7 shrink-0 rounded-full border border-white/15"
              style={{ background: current }}
            />
            <input
              type="range"
              min={0}
              max={359}
              value={hsl.h}
              aria-label="Hue"
              onChange={(event) =>
                onChange(hslToHex(Number(event.target.value), hsl.s, hsl.l))
              }
              className="h-3 flex-1 cursor-pointer appearance-none rounded-full"
              style={{
                background:
                  "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
              }}
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Pipette className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={hexRef}
              value={text}
              aria-label="Hex"
              spellCheck={false}
              onChange={(event) => {
                const typed = event.target.value;
                setText(typed);
                // Applied on the sixth digit only, never on three.
                //
                // "#22C" is a perfectly valid short hex, so applying whatever
                // parses would fire halfway through someone typing "#22C55E"
                // — and, since applying rewrites the field, would leave them
                // typing into "#2222CC". Six digits is the only length that
                // cannot be a prefix of what is still being typed.
                if (/^#?[0-9a-f]{6}$/i.test(typed.trim())) {
                  const normalised = normaliseHex(typed);
                  if (normalised) onChange(normalised);
                }
              }}
              onBlur={() => {
                // On the way out, a short form is what was meant.
                const normalised = normaliseHex(text);
                if (normalised) onChange(normalised);
                else setText(current);
              }}
              className="min-w-0 flex-1 rounded-md border border-border bg-secondary/30 px-2 py-1.5 font-mono text-xs uppercase tabular-nums outline-none focus:border-primary/50"
            />
            <Popover.Close asChild>
              <button
                type="button"
                aria-label="Done"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </Popover.Close>
          </div>

          <div
            className={cn(
              "mt-2 text-[11px]",
              normaliseHex(text) ? "invisible" : "text-destructive",
            )}
          >
            Not a colour
          </div>
      </Popover.Content>
    </Popover.Root>
  );
}
