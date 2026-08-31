import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Check, Loader2 } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { useThemeAsset } from "../../lib/theme/assets";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";

export type StartupStep = "runtime" | "setup" | "library";

/**
 * Full-screen boot experience, matching the updater overlay.
 *
 * The steps mirror work the launcher is genuinely doing, so the bar reflects
 * real progress rather than a timer: a first launch after installation has to
 * create its data folder and read its configuration, which is exactly when the
 * wait is long enough to need feedback.
 */
export function StartupOverlay({ step }: { step: StartupStep }) {
  const kizaHeader = useThemeAsset("logo");
  const { t } = useI18n();
  const [version, setVersion] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  useGSAP(() => {
    if (prefersReducedMotion()) return;
    gsap
      .timeline({ defaults: { ease: "power3.out" } })
      .from('[data-anim="startup-logo"]', {
        scale: 0.82,
        opacity: 0,
        duration: 0.6,
        ease: "back.out(1.6)",
      })
      .from('[data-anim="startup-text"] > *', { y: 10, opacity: 0, duration: 0.4, stagger: 0.08 }, "-=0.25")
      .from('[data-anim="startup-bar"]', { scaleX: 0, transformOrigin: "left center", duration: 0.45 }, "-=0.15");
    gsap.to('[data-anim="startup-logo"]', {
      scale: 1.03,
      duration: 1.6,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
      delay: 0.6,
    });
  }, { scope: overlayRef });

  const steps: Array<{ id: StartupStep; label: string }> = [
    { id: "runtime", label: t("Starting the launcher") },
    { id: "setup", label: t("Reading your configuration") },
    { id: "library", label: t("Loading your instances") },
  ];
  const currentIndex = steps.findIndex((entry) => entry.id === step);
  const percentage = Math.round(((currentIndex + 1) / steps.length) * 100);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-background"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(50rem 30rem at 50% -10%, hsl(var(--primary) / 0.14), transparent 60%), radial-gradient(40rem 24rem at 50% 115%, hsl(var(--primary) / 0.08), transparent 65%)",
        }}
      />

      <div className="relative flex w-full max-w-md flex-col items-center px-8 text-center">
        <img
          data-anim="startup-logo"
          src={kizaHeader}
          alt="Kiza Launcher"
          draggable={false}
          className="h-32 w-auto select-none drop-shadow-[0_0_24px_hsl(var(--primary)/0.35)]"
        />

        <div data-anim="startup-text" className="contents">
          <div className="mt-2 text-lg font-semibold tracking-tight">{t("Starting Kiza Launcher")}</div>
          {version && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary tabular-nums">
              {`v${version}`}
            </div>
          )}
        </div>

        <div className="mt-8 w-full">
          <div
            data-anim="startup-bar"
            className="h-2 overflow-hidden rounded-full border border-border/60 bg-secondary/40"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary shadow-[0_0_12px_hsl(var(--primary)/0.6)] transition-[width] duration-500"
              style={{ width: `${percentage}%` }}
            />
          </div>

          <ul className="mt-4 space-y-1.5 text-left">
            {steps.map((entry, index) => {
              const done = index < currentIndex;
              const active = index === currentIndex;
              return (
                <li
                  key={entry.id}
                  className={cn(
                    "flex items-center gap-2 text-xs transition-colors",
                    done && "text-muted-foreground",
                    active && "text-foreground",
                    !done && !active && "text-muted-foreground/50",
                  )}
                >
                  {done ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
                  )}
                  {entry.label}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
