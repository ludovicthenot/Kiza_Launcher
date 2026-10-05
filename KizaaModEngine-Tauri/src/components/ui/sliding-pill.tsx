import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

/**
 * The lifted pill of a segmented control, sliding to the chosen segment.
 *
 * <p>Put it first inside the control's track (which must be `relative`),
 * mark the chosen segment with `data-active="true"` and lift the segments
 * above it (`relative z-[1]`). It measures the chosen segment and moves
 * there on the drawer curve; it places itself without moving the first time,
 * so a page does not open with its controls sliding into place.
 *
 * <p>A transition, not a keyframe: clicking two segments quickly retargets it
 * from wherever it is, as a real control would.
 */
export function SlidingPill({ value, className }: { value: unknown; className?: string }) {
  const pill = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [settled, setSettled] = useState(false);

  useLayoutEffect(() => {
    const track = pill.current?.parentElement;
    if (!track) return;
    const measure = () => {
      const active = track.querySelector<HTMLElement>('[data-active="true"]');
      setBox(
        active
          ? { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight }
          : null,
      );
    };
    measure();
    // Missing outside a browser (tests); the pill is placed, it just does
    // not follow later resizes there.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [value]);

  // Turned on after the first placement, so only changes slide.
  useLayoutEffect(() => {
    if (box && !settled) {
      const frame = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [box, settled]);

  return (
    <span
      ref={pill}
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0 top-0 rounded-[8px] bg-white/[0.13] shadow-[0_1px_3px_hsl(0_0%_0%/0.3),inset_0_0.5px_0_hsl(0_0%_100%/0.12)]",
        settled && "transition-[transform,width,height] duration-300 ease-drawer motion-reduce:transition-none",
        !box && "opacity-0",
        className,
      )}
      style={box ? { transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h } : undefined}
    />
  );
}
