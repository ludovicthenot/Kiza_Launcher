import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Maximize, X, Settings, Download, Loader2 } from "lucide-react";
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

  // In a browser there is no launcher to ask, which is the development server
  // and is worth saying: a build running from `npm run dev` follows no channel
  // at all, and labelling it "Stable" would be the old lie in a new word.
  const stream = !isTauri() ? "Dev" : channel === null ? null : titleCase(channel);

  // The title bar sits outside the access gate so that somebody who cannot get
  // in can still close the window. That is the whole reason it is out there --
  // and it means everything else in this bar has to know when the door is
  // shut, or the gate is a screen with a settings button next to it.
  //
  // Not known yet counts as shut. A slow read is otherwise a window somebody
  // can click through, and the launcher behind this bar is not on screen then
  // anyway.
  const barred = doorShut(useAccess((state) => state.status), useAccess((state) => state.channel)) !== false;

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
      className="sticky top-0 z-50 flex h-12 select-none items-center justify-between border-b border-border/50 bg-card/80 backdrop-blur-md"
      onMouseDown={() => appWindow.startDragging()}
    >
      <div className="flex items-center gap-3 px-4">
        <span className="pointer-events-none font-bold text-sm tracking-wide text-primary">Kiza Launcher</span>
        <span className="pointer-events-none text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20 font-medium">
            {stream ? `${version} ${stream}` : version}
        </span>
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

      <div className="flex items-center gap-2">
         {!barred && (
           <>
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
           </>
         )}

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
