/**
 * The editor's own window (`#/maker-panel`), when the panel is taken out of
 * the launcher. Only the panel, at the window's full size, driven by the
 * launcher's window through `detach.ts`.
 */

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { startEditorBridge } from "../../lib/maker/detach";
import { useThemeStore } from "../../lib/theme/store";
import { MakerPanel } from "./MakerPanel";

export function MakerPanelWindow() {
  const session = useThemeStore((state) => state.session);
  useEffect(() => startEditorBridge(), []);

  return (
    <div className="dark flex h-[100dvh] bg-background text-foreground">
      {session ? (
        <MakerPanel detached />
      ) : (
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Waiting for the launcher…
        </div>
      )}
    </div>
  );
}
