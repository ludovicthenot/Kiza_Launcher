import { Fragment, useEffect, useRef, useState } from "react";
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
  portal = false,
}: {
  /** The current colour as hex, or null to mean "following the theme". */
  value: string | null;
  onChange: (hex: string) => void;
  label: string;
  /**
   * Whether the popover leaves the page and renders in the body.
   *
   * Two callers, two opposite needs. In the settings dialogue it must stay
   * in the tree: Radix's dialog treats everything outside its own subtree as
   * behind the overlay, so a portalled popover would look right and swallow
   * every click. In the Maker panel it must leave, because the panel scrolls
   * and a popover left in the flow is clipped by it.
   */
  portal?: boolean;
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
  const Wrapper = portal ? Popover.Portal : Fragment;

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
      <Wrapper>
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

          <div className="mt-3 flex items-center gap-2.5">
            <span
              className="h-8 w-8 shrink-0 rounded-full border border-white/15 shadow-inner"
              style={{ background: current }}
            />
            <HueRail hue={hsl.h} onChange={(hue) => onChange(hslToHex(hue, hsl.s, hsl.l))} />
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
      </Wrapper>
    </Popover.Root>
  );
}

/**
 * The hue, as something drawn rather than something left to the platform.
 *
 * A native range input renders with the operating system's own thumb: on
 * Windows a grey ellipse over a grey groove, which is exactly the seam this
 * picker exists to remove — the pad above it is hand-drawn and the bar under
 * it looked like it had come from another program.
 *
 * What the input was doing that mattered is kept: a slider role, a value, and
 * the arrow keys, which are how somebody moves a hue by one degree rather than
 * by however many pixels their hand can hold still.
 */
function HueRail({ hue, onChange }: { hue: number; onChange: (hue: number) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const applyFrom = (event: { clientX: number }) => {
    const box = rail.current?.getBoundingClientRect();
    if (!box) return;
    const across = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    onChange(Math.round(across * 359));
  };

  // On the window, like the pad: a drag that leaves the rail keeps working and
  // still ends when the button comes up somewhere else.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (dragging.current) applyFrom(event);
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

  const step = (by: number) => onChange((hue + by + 360) % 360);

  return (
    <div
      ref={rail}
      role="slider"
      tabIndex={0}
      aria-label="Hue"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={hue}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        applyFrom(event);
      }}
      onKeyDown={(event) => {
        const by = event.shiftKey ? 10 : 1;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") step(-by);
        else if (event.key === "ArrowRight" || event.key === "ArrowUp") step(by);
        else if (event.key === "Home") onChange(0);
        else if (event.key === "End") onChange(359);
        else return;
        event.preventDefault();
      }}
      className="relative h-4 flex-1 cursor-pointer rounded-full border border-black/30 outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring/70"
      style={{
        background:
          "linear-gradient(to right, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))",
      }}
    >
      <span
        aria-hidden
        // Pulled in by half its own width at both ends, so the thumb sits on
        // the colour it points at instead of hanging off the rail at red.
        className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_4px_hsl(0_0%_0%/0.5)]"
        style={{
          left: `calc(10px + ${(hue / 359) * 100}% - ${(hue / 359) * 20}px)`,
          background: `hsl(${hue} 100% 50%)`,
        }}
      />
    </div>
  );
}
