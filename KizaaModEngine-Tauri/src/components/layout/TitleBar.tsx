import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Maximize, X, Settings, Download, Loader2 } from "lucide-react";
import { useAppStore } from "../../lib/store";
import { AccountMenu } from "./AccountMenu";
import { getVersion } from "@tauri-apps/api/app";
import { useState, useEffect, useRef } from "react";
import { useI18n } from "../../lib/i18n";
import { useUpdaterStore } from "../../lib/updater";
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

export function TitleBar() {
  const appWindow = getCurrentWindow();
  const { t } = useI18n();
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const updaterPhase = useUpdaterStore((state) => state.phase);
  const updaterProgress = useUpdaterStore((state) => state.progress);
  const [version, setVersion] = useState("");

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
    getVersion().then(v => setVersion(`v${v} Alpha`));
  }, []);

  return (
    <div 
      className="h-10 bg-card/80 backdrop-blur-md border-b border-border/50 select-none sticky top-0 z-50 flex items-center justify-between"
      onMouseDown={() => appWindow.startDragging()}
    >
      <div className="flex items-center gap-3 px-4">
        <span className="pointer-events-none font-bold text-sm tracking-wide text-primary">Kiza Launcher</span>
        <span className="pointer-events-none text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20 font-medium">
            {version}
        </span>
        {updateVisible && (
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

      <div className="flex items-center gap-2">
         <div className="flex items-center px-1">
            <AccountMenu />
         </div>

         <div className="h-4 w-px bg-border" />

         <div
            className="flex items-center px-2"
            onMouseDown={(e) => e.stopPropagation()}
         >
             <button
               onClick={() => setShowSettings(true)}
               className="h-8 w-8 flex items-center justify-center hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-primary cursor-pointer"
               title={t("Settings")}
             >
               <Settings className="w-4 h-4" />
             </button>
         </div>
         
         <div className="h-4 w-px bg-border" />

         <div 
            className="flex items-center gap-1 px-2"
            onMouseDown={(e) => e.stopPropagation()} 
         >
            <button 
            onClick={() => appWindow.minimize()} 
            className="h-8 w-10 flex items-center justify-center hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
            >
            <Minus className="w-4 h-4 pointer-events-none" />
            </button>
            <button 
            onClick={() => appWindow.toggleMaximize()} 
            className="h-8 w-10 flex items-center justify-center hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
            >
            <Maximize className="w-4 h-4 pointer-events-none" />
            </button>
            <button 
            onClick={() => appWindow.close()} 
            className="h-8 w-10 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground rounded-md transition-colors text-muted-foreground cursor-pointer"
            >
            <X className="w-4 h-4 pointer-events-none" />
            </button>
         </div>
      </div>
    </div>
  );
}
