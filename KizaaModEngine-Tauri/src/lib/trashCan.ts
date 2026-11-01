import { gsap } from "./animation";

/**
 * The trash can a held instance card can be dropped in (lib/cardDrag).
 *
 * A drawn can standing on the window's bottom edge, not an icon in a
 * badge: a glass body with ribs, a rim, and a lid hinged at its left end
 * that is free to swing above it (nothing around it clips). It answers
 * continuously rather than flipping on and off: from a few hundred pixels
 * away it starts to swell, its lid to lift and a red glow to rise behind
 * it, all in proportion to how near the card is; within reach the body
 * goes red, the lid swings wide with a wobble, and its label says what
 * letting go will do. Swallowing a card is its own little scene: the card
 * is drawn over the mouth and narrows, plunges in, the lid slams, the can
 * gulps (squashes and springs back) and a few puffs of dust escape.
 *
 * Plain values only in its tweens (numbers, rgba()): theme colours written
 * as CSS variables do not interpolate, and are set through transitions.
 */

/** Distance (px) at which the can starts to respond, and the drop reach. */
const NOTICE = 300;
const REACH = 100;

let made = 0;

/** The can, 72 by 88: lid (hinged at 8,21), mouth, body; `id` keeps its gradients its own. */
const svg = (id: string) => `
<svg width="72" height="88" viewBox="0 0 72 88" fill="none" style="overflow:visible;position:relative;display:block">
  <defs>
    <linearGradient id="${id}-glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:hsl(var(--foreground) / 0.16)" />
      <stop offset="1" style="stop-color:hsl(var(--foreground) / 0.04)" />
    </linearGradient>
    <linearGradient id="${id}-red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f87171" />
      <stop offset="1" stop-color="#b91c1c" />
    </linearGradient>
    <linearGradient id="${id}-lid" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:hsl(var(--foreground) / 0.3)" />
      <stop offset="1" style="stop-color:hsl(var(--foreground) / 0.12)" />
    </linearGradient>
  </defs>
  <g data-body>
    <path d="M11 27H61L57 78Q56.4 84 50.4 84H21.6Q15.6 84 15 78Z" style="fill:hsl(var(--card))" />
    <path d="M11 27H61L57 78Q56.4 84 50.4 84H21.6Q15.6 84 15 78Z" fill="url(#${id}-glass)" />
    <path data-red d="M11 27H61L57 78Q56.4 84 50.4 84H21.6Q15.6 84 15 78Z" fill="url(#${id}-red)" opacity="0" />
    <path d="M18.5 33L21 75" stroke="rgba(255,255,255,0.22)" stroke-width="3" stroke-linecap="round" />
    <g stroke="currentColor" stroke-opacity="0.5" stroke-width="2.4" stroke-linecap="round">
      <path d="M27.5 37L28.5 72" /><path d="M36 37V72" /><path d="M44.5 37L43.5 72" />
    </g>
    <path d="M11 27H61L57 78Q56.4 84 50.4 84H21.6Q15.6 84 15 78Z" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.2" stroke-linejoin="round" />
    <rect x="8.5" y="24.5" width="55" height="5" rx="2.5" style="fill:hsl(var(--foreground) / 0.18)" stroke="currentColor" stroke-opacity="0.3" stroke-width="1" />
    <ellipse data-mouth cx="36" cy="27" rx="24" ry="2.4" fill="rgba(0,0,0,0.6)" />
  </g>
  <g data-lid style="transform-origin:8px 21px;transform-box:view-box">
    <path d="M27.5 16.5V13a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v3.5" stroke="currentColor" stroke-opacity="0.75" stroke-width="2.4" stroke-linecap="round" />
    <rect x="6" y="16.5" width="60" height="7.5" rx="3.75" fill="url(#${id}-lid)" stroke="currentColor" stroke-opacity="0.4" stroke-width="1.1" />
    <rect x="6" y="16.5" width="60" height="7.5" rx="3.75" style="fill:hsl(var(--card))" opacity="0.55" />
    <path d="M11 18.6H50" stroke="rgba(255,255,255,0.3)" stroke-width="1.3" stroke-linecap="round" />
  </g>
</svg>`;

export interface TrashCan {
  /** Where the pointer is: returns whether a drop there would land in it, and how near (0..1). */
  track: (x: number, y: number) => { armed: boolean; nearness: number };
  /** The centre of its mouth, in window coordinates. */
  mouth: () => { x: number; y: number };
  /** Takes the card in, then goes; `then` runs once the card is inside. */
  swallow: (ghost: HTMLElement, then: () => void) => void;
  /**
   * Several cards dive in, one after another, each on an arc and spinning,
   * each with its own gulp; the lid slams on the last. `then` runs after.
   */
  swallowMany: (ghosts: HTMLElement[], then: () => void) => void;
  /** Goes back down without a card. */
  dismiss: () => void;
}

export function createTrashCan(labels: { idle: string; armed: string }): TrashCan {
  const root = document.createElement("div");
  root.setAttribute("aria-hidden", "true");
  Object.assign(root.style, {
    position: "fixed",
    left: "50%",
    bottom: "22px",
    zIndex: "2147482999",
    pointerEvents: "none",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "14px",
  } satisfies Partial<CSSStyleDeclaration>);

  // The can stands on its own: no badge around it. It grows from its foot,
  // so it swells upward, away from the window's edge.
  const body = document.createElement("div");
  Object.assign(body.style, {
    position: "relative",
    width: "72px",
    height: "88px",
    transformOrigin: "50% 100%",
    color: "hsl(var(--foreground) / 0.85)",
    filter: "drop-shadow(0 14px 18px rgba(0, 0, 0, 0.45))",
    transition: "color 220ms ease-out",
  } satisfies Partial<CSSStyleDeclaration>);

  // The red that rises behind the can as the card nears: a soft glow, not a disc.
  const fill = document.createElement("div");
  Object.assign(fill.style, {
    position: "absolute",
    left: "-34px",
    right: "-34px",
    top: "-10px",
    bottom: "-26px",
    borderRadius: "999px",
    background: "radial-gradient(closest-side, rgba(239, 68, 68, 0.75), rgba(239, 68, 68, 0.28) 55%, rgba(239, 68, 68, 0))",
    filter: "blur(10px)",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  // Its shadow on the ground.
  const shadow = document.createElement("div");
  Object.assign(shadow.style, {
    position: "absolute",
    left: "6px",
    right: "6px",
    bottom: "-7px",
    height: "12px",
    borderRadius: "999px",
    background: "radial-gradient(closest-side, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0))",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  made += 1;
  body.append(fill, shadow);
  body.insertAdjacentHTML("beforeend", svg(`kiza-trash-${made}`));
  const icon = body.querySelector("svg") as SVGSVGElement;
  const lid = body.querySelector("[data-lid]") as SVGGElement;
  const red = body.querySelector("[data-red]") as SVGPathElement;
  const opening = body.querySelector("[data-mouth]") as SVGEllipseElement;

  const label = document.createElement("span");
  label.textContent = labels.idle;
  Object.assign(label.style, {
    padding: "5px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: "600",
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
    color: "hsl(var(--foreground) / 0.85)",
    backgroundColor: "hsl(var(--background) / 0.55)",
    backdropFilter: "blur(16px)",
    border: "1px solid hsl(var(--foreground) / 0.1)",
  } satisfies Partial<CSSStyleDeclaration>);

  root.append(body, label);
  document.body.appendChild(root);

  gsap.set(fill, { scale: 0, opacity: 0 });
  gsap.fromTo(root, { xPercent: -50, y: 150, scale: 0.7, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.5, ease: "back.out(1.8)" });
  gsap.fromTo(label, { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, delay: 0.14, ease: "power2.out" });

  // Continuous answers, smoothed: each call retargets from where it is.
  const bodyScale = gsap.quickTo(body, "scale", { duration: 0.35, ease: "power3.out" });
  const lidTurn = gsap.quickTo(lid, "rotation", { duration: 0.3, ease: "power3.out" });
  const lidLift = gsap.quickTo(lid, "y", { duration: 0.3, ease: "power3.out" });
  const fillScale = gsap.quickTo(fill, "scale", { duration: 0.3, ease: "power3.out" });
  const fillOpacity = gsap.quickTo(fill, "opacity", { duration: 0.3, ease: "power3.out" });
  const redOpacity = gsap.quickTo(red, "opacity", { duration: 0.25, ease: "power2.out" });
  const mouthOpen = gsap.quickTo(opening, "scaleY", { duration: 0.3, ease: "power3.out" });
  gsap.set(opening, { transformOrigin: "50% 50%", scaleY: 0.4 });

  let armed = false;
  let gone = false;

  const setArmed = (next: boolean) => {
    armed = next;
    body.style.color = armed ? "#ffffff" : "hsl(var(--foreground) / 0.85)";
    label.textContent = armed ? labels.armed : labels.idle;
    gsap.fromTo(label, { scale: 0.92 }, { scale: 1, duration: 0.35, ease: "back.out(2.4)" });
    if (armed) gsap.fromTo(icon, { rotation: -10 }, { rotation: 0, duration: 0.6, ease: "elastic.out(1, 0.3)" });
  };

  const mouth = () => {
    const box = opening.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };

  const track = (x: number, y: number) => {
    const box = body.getBoundingClientRect();
    const distance = Math.hypot(x - (box.left + box.width / 2), y - (box.top + box.height / 2));
    const nearness = Math.max(0, Math.min(1, (NOTICE - distance) / (NOTICE - REACH)));
    const now = distance < REACH;
    if (gone) return { armed: now, nearness };
    if (now !== armed) setArmed(now);
    bodyScale(armed ? 1.18 : 1 + 0.08 * nearness);
    lidTurn(armed ? -48 : -16 * nearness * nearness);
    lidLift(armed ? -4 : -1.5 * nearness);
    mouthOpen(armed ? 1.6 : 0.4 + 0.8 * nearness);
    redOpacity(armed ? 1 : 0.25 * nearness * nearness);
    fillScale(armed ? 1.15 : 0.6 + 0.4 * nearness);
    fillOpacity(armed ? 1 : 0.5 * nearness);
    return { armed: now, nearness };
  };

  const remove = () => {
    gsap.to(root, {
      y: 150,
      scale: 0.8,
      opacity: 0,
      duration: 0.3,
      ease: "power2.in",
      onComplete: () => root.remove(),
    });
  };

  const puffs = () => {
    const { x, y } = mouth();
    for (let index = 0; index < 7; index += 1) {
      const puff = document.createElement("div");
      const size = 5 + Math.random() * 5;
      Object.assign(puff.style, {
        position: "fixed",
        left: `${x - size / 2}px`,
        top: `${y - 8 - size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "999px",
        background: "rgba(255, 255, 255, 0.75)",
        zIndex: "2147483001",
        pointerEvents: "none",
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(puff);
      // Fanned upward, from the left of the lid to its right.
      const angle = ((-160 + (140 / 6) * index + (Math.random() - 0.5) * 14) * Math.PI) / 180;
      const reach = 26 + Math.random() * 22;
      gsap.to(puff, {
        x: Math.cos(angle) * reach,
        y: Math.sin(angle) * reach,
        scale: 0.2,
        opacity: 0,
        duration: 0.55,
        ease: "power2.out",
        onComplete: () => puff.remove(),
      });
    }
  };

  const swallow = (ghost: HTMLElement, then: () => void) => {
    gone = true;
    const { x, y } = mouth();
    const width = ghost.offsetWidth;
    const height = ghost.offsetHeight;
    gsap.killTweensOf(ghost);
    // Its centre stays put as the origin moves to it.
    const box = ghost.getBoundingClientRect();
    gsap.set(ghost, {
      transformOrigin: "50% 50%",
      x: box.left + box.width / 2 - width / 2,
      y: box.top + box.height / 2 - height / 2,
    });
    gsap
      .timeline({ onComplete: () => { remove(); then(); } })
      // Over the mouth, narrowing as it is drawn in...
      .to(ghost, { x: x - width / 2, y: y - 40 - height / 2, scaleX: 0.28, scaleY: 0.36, rotation: 0, duration: 0.16, ease: "power2.out" })
      // ...and down, gone.
      .to(ghost, { y: y + 10 - height / 2, scaleX: 0.1, scaleY: 0.04, opacity: 0, duration: 0.15, ease: "power3.in", onComplete: () => ghost.remove() })
      .addLabel("in")
      .to(lid, { rotation: 0, y: 0, duration: 0.5, ease: "elastic.out(1.3, 0.35)" }, "in-=0.03")
      .to(opening, { scaleY: 0.4, duration: 0.2, ease: "power2.out" }, "in")
      .to(red, { opacity: 0, duration: 0.4, ease: "power2.out" }, "in+=0.1")
      // The gulp: squashed by the card going in, then springing back.
      .to(body, { scaleX: 1.34, scaleY: 0.96, duration: 0.08, ease: "power2.out" }, "in")
      .to(body, { scale: 1, duration: 0.55, ease: "elastic.out(1, 0.4)" }, "in+=0.08")
      .add(puffs, "in")
      .to(fill, { opacity: 0, scale: 0.6, duration: 0.35, ease: "power2.out" }, "in+=0.1")
      .to({}, { duration: 0.12 });
  };

  const swallowMany = (ghosts: HTMLElement[], then: () => void) => {
    gone = true;
    // Open and red from the start: there is no doubt where these go.
    setArmed(true);
    bodyScale(1.18);
    lidTurn(-48);
    lidLift(-4);
    mouthOpen(1.6);
    redOpacity(1);
    fillScale(1.15);
    fillOpacity(1);

    const timeline = gsap.timeline({
      // The can has to be up before the first one lands.
      delay: 0.3,
      onComplete: () => {
        remove();
        then();
      },
    });
    const { x, y } = mouth();
    const each = Math.min(0.11, 0.9 / Math.max(1, ghosts.length));
    ghosts.forEach((ghost, index) => {
      const width = ghost.offsetWidth;
      const height = ghost.offsetHeight;
      const box = ghost.getBoundingClientRect();
      const at = index * each;
      // Up over the grid, then down into the mouth: a throw, not a slide.
      const peak = Math.min(box.top, y) - 90 - Math.random() * 60;
      const spin = (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * 140);
      timeline
        .to(ghost, { x: x - width / 2, duration: 0.6, ease: "power1.inOut" }, at)
        .to(ghost, { y: peak - height / 2, duration: 0.26, ease: "power2.out" }, at)
        .to(ghost, { y: y - height / 2 + 6, duration: 0.34, ease: "power3.in" }, at + 0.26)
        .to(ghost, { scale: 0.08, rotation: spin, duration: 0.6, ease: "power2.in" }, at)
        .to(ghost, { opacity: 0, duration: 0.08, onComplete: () => ghost.remove() }, at + 0.54)
        // Each one it takes, it gulps.
        .to(body, { scaleX: 1.3, scaleY: 1.08, duration: 0.06, ease: "power2.out" }, at + 0.58)
        .to(body, { scaleX: 1.18, scaleY: 1.18, duration: 0.3, ease: "elastic.out(1, 0.5)" }, at + 0.64);
    });
    // The last is in: the lid slams, one big gulp, dust.
    timeline
      .addLabel("shut", `>-0.2`)
      .to(lid, { rotation: 0, y: 0, duration: 0.5, ease: "elastic.out(1.3, 0.35)" }, "shut")
      .to(opening, { scaleY: 0.4, duration: 0.2, ease: "power2.out" }, "shut")
      .to(red, { opacity: 0, duration: 0.4, ease: "power2.out" }, "shut+=0.1")
      .to(body, { scaleX: 1.36, scaleY: 0.94, duration: 0.08, ease: "power2.out" }, "shut")
      .to(body, { scale: 1, duration: 0.6, ease: "elastic.out(1, 0.4)" }, "shut+=0.08")
      .add(puffs, "shut")
      .to(fill, { opacity: 0, scale: 0.6, duration: 0.35, ease: "power2.out" }, "shut+=0.1")
      .to({}, { duration: 0.15 });
  };

  return { track, mouth, swallow, swallowMany, dismiss: remove };
}
