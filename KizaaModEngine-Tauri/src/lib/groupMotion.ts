import { gsap } from "./animation";

/**
 * A group going away in the library (ungrouped, or left with one instance):
 * its folder pops -- swells a touch, then shrinks and blurs out -- over the
 * cards coming out of it, and an open group's capsule fades and draws in
 * under them, where it was.
 *
 * Both are copies laid over the page, since the group itself is gone from
 * the grid by the next frame: the folder's on top of everything, the
 * capsule inside the grid (which is positioned and isolated) below its
 * cards.
 */
export function popGroup(folder: HTMLElement, tray: HTMLElement | null): void {
  if (tray?.parentElement) {
    const grid = tray.parentElement;
    const box = tray.getBoundingClientRect();
    const origin = grid.getBoundingClientRect();
    const capsule = document.createElement("div");
    capsule.setAttribute("aria-hidden", "true");
    const style = getComputedStyle(tray);
    Object.assign(capsule.style, {
      position: "absolute",
      left: `${box.left - origin.left - grid.clientLeft}px`,
      top: `${box.top - origin.top - grid.clientTop}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      borderRadius: style.borderRadius,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
      zIndex: "-1",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    grid.appendChild(capsule);
    gsap.to(capsule, {
      opacity: 0,
      scaleX: 0.94,
      scaleY: 0.9,
      duration: 0.45,
      ease: "power2.out",
      onComplete: () => capsule.remove(),
    });
  }

  const box = folder.getBoundingClientRect();
  const ghost = folder.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: "0",
    zIndex: "2147482990",
    pointerEvents: "none",
    transition: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(ghost);
  gsap.set(ghost, { x: box.left, y: box.top, transformOrigin: "50% 50%" });
  gsap
    .timeline({ onComplete: () => ghost.remove() })
    .to(ghost, { scale: 1.07, duration: 0.12, ease: "power2.out" })
    .to(ghost, { scale: 0.35, opacity: 0, filter: "blur(6px)", duration: 0.32, ease: "power2.in" });
}
