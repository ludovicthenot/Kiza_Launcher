import { gsap, prefersReducedMotion } from "./animation";
import { useMissingMods } from "./missingMods";

/**
 * A modpack that has just become an instance flies home.
 *
 * Its logo leaves the catalogue's page as the catalogue closes, crosses the
 * window on an arc, and lands where the new instance's card sits in the
 * library; the landing sends a ripple through the grid, the way a drop
 * spreads on water. One motion that says where the pack went, instead of a
 * dialog that vanishes and a card that is simply there.
 *
 * Built from four beats, each on its own curve:
 *
 * 1. **Lift** -- the logo grows a little and tilts as its shadow deepens: it
 *    comes off the page.
 * 2. **Flight** -- x and y are separate tweens (a quadratic arc, its peak
 *    above the straight line), so the path curves like a throw rather than
 *    sliding; size and corner radius morph to the card's tile on the way.
 * 3. **Landing** -- a squash on impact, then a spring back; the card fades in
 *    around the logo, which hands over to it.
 * 4. **Ripple** -- two rings spread from the impact, and every other card is
 *    pushed out and springs back, later and weaker with distance.
 *
 * With reduced motion there is no flight: the new card just glows once.
 *
 * The mods a pack could not download open their dialog once all this is
 * over, rather than covering the flight; and the new card is chosen as it
 * lands, as a click on it would.
 */

/** Where the logo was when the install finished. */
export interface PackLogo {
  src: string;
  rect: DOMRect;
  radius: number;
}

/**
 * The catalogue page's logo, measured before the catalogue closes. The
 * project page and the side panel both mark theirs; the visible one wins.
 */
export function capturePackLogo(): PackLogo | null {
  const candidates = [...document.querySelectorAll<HTMLImageElement>("img[data-pack-logo]")];
  for (const image of candidates.reverse()) {
    const rect = image.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    const frame = image.parentElement ?? image;
    const radius = parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 16;
    // The page's own copy goes as the flying one takes its place.
    image.style.visibility = "hidden";
    return { src: image.currentSrc || image.src, rect, radius };
  }
  return null;
}

/** Waits, frame by frame, for the new instance's card to be in the page. */
function waitForCard(instanceId: string, timeoutMs: number): Promise<HTMLElement | null> {
  const selector = `[data-instance-poster="${CSS.escape(instanceId)}"]`;
  const started = performance.now();
  return new Promise((resolve) => {
    const look = () => {
      const card = document.querySelector<HTMLElement>(selector);
      if (card && card.getBoundingClientRect().width > 0) return resolve(card);
      if (performance.now() - started > timeoutMs) return resolve(null);
      requestAnimationFrame(look);
    };
    look();
  });
}

/** The card's picture frame (the 3:4 box), not its caption. */
function frameOf(card: HTMLElement): HTMLElement {
  return card.querySelector<HTMLElement>(".kiza-card") ?? card;
}

/**
 * Keeps the new card's picture hidden from the moment it enters the page:
 * otherwise it shows its logo before the flying one arrives. A stylesheet
 * rule rather than an inline style, since the card does not exist yet.
 */
function hideCardUntilLanding(instanceId: string): () => void {
  const style = document.createElement("style");
  style.textContent = `[data-instance-poster="${CSS.escape(instanceId)}"] .kiza-card { opacity: 0 !important; }`;
  document.head.appendChild(style);
  return () => style.remove();
}

export async function flyPackHome(logo: PackLogo | null, instanceId: string): Promise<void> {
  const reduced = prefersReducedMotion();
  // The card is in the library behind the closing dialog; the list has to
  // refetch before it exists, which takes a moment.
  const cardPromise = waitForCard(instanceId, 6000);

  // Held back until the landing is over (see above).
  const missing = useMissingMods.getState();
  const held = missing.mods.length > 0 ? { instanceId: missing.instanceId, mods: missing.mods } : null;
  if (held) missing.dismiss();
  const release = () => {
    if (held?.instanceId) useMissingMods.getState().show(held.instanceId, held.mods);
  };

  if (!logo || reduced) {
    const card = await cardPromise;
    if (card) {
      card.click();
      glow(frameOf(card), reduced);
    }
    release();
    return;
  }

  const unhide = hideCardUntilLanding(instanceId);

  // The flying copy lives above everything, outside React: it outlasts the
  // dialog it starts in. Its shadow is a drop-shadow, which follows the
  // logo's own shape: a round logo with clear corners casts a round one.
  const flyer = document.createElement("div");
  flyer.setAttribute("aria-hidden", "true");
  Object.assign(flyer.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${logo.rect.width}px`,
    height: `${logo.rect.height}px`,
    borderRadius: `${logo.radius}px`,
    zIndex: "2147483000",
    pointerEvents: "none",
    willChange: "transform, width, height, filter",
    backgroundImage: `url("${logo.src}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    filter: "drop-shadow(0 8px 14px rgb(0 0 0 / 0.55))",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(flyer);
  gsap.set(flyer, { x: logo.rect.left, y: logo.rect.top, transformOrigin: "50% 50%" });

  // 1. Lift, while the catalogue closes behind it.
  const lift = gsap.to(flyer, {
    scale: 1.14,
    rotation: -5,
    y: logo.rect.top - 14,
    filter: "drop-shadow(0 26px 30px rgb(0 0 0 / 0.6))",
    duration: 0.42,
    ease: "power3.out",
  });

  const card = await cardPromise;
  await lift;
  if (!card) {
    gsap.to(flyer, { opacity: 0, scale: 0.9, duration: 0.3, ease: "power2.in", onComplete: () => flyer.remove() });
    unhide();
    release();
    return;
  }

  const frame = frameOf(card);
  frame.scrollIntoView({ block: "nearest", inline: "nearest" });
  const target = frame.getBoundingClientRect();
  // The logo lands where the card draws it: the centred square tile, 78% of
  // the card's width (InstancePoster's logo layout).
  const tile = target.width * 0.78;
  const end = {
    x: target.left + (target.width - tile) / 2,
    y: target.top + (target.height - tile) / 2,
    size: tile,
  };
  const frameRadius = parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 18;

  // The card waits, invisible, for the logo to arrive: inline now, so the
  // stylesheet rule can go and the landing can fade it in.
  gsap.set(frame, { opacity: 0, scale: 0.94 });
  unhide();

  // 2. Flight: an arc whose peak sits above the higher of the two ends.
  const start = { x: logo.rect.left, y: logo.rect.top - 14, size: logo.rect.width };
  const peakY = Math.min(start.y, end.y) - Math.max(80, Math.abs(end.x - start.x) * 0.18);
  const path = { t: 0 };
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const flight = Math.min(1.05, Math.max(0.62, distance / 1500));
  const direction = Math.sign(end.x - start.x) || 1;

  const timeline = gsap.timeline();
  timeline.to(path, {
    t: 1,
    duration: flight,
    ease: "power2.inOut",
    onUpdate: () => {
      const t = path.t;
      const u = 1 - t;
      // Quadratic Bézier: start, a control point over the middle, end.
      const x = u * u * start.x + 2 * u * t * ((start.x + end.x) / 2) + t * t * end.x;
      const y = u * u * start.y + 2 * u * t * peakY + t * t * end.y;
      const size = start.size + (end.size - start.size) * t;
      gsap.set(flyer, {
        x,
        y,
        width: size,
        height: size,
        // Leans into the turn, then straightens for the landing.
        rotation: -5 + 5 * t + direction * 9 * Math.sin(Math.PI * t),
        scale: 1.14 - 0.14 * t,
        borderRadius: logo.radius + (size * 0.14 - logo.radius) * t,
      });
    },
  });

  // 3. Landing: squash on impact, spring back, the card appears around it.
  timeline.addLabel("impact");
  timeline.to(flyer, { scaleX: 1.08, scaleY: 0.9, duration: 0.09, ease: "power2.out", transformOrigin: "50% 100%" }, "impact");
  timeline.to(flyer, { scaleX: 1, scaleY: 1, duration: 0.55, ease: "elastic.out(1, 0.45)" }, "impact+=0.09");
  timeline.to(frame, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.6)", clearProps: "opacity,transform" }, "impact");
  timeline.to(
    flyer,
    {
      opacity: 0,
      filter: "drop-shadow(0 0px 0px rgb(0 0 0 / 0))",
      duration: 0.35,
      ease: "power1.out",
      onComplete: () => flyer.remove(),
    },
    "impact+=0.32",
  );
  timeline.call(
    () => {
      card.click();
      ripple(frame, frameRadius);
    },
    undefined,
    "impact",
  );
  // The wave has crossed the grid by then.
  timeline.call(release, undefined, "impact+=1.1");
}

/** The drop's rings, and the grid giving way around it. */
function ripple(frame: HTMLElement, radius: number) {
  const center = frame.getBoundingClientRect();
  const cx = center.left + center.width / 2;
  const cy = center.top + center.height / 2;

  // The rings spread under the cards, as a wave under floating leaves: they
  // are drawn inside the grid, below its cards (z-index -1 in a stacking
  // context of the grid's own, so above whatever is behind the grid).
  const grid = frame.closest<HTMLElement>("[data-instance-poster]")?.parentElement ?? null;
  const box = grid?.getBoundingClientRect();
  const restore = grid
    ? { position: grid.style.position, isolation: grid.style.isolation }
    : null;
  if (grid && getComputedStyle(grid).position === "static") grid.style.position = "relative";
  if (grid) grid.style.isolation = "isolate";
  let left = 2;

  for (const [index, delay] of [0, 0.14].entries()) {
    const ring = document.createElement("div");
    ring.setAttribute("aria-hidden", "true");
    Object.assign(ring.style, {
      position: grid ? "absolute" : "fixed",
      left: `${center.left - (box ? box.left + (grid?.clientLeft ?? 0) : 0)}px`,
      top: `${center.top - (box ? box.top + (grid?.clientTop ?? 0) : 0)}px`,
      width: `${center.width}px`,
      height: `${center.height}px`,
      borderRadius: `${radius}px`,
      border: `${index === 0 ? 2 : 1.5}px solid hsl(var(--primary) / 0.75)`,
      boxShadow: "0 0 24px hsl(var(--primary) / 0.45)",
      zIndex: grid ? "-1" : "2147482999",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    (grid ?? document.body).appendChild(ring);
    gsap.fromTo(
      ring,
      { scale: 1, opacity: 0.9 },
      {
        scale: 2.6 + index * 0.6,
        opacity: 0,
        borderRadius: `${radius * 3}px`,
        duration: 1.1,
        delay,
        ease: "power2.out",
        onComplete: () => {
          ring.remove();
          left -= 1;
          if (left === 0 && grid && restore) {
            grid.style.position = restore.position;
            grid.style.isolation = restore.isolation;
          }
        },
      },
    );
  }

  // The other cards: pushed away from the impact and back, the wave reaching
  // each one later (distance / speed) and weaker (an exponential fall-off).
  const cards = [...document.querySelectorAll<HTMLElement>("[data-instance-poster]")]
    .map((card) => card.querySelector<HTMLElement>(".kiza-card") ?? card)
    .filter((card) => card !== frame);
  const speed = 1500; // px per second
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    if (box.bottom < 0 || box.top > window.innerHeight) continue;
    const dx = box.left + box.width / 2 - cx;
    const dy = box.top + box.height / 2 - cy;
    const distance = Math.hypot(dx, dy) || 1;
    const strength = 18 * Math.exp(-distance / 520);
    if (strength < 0.6) continue;
    const delay = distance / speed;
    gsap
      .timeline({ delay })
      .to(card, {
        x: (dx / distance) * strength,
        y: (dy / distance) * strength,
        scale: 1 - strength / 260,
        duration: 0.16,
        ease: "power2.out",
      })
      .to(card, { x: 0, y: 0, scale: 1, duration: 0.85, ease: "elastic.out(1, 0.38)", clearProps: "transform" });
  }
}

/** Reduced motion, or no logo to fly: the new card glows once. */
function glow(frame: HTMLElement, reduced: boolean) {
  frame.scrollIntoView({ block: "nearest", inline: "nearest" });
  gsap.fromTo(
    frame,
    { boxShadow: "0 0 0 3px hsl(var(--primary) / 0.9), 0 0 40px hsl(var(--primary) / 0.6)" },
    { boxShadow: "0 0 0 0px hsl(var(--primary) / 0), 0 0 0px hsl(var(--primary) / 0)", duration: reduced ? 1.2 : 0.9, ease: "power1.out", clearProps: "boxShadow" },
  );
}
