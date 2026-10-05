import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useAppStore } from "../../lib/store";
import { useI18n } from "../../lib/i18n";

/** Archives the library knows how to import, by their name. */
const ARCHIVE = /\.(zip|mrpack|7z|rar|tar|tgz|txz|tbz2|tzst|tlz|gz|xz|bz2|zst|lzma)$/i;

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
  // After the drop, the box closes and settles before the pane goes.
  const [closing, setClosing] = useState(false);

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
        if (overMakerSlot(payload.position)) {
          setHolding(null);
          return;
        }
        const archive = payload.paths.find((path) => ARCHIVE.test(path));
        if (!archive) {
          setHolding(null);
          return;
        }
        setClosing(true);
        window.setTimeout(() => {
          setHolding(null);
          setClosing(false);
        }, 1050);
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
    <div
      className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center bg-background/55 p-6 backdrop-blur-md animate-in fade-in-0"
      // The pane waits for the box to close and settle, then fades.
      style={closing ? { animation: "kiza-overlay-out 0.3s ease 0.75s forwards" } : undefined}
    >
      <div
        className={
          "flex h-full w-full flex-col items-center justify-center gap-5 rounded-[28px] border-2 border-dashed bg-primary/[0.06] transition-[border-color] animate-in zoom-in-[0.98] " +
          (closing ? "border-transparent" : "border-primary/60")
        }
      >
        <ImportBox closed={closing} />
        <div className={"text-center transition-opacity " + (closing ? "opacity-0" : "opacity-100")}>
          <div className="text-2xl font-bold tracking-tight">{t("Drop to import")}</div>
          <div className="mt-1 max-w-md truncate text-[13.5px] text-muted-foreground">{holding}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * A box drawn with two flaps: open and waving while a pack is held over the
 * window, folding shut when it is dropped, then bouncing and settling away.
 */
function ImportBox({ closed }: { closed: boolean }) {
  return (
    <div className={closed ? "kiza-box-closed" : "animate-in zoom-in-75 duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"}>
      <svg viewBox="0 0 96 96" className="h-28 w-28 overflow-visible drop-shadow-[0_18px_30px_hsl(var(--primary)/0.55)]">
        {/* The box. */}
        <rect x="18" y="42" width="60" height="42" rx="6" className="fill-primary" />
        <rect x="18" y="42" width="60" height="10" rx="3" className="fill-white/15" />
        {/* The tape, once it is shut. */}
        <rect
          x="44"
          y="38"
          width="8"
          height="22"
          rx="2"
          className={"fill-white/80 transition-opacity duration-200 " + (closed ? "opacity-100 delay-300" : "opacity-0")}
        />
        {/* The flaps, hinged on the box's top corners. */}
        <rect x="18" y="35" width="30" height="7" rx="2.5" className="kiza-box-flap kiza-box-flap-left fill-[hsl(var(--primary)/0.85)]" />
        <rect x="48" y="35" width="30" height="7" rx="2.5" className="kiza-box-flap kiza-box-flap-right fill-[hsl(var(--primary)/0.85)]" />
      </svg>
    </div>
  );
}
