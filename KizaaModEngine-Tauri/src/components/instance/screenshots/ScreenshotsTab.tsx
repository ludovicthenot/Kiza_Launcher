import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Camera, Check, ChevronLeft, ChevronRight, Copy, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { GameInstanceSummary } from "../../../lib/types";
import { type Screenshot, useScreenshotActions, useScreenshots, useScreenshotThumbnail } from "../../../lib/queries";
import { useI18n } from "../../../lib/i18n";
import { formatDateTime } from "../../../lib/datetime";
import { formatBytes } from "../../../lib/units";
import { cn } from "../../../lib/utils";
import { gsap, useGSAP, prefersReducedMotion, staggerFor } from "../../../lib/animation";
import { Button, EmptyState } from "../../ui/primitives";
import { Dialog, DialogContent, DialogTitle } from "../../ui/dialog";
import { part } from "../../../lib/theme/parts";

/**
 * An instance's screenshots: what F2 saved in game, newest first.
 *
 * A grid of small copies made once by the launcher, each one opening the
 * picture whole; "Copy" puts the picture itself on the clipboard, ready to
 * paste into a message, and the folder is a click away. Asked again every few
 * seconds while open, so one taken a moment ago is already there.
 */
export function ScreenshotsTab({ instance }: { instance: GameInstanceSummary }) {
  const { t } = useI18n();
  const { data: shots, isLoading } = useScreenshots(instance.id);
  const actions = useScreenshotActions(instance.id);
  const [open, setOpen] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const arrived = useRef(false);
  const list = shots ?? [];

  // The tiles arrive once, one after another, the whole group inside a third of a second.
  useGSAP(
    () => {
      if (arrived.current || list.length === 0 || prefersReducedMotion()) return;
      arrived.current = true;
      gsap.from("[data-shot]", {
        opacity: 0,
        y: 8,
        scale: 0.98,
        duration: 0.35,
        ease: "power3.out",
        stagger: staggerFor(Math.min(list.length, 12), 0.03, 0.3),
      });
    },
    { scope: gridRef, dependencies: [list.length > 0] },
  );

  const copy = useCallback(
    (shot: Screenshot) => {
      actions.copy.mutate(shot.name, { onSuccess: () => toast.success(t("Screenshot copied")) });
    },
    [actions.copy, t],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 {...part("screenshots.title")} className="flex items-center gap-2 text-xl font-bold text-balance">
              <Camera className="h-5 w-5 text-primary" />
              {t("Screenshots")}
              {list.length > 0 && (
                <span className="text-sm font-medium tabular-nums text-muted-foreground">{list.length}</span>
              )}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Press F2 in the game: each picture appears here.")}
            </p>
          </div>
          <Button onClick={() => actions.openFolder.mutate()}>
            <FolderOpen className="h-4 w-4" />
            {t("Open folder")}
          </Button>
        </header>

        {!isLoading && list.length === 0 ? (
          <EmptyState
            icon={Camera}
            title={t("No screenshots yet")}
            description={t("Press F2 in the game to take one. It shows up here a moment later.")}
          />
        ) : (
          <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
            {list.map((shot, index) => (
              <ShotTile
                key={shot.name}
                instanceId={instance.id}
                shot={shot}
                onOpen={() => setOpen(index)}
                onCopy={() => copy(shot)}
                onReveal={() => actions.reveal.mutate(shot.name)}
              />
            ))}
          </div>
        )}
      </div>

      <Viewer
        shots={list}
        index={open}
        onIndex={setOpen}
        onCopy={copy}
        onReveal={(shot) => actions.reveal.mutate(shot.name)}
      />
    </div>
  );
}

function ShotTile({
  instanceId,
  shot,
  onOpen,
  onCopy,
  onReveal,
}: {
  instanceId: string;
  shot: Screenshot;
  onOpen: () => void;
  onCopy: () => void;
  onReveal: () => void;
}) {
  const { t } = useI18n();
  const { data: thumbnail } = useScreenshotThumbnail(instanceId, shot);
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      data-shot
      className="group relative aspect-video overflow-hidden rounded-xl bg-secondary/30 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.07)]"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={formatDateTime(shot.taken_at)}
        className="absolute inset-0 transition-transform duration-150 ease-out active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {thumbnail && (
          <img
            src={convertFileSrc(thumbnail)}
            alt=""
            draggable={false}
            onLoad={() => setLoaded(true)}
            className={cn(
              "h-full w-full object-cover transition-[opacity,transform] duration-300 ease-out group-hover:scale-[1.03]",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        )}
      </button>
      {/* The date and the two actions, over a shade only as tall as they are. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8 opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100">
        <span className="truncate text-xs font-medium tabular-nums text-white/90">{formatDateTime(shot.taken_at)}</span>
        <div className="pointer-events-auto flex shrink-0 gap-1">
          <TileAction label={t("Copy")} onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" />
          </TileAction>
          <TileAction label={t("Show in folder")} onClick={onReveal}>
            <FolderOpen className="h-3.5 w-3.5" />
          </TileAction>
        </div>
      </div>
    </div>
  );
}

function TileAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/45 text-white/90 backdrop-blur-md transition-[background-color,transform] duration-150 ease-out hover:bg-black/65 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {children}
    </button>
  );
}

/** One screenshot whole, the arrows (and ← →) to the next, Copy and the folder under it. */
function Viewer({
  shots,
  index,
  onIndex,
  onCopy,
  onReveal,
}: {
  shots: Screenshot[];
  index: number | null;
  onIndex: (index: number | null) => void;
  onCopy: (shot: Screenshot) => void;
  onReveal: (shot: Screenshot) => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const shot = index === null ? null : shots[index] ?? null;
  const position = (index ?? 0) + 1;
  const step = useCallback(
    (by: number) => {
      if (index === null || shots.length === 0) return;
      onIndex((index + by + shots.length) % shots.length);
    },
    [index, onIndex, shots.length],
  );

  useEffect(() => setCopied(false), [index]);
  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, step]);

  return (
    <Dialog open={shot !== null} onOpenChange={(next) => !next && onIndex(null)}>
      <DialogContent className="max-w-[min(92vw,1400px)] gap-3 p-3">
        {shot && (
          <>
            <DialogTitle className="sr-only">{formatDateTime(shot.taken_at)}</DialogTitle>
            <div className="relative overflow-hidden rounded-xl bg-black">
              <img
                key={shot.name}
                src={convertFileSrc(shot.path)}
                alt=""
                draggable={false}
                className="mx-auto max-h-[76vh] w-auto animate-in fade-in-0 duration-200"
              />
              {shots.length > 1 && (
                <>
                  <ViewerArrow side="left" label={t("Previous")} onClick={() => step(-1)} />
                  <ViewerArrow side="right" label={t("Next")} onClick={() => step(1)} />
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-1">
              <div className="text-sm">
                <div className="font-medium tabular-nums">{formatDateTime(shot.taken_at)}</div>
                <div className="text-xs tabular-nums text-muted-foreground">
                  {formatBytes(shot.size)} · {position} / {shots.length}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => onReveal(shot)}>
                  <FolderOpen className="h-4 w-4" />
                  {t("Show in folder")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    onCopy(shot);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? t("Copied") : t("Copy")}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ViewerArrow({ side, label, onClick }: { side: "left" | "right"; label: string; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-[background-color,transform] duration-150 ease-out hover:bg-black/65 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
