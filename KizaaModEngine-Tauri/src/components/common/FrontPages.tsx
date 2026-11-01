import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LibraryMode } from "../../lib/store";
import { cn } from "../../lib/utils";
import { gsap, prefersReducedMotion } from "../../lib/animation";

/**
 * Whether the page this is read in is the one on screen. A page kept
 * mounted while hidden pauses what it polls (the servers' list, their
 * metrics) instead of asking the backend every few seconds for nobody.
 */
const PageShown = createContext(true);
export const usePageShown = () => useContext(PageShown);

/** Left to right, as the Instances | Host switch reads. */
const ORDER: LibraryMode[] = ["instances", "host"];

/**
 * Instances and Host as two pages side by side, the way a phone's home
 * screens are: flipping from one to the other slides the page off toward
 * where it sits, its cards sinking back one after another -- the side the
 * page leaves by first -- while the other page comes in from the opposite
 * edge. Going back runs the same path in reverse.
 *
 * Kept light on purpose: a third of a second, transform and opacity only
 * (no blur, which costs a repaint per card per frame), and a page once
 * shown stays mounted, hidden, so flipping back does not build its grid
 * again or replay its entrance on top of the slide. The header row, the
 * same on both pages, only fades, so the switch you pressed stays put.
 */
export function FrontPages({ mode, render }: { mode: LibraryMode; render: (mode: LibraryMode) => ReactNode }) {
  const [pages, setPages] = useState<{ current: LibraryMode; leaving: LibraryMode | null }>({ current: mode, leaving: null });
  const [visited, setVisited] = useState<LibraryMode[]>([mode]);
  const refs = useRef<Partial<Record<LibraryMode, HTMLDivElement | null>>>({});

  if (mode !== pages.current) {
    // Set during render: the leaving page must still be shown in the very
    // frame the new one first appears.
    setPages({ current: mode, leaving: pages.current });
    if (!visited.includes(mode)) {
      setVisited([...visited, mode]);
      // Read by the page's own entrance as it mounts (arrivingSideways).
      if (!prefersReducedMotion()) document.documentElement.dataset.pageFlip = "in";
    }
  }

  useLayoutEffect(() => {
    const { current, leaving } = pages;
    if (!leaving) return;
    const out = refs.current[leaving];
    const into = refs.current[current];
    // Hidden by hand at the end of its last exit (below); shown again now.
    if (into) into.style.visibility = "";
    const done = () => {
      delete document.documentElement.dataset.pageFlip;
      setPages((state) => (state.leaving === leaving ? { ...state, leaving: null } : state));
    };
    if (!out || !into || prefersReducedMotion()) {
      done();
      return;
    }
    // +1 when the new page sits to the right of the old one.
    const direction = ORDER.indexOf(current) > ORDER.indexOf(leaving) ? 1 : -1;
    const bodyOf = (page: HTMLElement) => {
      const root = page.firstElementChild;
      return root ? [...root.children].filter((child) => !child.matches('[data-anim="header"]')) : [];
    };
    const outHeader = out.querySelector('[data-anim="header"]');
    const outBody = bodyOf(out);
    const intoBody = bodyOf(into);

    // The leaving page's cards on screen, from the edge it leaves by; a
    // dozen or so is the wave, the rest go with the page.
    const viewport = out.getBoundingClientRect();
    const items = [...out.querySelectorAll<HTMLElement>('[data-anim="poster"], [data-server-row], [data-anim="preset"]')]
      .filter((item) => {
        const box = item.getBoundingClientRect();
        return box.bottom > viewport.top && box.top < viewport.bottom;
      })
      .sort((a, b) => (a.getBoundingClientRect().left - b.getBoundingClientRect().left) * direction)
      .slice(0, 14);

    const reset = () => gsap.set([...items, ...outBody, ...intoBody, outHeader].filter(Boolean), { clearProps: "transform,opacity" });
    const timeline = gsap.timeline({
      onComplete: () => {
        // Hidden first, then put back as it was: the other way round, it
        // showed for a frame in its old place before React hid it.
        out.style.visibility = "hidden";
        reset();
        done();
      },
    });
    if (outHeader) timeline.to(outHeader, { opacity: 0, duration: 0.14, ease: "power1.out" }, 0);
    timeline.to(items, { scale: 0.86, opacity: 0, duration: 0.2, ease: "power2.in", stagger: { amount: 0.08 } }, 0);
    timeline.to(outBody, { x: -direction * 56, scale: 0.97, opacity: 0, duration: 0.26, ease: "power2.in" }, 0.02);
    timeline.fromTo(
      intoBody,
      { x: direction * 72, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.36, ease: "expo.out" },
      0.1,
    );
    return () => {
      // Interrupted (flipped back mid-way): nothing keeps a half-gone look.
      timeline.kill();
      reset();
    };
  }, [pages]);

  return (
    <>
      {ORDER.filter((page) => visited.includes(page)).map((page) => {
        const shown = page === pages.current || page === pages.leaving;
        return (
          <div
            key={page}
            ref={(element) => {
              refs.current[page] = element;
            }}
            aria-hidden={page !== pages.current || undefined}
            inert={page !== pages.current}
            className={cn(
              "flex min-h-0 min-w-0 flex-1",
              page === pages.leaving && "pointer-events-none absolute inset-0 z-[1]",
              // Kept, not unmounted: hidden in place, its scroll and state intact.
              !shown && "invisible absolute inset-0",
            )}
          >
            <PageShown.Provider value={page === pages.current}>{render(page)}</PageShown.Provider>
          </div>
        );
      })}
    </>
  );
}
