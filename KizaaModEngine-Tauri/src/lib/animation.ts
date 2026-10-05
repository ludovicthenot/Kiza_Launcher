import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** Mirrors the CSS reduced-motion guard so GSAP animations stay accessible. */
export function prefersReducedMotion(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.animations === "off"
  );
}

/**
 * A stagger that never makes the last item wait long: 40ms apart for a
 * handful, the whole group inside a third of a second for a crowd.
 */
export function staggerFor(count: number, each = 0.04, cap = 0.32): number {
  return count > 1 ? Math.min(each, cap / (count - 1)) : 0;
}

export { gsap, useGSAP };
