import type { RefObject } from "react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, Flip);

/** Mirrors the CSS reduced-motion guard so GSAP animations stay accessible. */
export function prefersReducedMotion(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.animations === "off"
  );
}

/**
 * True while a front page (Instances, Host) is sliding in for the first
 * time: its own entrance would play on top of the slide, so it skips it.
 */
export function arrivingSideways(): boolean {
  return document.documentElement.dataset.pageFlip === "in";
}

/**
 * A stagger that never makes the last item wait long: 40ms apart for a
 * handful, the whole group inside a third of a second for a crowd.
 */
export function staggerFor(count: number, each = 0.04, cap = 0.32): number {
  return count > 1 ? Math.min(each, cap / (count - 1)) : 0;
}

/**
 * Content that replaces other content in place (a tab, a selection) rises
 * 8px into view as it fades in: short enough to read as a response, never a
 * wait. Played on mount and whenever `key` changes; with reduced motion the
 * swap is immediate.
 */
export function useSwapIn(ref: RefObject<HTMLElement | null>, key: unknown): void {
  useGSAP(
    () => {
      if (!ref.current || prefersReducedMotion() || arrivingSideways()) return;
      gsap.fromTo(
        ref.current,
        { y: 8, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.32, ease: "power3.out", clearProps: "transform,opacity" },
      );
    },
    { dependencies: [key] },
  );
}

export { gsap, useGSAP, Flip };
