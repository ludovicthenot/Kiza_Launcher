import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Maximize, X, Settings } from "lucide-react";
import { useAppStore } from "../../lib/store";
import { AccountMenu } from "./AccountMenu";
import { getVersion } from "@tauri-apps/api/app";
import { useState, useEffect } from "react";

export function TitleBar() {
  const appWindow = getCurrentWindow();
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(v => setVersion(`v${v} Beta`));
  }, []);

  return (
    <div 
      className="h-10 bg-card/80 backdrop-blur-md border-b border-border/50 select-none sticky top-0 z-50 flex items-center justify-between"
      onMouseDown={() => appWindow.startDragging()}
    >
      <div className="flex items-center gap-3 px-4 pointer-events-none">
        <span className="font-bold text-sm tracking-wide text-primary">Kiza Launcher Alpha</span>
        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20 font-medium">
            {version}
        </span>
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
               title="Settings"
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
