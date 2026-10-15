import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Images } from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog";

/** One picture of a project, from whichever catalogue it came from. */
export interface GalleryImage {
  url: string;
  /** A small copy for the strip, where the catalogue makes one; the picture itself otherwise. */
  thumbnailUrl: string;
  title?: string | null;
}

/**
 * A project's pictures: a strip of them under its description, each opening
 * whole in a viewer that goes from one to the next with the arrows and ← →.
 * Nothing at all when the project has none.
 */
export function ProjectGallery({
  images,
  projectTitle,
  size = "small",
}: {
  images: GalleryImage[];
  projectTitle: string;
  /** `large` on a project's own page, where the pictures are half of what it shows. */
  size?: "small" | "large";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) return null;

  return (
    <section aria-label={t("Gallery")}>
      <div className="mb-2 flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground/80">
        <Images className="h-3.5 w-3.5" />
        {t("Gallery")}
        <span className="tabular-nums text-muted-foreground/60">{images.length}</span>
      </div>
      {/* Scrolled sideways, its two ends fading, so the strip says there is more. */}
      <div className="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-2 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-24px),transparent)] [scrollbar-width:thin]">
        {images.map((image, index) => (
          <Thumbnail key={image.url} image={image} large={size === "large"} onOpen={() => setOpen(index)} />
        ))}
      </div>
      <Viewer images={images} index={open} onIndex={setOpen} projectTitle={projectTitle} />
    </section>
  );
}

function Thumbnail({ image, large, onOpen }: { image: GalleryImage; large: boolean; onOpen: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={image.title ?? undefined}
      className={cn("group relative aspect-video shrink-0", large ? "h-44" : "h-[6.5rem]", " snap-start overflow-hidden rounded-xl bg-secondary/40 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.08)] transition-[scale] duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60")}
    >
      <img
        src={image.thumbnailUrl}
        alt={image.title ?? ""}
        loading="lazy"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={cn(
          "h-full w-full object-cover transition-[opacity,transform] duration-300 ease-out group-hover:scale-[1.04]",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_0_1px_hsl(0_0%_100%/0.06)]" />
    </button>
  );
}

function Viewer({
  images,
  index,
  onIndex,
  projectTitle,
}: {
  images: GalleryImage[];
  index: number | null;
  onIndex: (index: number | null) => void;
  projectTitle: string;
}) {
  const { t } = useI18n();
  const image = index === null ? null : images[index] ?? null;
  const step = useCallback(
    (by: number) => {
      if (index === null || images.length === 0) return;
      onIndex((index + by + images.length) % images.length);
    },
    [index, images.length, onIndex],
  );

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
    <Dialog open={image !== null} onOpenChange={(next) => !next && onIndex(null)}>
      <DialogContent className="max-w-[min(92vw,1400px)] gap-3 border-0 bg-background/95 p-3 backdrop-blur-xl">
        {image && (
          <>
            <DialogTitle className="sr-only">{image.title || projectTitle}</DialogTitle>
            <DialogDescription className="sr-only">{t("Gallery")}</DialogDescription>
            <div className="relative flex min-h-[40vh] items-center justify-center overflow-hidden rounded-xl bg-black">
              <img
                key={image.url}
                src={image.url}
                alt={image.title ?? ""}
                draggable={false}
                className="mx-auto max-h-[78vh] w-auto animate-in fade-in-0 duration-200"
              />
              {images.length > 1 && (
                <>
                  <ViewerArrow side="left" label={t("Previous")} onClick={() => step(-1)} />
                  <ViewerArrow side="right" label={t("Next")} onClick={() => step(1)} />
                </>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 px-1 pb-1 text-sm">
              <span className="truncate font-medium">{image.title || projectTitle}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {(index ?? 0) + 1} / {images.length}
              </span>
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
        "absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-[background-color,scale] duration-150 ease-out hover:bg-black/65 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
