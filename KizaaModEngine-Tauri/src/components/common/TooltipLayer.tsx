import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** How long the pointer rests before a tip appears, and how long after one
 *  closes the next appears at once — moving along a toolbar reads every
 *  button without waiting each time, as on a Mac. */
const REST_MS = 450;
const WARM_MS = 400;
const GAP = 8;
const MARGIN = 8;

interface Tip {
  text: string;
  anchor: DOMRect;
}

/**
 * Every `title` in the window, drawn as the launcher's own tooltip.
 *
 * The browser's native tip is a grey box from another era, and the launcher
 * has close to two hundred titles. Rather than wrap each one, this listens for
 * the pointer: when it rests on something with a title, the title moves to
 * `data-tip` (so the native one never shows), and a frosted label appears
 * above it — or below, when there is no room — kept inside the window.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    let current: HTMLElement | null = null;
    let lastClosed = 0;

    const textOf = (element: HTMLElement): string | null => {
      const title = element.getAttribute("title");
      if (title !== null) {
        element.removeAttribute("title");
        if (title.trim()) {
          element.setAttribute("data-tip", title);
          // An icon-only button kept its name in the title; keep it for
          // screen readers now the title is gone.
          if (!element.hasAttribute("aria-label") && !element.textContent?.trim()) {
            element.setAttribute("aria-label", title);
          }
        } else {
          element.removeAttribute("data-tip");
        }
      }
      return element.getAttribute("data-tip");
    };

    const hide = () => {
      window.clearTimeout(timer);
      if (current) lastClosed = Date.now();
      current = null;
      setTip(null);
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = (event.target as Element | null)?.closest?.<HTMLElement>("[title], [data-tip]");
      if (!target || target === current) return;
      const text = textOf(target);
      window.clearTimeout(timer);
      if (!text) {
        if (current) hide();
        return;
      }
      const warm = current !== null || Date.now() - lastClosed < WARM_MS;
      if (current) setTip(null);
      current = target;
      timer = window.setTimeout(() => {
        if (current !== target || !target.isConnected) return;
        setTip({ text, anchor: target.getBoundingClientRect() });
      }, warm ? 0 : REST_MS);
    };

    const onOut = (event: PointerEvent) => {
      if (!current) return;
      const next = event.relatedTarget as Node | null;
      if (next && current.contains(next)) return;
      hide();
    };

    window.addEventListener("pointerover", onOver, true);
    window.addEventListener("pointerout", onOut, true);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("wheel", hide, { capture: true, passive: true });
    window.addEventListener("blur", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerover", onOver, true);
      window.removeEventListener("pointerout", onOut, true);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("wheel", hide, true);
      window.removeEventListener("blur", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);

  // Placed once its size is known: centred over the anchor, flipped below
  // when the top of the window is too close, and never past either side.
  useLayoutEffect(() => {
    if (!tip || !panel.current) {
      setPlace(null);
      return;
    }
    const { width, height } = panel.current.getBoundingClientRect();
    const { anchor } = tip;
    const below = anchor.top - height - GAP < MARGIN;
    const top = below ? anchor.bottom + GAP : anchor.top - height - GAP;
    const centre = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.min(Math.max(MARGIN, centre), window.innerWidth - width - MARGIN);
    setPlace({ left, top, below });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={panel}
      role="tooltip"
      style={place ? { left: place.left, top: place.top } : { left: -9999, top: -9999 }}
      className={
        "pointer-events-none fixed z-[300] max-w-[280px] select-none rounded-lg bg-popover/90 px-2.5 py-1.5 " +
        "text-[12px] font-medium leading-snug text-foreground/95 backdrop-blur-xl backdrop-saturate-150 " +
        "shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.1),0_8px_24px_hsl(242_30%_2%/0.55)] " +
        // A fade where it stands, as a Mac tip does: no slide, no zoom, so
        // nothing seems to fly in from the edge of the window.
        (place ? "animate-in fade-in-0 duration-150 ease-out motion-reduce:animate-none" : "opacity-0")
      }
    >
      {tip.text}
    </div>,
    document.body,
  );
}
