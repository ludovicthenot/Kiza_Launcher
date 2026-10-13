import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { bundledAsset, useThemeAsset } from "../../lib/theme/assets";
import { EDITION, EDITION_NAME } from "../../lib/edition";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";

export type StartupStep = "runtime" | "setup" | "library";

/** Long enough for the arrival to finish and be seen at rest: a fast start never flashes. */
const MIN_VISIBLE_MS = 1300;

/**
 * The launcher opening: its mark, its name, and a line of progress.
 *
 * The same arrival as the Kiza Client's loading screen, so the two read as
 * one product. Every move settles without overshoot -- nothing was thrown,
 * so nothing bounces:
 *
 * - The mark materialises: sharpening, growing its last few percent and
 *   becoming opaque together (0.55 s). The name follows 120 ms later, the
 *   version 60 ms after it, and the line draws out from its centre at 250 ms.
 * - While the launcher works, one line says what it is doing, each step
 *   crossing over the last, and a halo breathes behind the mark, so slowly it
 *   is felt more than seen.
 * - Ready, the line folds away (0.25 s, gathering speed), then the mark and
 *   the name step back a little and fade as the screen dissolves onto the
 *   launcher (0.4 s) -- leaving quicker than they came.
 *
 * The steps mirror work the launcher is genuinely doing, so the line shows
 * real progress, not a timer. With reduced motion, it all only fades.
 */
export function StartupOverlay({
  step,
  ready = false,
  onExited,
}: {
  step: StartupStep;
  ready?: boolean;
  onExited?: () => void;
}) {
  const mark = useThemeAsset("logoCompact");
  const { t } = useI18n();
  const [version, setVersion] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);
  const shownAt = useRef(performance.now());
  const leaving = useRef(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  useGSAP(
    () => {
      if (prefersReducedMotion()) {
        gsap.from(overlayRef.current?.querySelectorAll("[data-anim]") ?? [], { opacity: 0, duration: 0.3 });
        return;
      }
      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .from('[data-anim="mark"]', { opacity: 0, scale: 0.92, y: 12, filter: "blur(10px)", duration: 0.55 })
        .from('[data-anim="halo"]', { opacity: 0, scale: 0.8, duration: 0.8, ease: "power2.out" }, 0.08)
        .from('[data-anim="name"]', { opacity: 0, y: 10, filter: "blur(6px)", duration: 0.5 }, 0.12)
        .from('[data-anim="version"]', { opacity: 0, y: 8, duration: 0.45 }, 0.18)
        .from('[data-anim="line"]', { scaleX: 0, opacity: 0, duration: 0.5, ease: "power2.out" }, 0.25)
        .from('[data-anim="status"]', { opacity: 0, duration: 0.4, ease: "power1.out" }, 0.35);
      // The halo breathes, every five seconds, by a fifth.
      gsap.to('[data-anim="halo"]', {
        opacity: 0.75,
        scale: 1.06,
        duration: 2.5,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        delay: 0.9,
      });
    },
    { scope: overlayRef },
  );

  // Ready: once the arrival has been seen, leave. The exit gets a GSAP
  // context of its own, made when it starts: one made with the component is
  // remade by React's strict mode, and an exit bound to the old one never ran.
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  useEffect(() => {
    if (!ready || leaving.current) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt.current));
    let exit: gsap.Context | null = null;
    const timer = window.setTimeout(() => {
      leaving.current = true;
      exit = gsap.context(() => leave(overlayRef.current, () => onExitedRef.current?.()), overlayRef);
    }, wait);
    return () => {
      window.clearTimeout(timer);
      exit?.revert();
    };
  }, [ready]);

  const steps: Record<StartupStep, string> = {
    runtime: t("Starting the launcher"),
    setup: t("Reading your configuration"),
    library: t("Loading your instances"),
  };
  const order: StartupStep[] = ["runtime", "setup", "library"];
  const progress = ready ? 1 : (order.indexOf(step) + 1) / (order.length + 1);
  const edition = EDITION_NAME[EDITION].replace(/^Kiza\s*/, "");

  return (
    <div ref={overlayRef} className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      <div data-anim="backdrop" className="pointer-events-auto absolute inset-0 bg-background">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(50rem 30rem at 50% -10%, hsl(var(--primary) / 0.14), transparent 60%), radial-gradient(40rem 24rem at 50% 115%, hsl(var(--primary) / 0.08), transparent 65%)",
          }}
        />
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        <div className="relative">
          <div
            data-anim="halo"
            aria-hidden
            className="absolute -inset-10 rounded-full opacity-60 blur-2xl"
            style={{ background: "radial-gradient(closest-side, hsl(var(--primary) / 0.55), transparent)" }}
          />
          <img
            data-anim="mark"
            src={mark ?? "/favicon.png"}
            alt=""
            draggable={false}
            className={cn(
              "relative h-24 w-24 select-none object-contain",
              mark === bundledAsset("logoCompact") &&
                "rounded-[26px] shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.12),0_10px_30px_hsl(0_0%_0%/0.45)]",
            )}
          />
        </div>

        <div
          data-anim="name"
          className="mt-6 text-[1.75rem] font-semibold tracking-[-0.01em] text-foreground/95"
        >
          Kiza <span className="font-medium text-foreground/55">{edition}</span>
        </div>
        {version && (
          <div data-anim="version" className="mt-1.5 font-mono text-xs tabular-nums tracking-tight text-muted-foreground/80">
            {version}
          </div>
        )}

        <div data-anim="line" className="mt-9 h-0.5 w-40 overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
        <div data-anim="status" className="relative mt-3 h-4 w-64 text-xs text-muted-foreground" aria-live="polite">
          {order.map((id) => (
            <span
              key={id}
              className={cn(
                "absolute inset-0 transition-[opacity,transform] duration-300 ease-out",
                id === step ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
              )}
            >
              {steps[id]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The way out: the line folds away, gathering speed, then the mark and the
 * name step back and fade as the screen dissolves onto the launcher.
 */
function leave(root: HTMLDivElement | null, done: () => void) {
  if (!root) return done();
  if (prefersReducedMotion()) {
    gsap.to(root, { opacity: 0, duration: 0.3, ease: "power1.out", onComplete: done });
    return;
  }
  // The breathing would hold the halo up against its fade: it stops first.
  gsap.killTweensOf('[data-anim="halo"]');
  // Taking over what it animates: an arrival not finished -- a slow machine,
  // a hidden window -- would otherwise go on lighting the line back up.
  gsap
    .timeline({ onComplete: done, defaults: { ease: "power2.in", overwrite: "auto" } })
    .to('[data-anim="line"]', { scaleX: 0, opacity: 0, duration: 0.25 })
    .to('[data-anim="status"], [data-anim="version"]', { opacity: 0, duration: 0.2 }, 0)
    .to('[data-anim="halo"]', { opacity: 0, scale: 0.9, duration: 0.35 }, 0.1)
    .to('[data-anim="mark"], [data-anim="name"]', { opacity: 0, scale: 0.96, filter: "blur(4px)", duration: 0.35, stagger: 0.04 }, 0.2)
    .to('[data-anim="backdrop"]', { opacity: 0, duration: 0.4, ease: "power1.inOut" }, 0.25);
}
