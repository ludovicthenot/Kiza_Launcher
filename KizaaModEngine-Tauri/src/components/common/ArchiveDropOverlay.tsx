import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { PackageOpen } from "lucide-react";
import { useAppStore } from "../../lib/store";
import { useI18n } from "../../lib/i18n";

/** Archives the library knows how to import, by their name. */
const ARCHIVE = /\.(zip|mrpack|7z|rar|tar|tgz|txz|tbz2|gz|xz|bz2)$/i;

/**
 * Drop a pack anywhere on the launcher to import it.
 *
 * <p>While an archive is held over the window, a pane of glass says what
 * letting go will do; on the drop, the launcher goes back to the library and
 * the import starts there, with the card that shows it arriving. Anything
 * else dragged over the window is ignored, and so is a drop on one of the
 * Maker's own slots, which have their own meaning.
 */
export function ArchiveDropOverlay() {
  const { t } = useI18n();
  const [holding, setHolding] = useState<string | null>(null);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;

    // The runtime counts physical pixels, the document CSS ones.
    const overMakerSlot = (position: { x: number; y: number }) => {
      const ratio = window.devicePixelRatio || 1;
      return !!document.elementFromPoint(position.x / ratio, position.y / ratio)?.closest("[data-kiza-drop]");
    };

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "leave") {
          setHolding(null);
          return;
        }
        if (payload.type === "enter") {
          const archive = payload.paths.find((path) => ARCHIVE.test(path));
          setHolding(archive ? archive.split(/[\\/]/).pop() ?? archive : null);
          return;
        }
        if (payload.type === "over") {
          if (overMakerSlot(payload.position)) setHolding(null);
          return;
        }
        // Dropped.
        setHolding(null);
        if (overMakerSlot(payload.position)) return;
        const archive = payload.paths.find((path) => ARCHIVE.test(path));
        if (!archive) return;
        const store = useAppStore.getState();
        store.setShowSettings(false);
        store.setSelectedInstanceId(null);
        store.setLibraryMode("instances");
        store.setDroppedArchive(archive);
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch(() => {
        // Outside the desktop app there is nothing to listen to; the Import
        // button is still there.
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  if (!holding) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center bg-background/55 p-6 backdrop-blur-md animate-in fade-in-0 duration-150">
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-[28px] border-2 border-dashed border-primary/60 bg-primary/[0.06] animate-in zoom-in-[0.98] duration-200">
        <span className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-primary text-primary-foreground shadow-[0_18px_40px_-12px_hsl(var(--primary)/0.8)] animate-in zoom-in-75 duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
          <PackageOpen className="h-10 w-10" />
        </span>
        <div className="text-center">
          <div className="text-2xl font-bold tracking-tight">{t("Drop to import")}</div>
          <div className="mt-1 max-w-md truncate text-[13.5px] text-muted-foreground">{holding}</div>
        </div>
      </div>
    </div>
  );
}
