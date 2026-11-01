/**
 * Overlay scrollbars: marks an element `data-scrolling` while it scrolls and
 * for a moment after, so its thumb shows, then lets App.css fade it out.
 *
 * One listener for the whole page, in the capture phase, since scroll events
 * do not bubble.
 */
export function initScrollbars(): void {
  const timers = new WeakMap<Element, number>();
  document.addEventListener(
    "scroll",
    (event) => {
      const target = event.target === document ? document.documentElement : event.target;
      if (!(target instanceof Element)) return;
      if (!target.hasAttribute("data-scrolling")) target.setAttribute("data-scrolling", "");
      window.clearTimeout(timers.get(target));
      timers.set(
        target,
        window.setTimeout(() => target.removeAttribute("data-scrolling"), 900),
      );
    },
    { capture: true, passive: true },
  );
}
