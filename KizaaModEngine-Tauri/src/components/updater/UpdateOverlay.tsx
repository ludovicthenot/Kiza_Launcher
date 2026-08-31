import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useUpdaterStore } from "../../lib/updater";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { useThemeAsset } from "../../lib/theme/assets";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

// Lunar-style full-screen update experience: shown while the update
// downloads and while the signed installer takes over to restart.
export function UpdateOverlay() {
  const kizaHeader = useThemeAsset("logo");
  const { t } = useI18n();
  const { phase, version, progress } = useUpdaterStore();
  const [currentVersion, setCurrentVersion] = useState("");

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => setCurrentVersion(""));
  }, []);

  const visible = phase === "downloading" || phase === "installing";
  const overlayRef = useRef<HTMLDivElement>(null);

  // The overlay owns the whole screen; clear any lingering toasts under it.
  useEffect(() => {
    if (visible) toast.dismiss();
  }, [visible]);

  // Lunar-style entrance: logo settles with a glow, then the details cascade.
  // The logo keeps a soft breathing pulse while the update runs.
  useGSAP(() => {
    if (!visible || prefersReducedMotion()) return;
    gsap.timeline({ defaults: { ease: "power3.out" } })
      .from('[data-anim="update-logo"]', { scale: 0.82, opacity: 0, duration: 0.6, ease: "back.out(1.6)" })
      .from('[data-anim="update-text"] > *', { y: 10, opacity: 0, duration: 0.4, stagger: 0.08 }, "-=0.25")
      .from('[data-anim="update-bar"]', { scaleX: 0, transformOrigin: "left center", duration: 0.45 }, "-=0.15");
    gsap.to('[data-anim="update-logo"]', {
      scale: 1.03,
      duration: 1.6,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
      delay: 0.6,
    });
  }, { dependencies: [visible], scope: overlayRef });

  if (!visible) return null;

  const percentage = progress.totalBytes
    ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
    : null;
  const installing = phase === "installing";

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-background">
      {/* Ambient glow, matching the launcher's nebula background */}
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
          data-anim="update-logo"
          src={kizaHeader}
          alt="Kiza Launcher"
          draggable={false}
          className="h-32 w-auto select-none drop-shadow-[0_0_24px_hsl(var(--primary)/0.35)]"
        />

        <div data-anim="update-text" className="contents">
          <div className="mt-2 text-lg font-semibold tracking-tight">
            {installing ? t("Restarting to finish the installation...") : t("Updating Kiza Launcher")}
          </div>

          {version && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary tabular-nums">
              {currentVersion ? `v${currentVersion}` : "…"}
              <span className="text-primary/60">→</span>
              {`v${version}`}
            </div>
          )}
        </div>

        <div className="mt-8 w-full">
          <div data-anim="update-bar" className="h-2 overflow-hidden rounded-full border border-border/60 bg-secondary/40">
            <div
              className={cn(
                "h-full rounded-full bg-gradient-to-r from-primary/80 to-primary shadow-[0_0_12px_hsl(var(--primary)/0.6)] transition-[width] duration-200",
                (installing || percentage === null) && "w-full animate-pulse",
              )}
              style={installing || percentage === null ? undefined : { width: `${percentage}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
            {installing ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("The launcher will restart automatically.")}
              </span>
            ) : (
              <>
                <span>{formatBytes(progress.downloadedBytes)}</span>
                <span>
                  {progress.totalBytes
                    ? `${percentage}% / ${formatBytes(progress.totalBytes)}`
                    : t("Downloading the update...")}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
