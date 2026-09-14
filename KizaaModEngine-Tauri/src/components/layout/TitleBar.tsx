import { getCurrentWindow } from "@tauri-apps/api/window";
import { AlertTriangle, Minus, Square, X, Settings, Download, Loader2 } from "lucide-react";
import { useAppStore } from "../../lib/store";
import { AccountMenu } from "./AccountMenu";
import { getVersion } from "@tauri-apps/api/app";
import { useState, useEffect, useRef } from "react";
import { useI18n } from "../../lib/i18n";
import { useUpdaterStore } from "../../lib/updater";
import { isTauri } from "@tauri-apps/api/core";
import { doorShut, titleCase, useAccess } from "../../lib/access";
import { cn } from "../../lib/utils";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";

// One-click update: download when needed, then install and restart.
async function runFullUpdateFlow() {
  const store = useUpdaterStore.getState();
  if (store.phase === "available") {
    await store.downloadUpdate();
  }
  const after = useUpdaterStore.getState();
  if (after.phase === "ready" || after.phase === "deferred") {
    await after.installUpdate();
  }
}

/**
 * The buttons at the right end of the bar — settings, minimise,
 * maximise, close — share one shape, so the eye reads them as one row of
 * controls rather than one styled button and three bare icons.
 */
const roundControl = cn(
  "flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-secondary/30",
  "text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground cursor-pointer",
);

export function TitleBar() {
  const appWindow = getCurrentWindow();
  const { t } = useI18n();
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const updaterPhase = useUpdaterStore((state) => state.phase);
  const updaterProgress = useUpdaterStore((state) => state.progress);
  const [version, setVersion] = useState("");
  const channel = useAccess((state) => state.channel);

  // The badge said "Alpha" on every launcher ever built, because the word was
  // written into it. It is the one place a person can check which stream they
  // are on, so saying the same thing to everybody made it worse than useless:
  // somebody on Stable read "Alpha" and believed it.
  //
  // Asked here rather than waited for. The gate resolves this too, but the
  // title bar is drawn before the gate has decided anything and a badge that
  // appears a beat late is better than one that appears wrong.
  useEffect(() => {
    if (channel === null) void useAccess.getState().resolveChannel();
  }, [channel]);

  // A development build says so, and that is decided by how it was built rather
  // than by where it is running. `import.meta.env.DEV` is true under the vite
  // dev server -- `npm run dev` in a browser and `npm run tauri dev` in a
  // window alike -- and false in anything that came out of a bundle. Checking
  // only for a browser would have left `tauri dev` reading its config and
  // reporting a channel, which is the answer for an installed launcher and not
  // for one being worked on.
  const developing = import.meta.env.DEV || !isTauri();
  // "Kiza Teams" rather than "Dev": the badge names who is holding the build,
  // and the only people holding one that came off the development server are
  // the ones making it. It also reads as a name beside the version rather than
  // as a warning, which is what it is -- nothing is wrong with this launcher,
  // it simply follows no released channel.
  const stream = developing ? "Kiza Teams" : channel === null ? null : titleCase(channel);

  // The title bar sits outside the access gate so that somebody who cannot get
  // in can still close the window. That is the whole reason it is out there --
  // and it means everything else in this bar has to know when the door is
  // shut, or the gate is a screen with a settings button next to it.
  //
  // Not known yet counts as shut. A slow read is otherwise a window somebody
  // can click through, and the launcher behind this bar is not on screen then
  // anyway.
  const barred = doorShut(useAccess((state) => state.status), useAccess((state) => state.channel)) !== false;

  const updaterError = useUpdaterStore((state) => state.error);
  const failedAction = useUpdaterStore((state) => state.failedAction);
  // Only a failed check, not a failed download. A download that fell over is
  // already visible as a stalled button; a check that fell over is visible as
  // nothing at all, which is the case worth surfacing.
  const checkFailed = updaterPhase === "error" && failedAction === "check";

  const updateBusy = updaterPhase === "downloading" || updaterPhase === "installing";
  const updateVisible =
    updaterPhase === "available" || updaterPhase === "ready" || updaterPhase === "deferred" || updateBusy;
  const updatePercent = updaterProgress.totalBytes
    ? Math.min(100, Math.round((updaterProgress.downloadedBytes / updaterProgress.totalBytes) * 100))
    : null;

  // Pop the Update pill in when it appears, then keep a soft attention pulse
  // until the user acts on it.
  const updateButtonRef = useRef<HTMLButtonElement>(null);
  useGSAP(() => {
    const button = updateButtonRef.current;
    if (!button || !updateVisible || updateBusy || prefersReducedMotion()) return;
    gsap.from(button, { scale: 0.5, opacity: 0, duration: 0.45, ease: "back.out(2)" });
    gsap.to(button, {
      scale: 1.06,
      duration: 0.9,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
      delay: 0.45,
    });
  }, { dependencies: [updateVisible, updateBusy] });

  useEffect(() => {
    getVersion().then((found) => setVersion(`v${found}`));
  }, []);

  return (
    <div 
      // Glass, not a lid: mostly transparent, blurred hard, so the backdrop's
      // glow and whatever scrolls under it show through softened.
      className="absolute inset-x-0 top-0 z-50 flex h-14 select-none items-center justify-between border-b border-white/[0.06] bg-background/30 shadow-[0_1px_0_hsl(var(--primary)/0.08)] backdrop-blur-2xl backdrop-saturate-150"
      onMouseDown={() => appWindow.startDragging()}
    >
      <div className="flex items-center gap-3 px-4">
        <span className="pointer-events-none font-bold text-sm tracking-wide text-primary">Kiza Launcher</span>
        {/* Frosted, and still the accent: the tint stays purple, the glass
            lets the backdrop's glow through, the halo sits under it. */}
        <span className="pointer-events-none inline-flex h-7 items-center gap-1.5 rounded-lg border border-primary/40 bg-gradient-to-b from-primary/25 to-primary/10 px-3 text-xs font-medium text-primary shadow-[0_0_18px_-2px_hsl(var(--primary)/0.55),inset_0_1px_0_hsl(0_0%_100%/0.08)] backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.9)]" />
            {stream ? `${version} ${stream}` : version}
        </span>
        {/* A check that failed says so, next to the version it failed to
            replace. This lived only in the settings panel, which is a place
            somebody opens when they already suspect a problem -- and the whole
            failure here is that they do not: the launcher looks up to date. */}
        {checkFailed && !barred && (
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setShowSettings(true)}
            title={updaterError ?? t("The update check did not go through.")}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full border border-amber-500/40",
              "bg-amber-500/10 px-2.5 text-[11px] font-semibold text-amber-300",
              "transition hover:bg-amber-500/20 active:scale-[0.96]",
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            {t("Not updating")}
          </button>
        )}
        {updateVisible && !barred && (
          <button
            ref={updateButtonRef}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void runFullUpdateFlow()}
            disabled={updateBusy}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground",
              "shadow-[0_0_10px_hsl(var(--primary)/0.45)] transition hover:bg-primary/90 active:scale-[0.96]",
              updateBusy && "cursor-default opacity-80",
            )}
            title={t("Update and restart the launcher")}
          >
            {updateBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {updaterPhase === "downloading" && updatePercent !== null ? `${updatePercent}%` : t("Update")}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 pr-3">
         {!barred && (
           <>
             <AccountMenu />

             <div
                className="flex items-center"
                onMouseDown={(e) => e.stopPropagation()}
             >
                 <button
                   onClick={() => setShowSettings(true)}
                   className={cn(roundControl, "hover:text-primary")}
                   title={t("Settings")}
                 >
                   <Settings className="w-4 h-4" />
                 </button>
             </div>

             <div className="mx-1 h-5 w-px bg-border/70" />
           </>
         )}

         <div
            className="flex items-center gap-1.5"
            onMouseDown={(e) => e.stopPropagation()}
         >
            <button onClick={() => appWindow.minimize()} className={roundControl} title={t("Minimise")}>
            <Minus className="w-4 h-4 pointer-events-none" />
            </button>
            <button onClick={() => appWindow.toggleMaximize()} className={roundControl} title={t("Maximise")}>
            <Square className="w-3.5 h-3.5 pointer-events-none" />
            </button>
            <button
            onClick={() => appWindow.close()}
            className={cn(roundControl, "hover:border-destructive/40 hover:bg-destructive hover:text-destructive-foreground")}
            title={t("Close")}
            >
            <X className="w-4 h-4 pointer-events-none" />
            </button>
         </div>
      </div>
    </div>
  );
}
