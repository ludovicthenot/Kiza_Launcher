import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Images, Maximize2 } from "lucide-react";
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
      <Strip images={images} large={size === "large"} onOpen={setOpen} />
      <Viewer images={images} index={open} onIndex={setOpen} projectTitle={projectTitle} />
    </section>
  );
}

/** Where the strip is scrolled to, as the arrows, the fades and the track need it. */
interface StripPosition {
  atStart: boolean;
  atEnd: boolean;
  /** How much of the strip is in view, 0–1; 1 when it all fits. */
  visible: number;
  /** How far along it is scrolled, 0–1. */
  along: number;
}

const FADE = "28px";

/**
 * The pictures in a row, scrolled sideways without the system's scroll bar:
 * an arrow at each end that still has more, the edges fading only on those
 * sides, and a slim track underneath that shows where you are and can be
 * clicked or dragged.
 */
function Strip({ images, large, onOpen }: { images: GalleryImage[]; large: boolean; onOpen: (index: number) => void }) {
  const { t } = useI18n();
  const strip = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<StripPosition>({ atStart: true, atEnd: true, visible: 1, along: 0 });
  const frame = useRef(0);

  // Once a frame at most, and only when something moved: a scroll sends
  // events faster than the screen draws, and each one used to draw the
  // whole strip again.
  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next: StripPosition = {
      atStart: el.scrollLeft <= 2,
      atEnd: el.scrollLeft >= max - 2,
      visible: el.scrollWidth > 0 ? Math.min(1, el.clientWidth / el.scrollWidth) : 1,
      along: max > 0 ? Math.round((el.scrollLeft / max) * 500) / 500 : 0,
    };
    setPosition((was) =>
      was.atStart === next.atStart &&
      was.atEnd === next.atEnd &&
      was.visible === next.visible &&
      was.along === next.along
        ? was
        : next,
    );
  }, []);
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [measure, images.length]);

  const page = (direction: -1 | 1) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const fadeLeft = position.atStart ? "black" : "transparent";
  const fadeRight = position.atEnd ? "black" : "transparent";
  const mask = `linear-gradient(to right, ${fadeLeft}, black ${FADE}, black calc(100% - ${FADE}), ${fadeRight})`;

  return (
    <div className="group/strip relative">
      <div
        ref={strip}
        onScroll={onScroll}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((image, index) => (
          <Thumbnail key={image.url} image={image} index={index} large={large} featured={large && index === 0} onOpen={onOpen} />
        ))}
      </div>

      <StripArrow side="left" label={t("Previous")} hidden={position.atStart} onClick={() => page(-1)} />
      <StripArrow side="right" label={t("Next")} hidden={position.atEnd} onClick={() => page(1)} />

      {position.visible < 1 && <StripTrack strip={strip} position={position} />}
    </div>
  );
}

function StripArrow({
  side,
  label,
  hidden,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  hidden: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={hidden ? -1 : 0}
      onClick={onClick}
      className={cn(
        "absolute top-[calc(50%-5px)] z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.14),0_8px_22px_-6px_hsl(242_30%_2%/0.85)]",
        "transition-[opacity,scale,background-color] duration-200 ease-out hover:bg-background/90 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        side === "left" ? "left-1.5" : "right-1.5",
        hidden
          ? "pointer-events-none scale-90 opacity-0"
          : "opacity-0 group-hover/strip:opacity-100 focus-visible:opacity-100",
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

/** The slim bar under the strip: the part in view, movable by hand. */
function StripTrack({ strip, position }: { strip: RefObject<HTMLDivElement | null>; position: StripPosition }) {
  const track = useRef<HTMLDivElement>(null);
  const grab = useRef<number | null>(null);

  // Puts the strip where a point on the track says, keeping the thumb under
  // the pointer where it was taken.
  const scrollTo = (clientX: number, smooth: boolean) => {
    const el = strip.current;
    const bar = track.current;
    if (!el || !bar) return;
    const rect = bar.getBoundingClientRect();
    const thumb = rect.width * position.visible;
    const free = rect.width - thumb;
    if (free <= 0) return;
    const left = clientX - rect.left - (grab.current ?? thumb / 2);
    const along = Math.min(1, Math.max(0, left / free));
    el.scrollTo({ left: along * (el.scrollWidth - el.clientWidth), behavior: smooth ? "smooth" : "auto" });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bar = track.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const thumbLeft = rect.width * (1 - position.visible) * position.along;
    const thumbWidth = rect.width * position.visible;
    const x = event.clientX - rect.left;
    const onThumb = x >= thumbLeft && x <= thumbLeft + thumbWidth;
    grab.current = onThumb ? x - thumbLeft : null;
    bar.setPointerCapture(event.pointerId);
    if (!onThumb) scrollTo(event.clientX, true);
  };

  return (
    <div
      ref={track}
      aria-hidden
      onPointerDown={onPointerDown}
      onPointerMove={(event) => {
        if (grab.current !== null) scrollTo(event.clientX, false);
      }}
      onPointerUp={() => (grab.current = null)}
      onPointerCancel={() => (grab.current = null)}
      className="group/track mx-auto mt-2.5 flex h-3 w-[min(100%,14rem)] cursor-pointer touch-none items-center"
    >
      <div className="relative h-1 w-full rounded-full bg-foreground/[0.08] transition-[height] duration-150 group-hover/track:h-1.5">
        <div
          className="absolute inset-y-0 rounded-full bg-foreground/35 transition-[background-color] duration-150 group-hover/track:bg-primary"
          style={{
            width: `${position.visible * 100}%`,
            left: `${(1 - position.visible) * position.along * 100}%`,
          }}
        />
      </div>
    </div>
  );
}

// Kept as they are while the strip around them scrolls.
const Thumbnail = memo(function Thumbnail({
  image,
  index,
  large,
  featured,
  onOpen,
}: {
  image: GalleryImage;
  index: number;
  large: boolean;
  /** The first picture of a page's gallery, shown wider than the rest. */
  featured: boolean;
  onOpen: (index: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      aria-label={image.title ?? undefined}
      className={cn(
        "group relative shrink-0 snap-start overflow-hidden rounded-xl bg-secondary/40 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.08)] transition-[scale] duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        large ? "h-60" : "aspect-video h-[6.5rem]",
        large && (featured ? "aspect-[16/7.5]" : "aspect-[5/6]"),
        !loaded && "animate-pulse",
      )}
    >
      <img
        src={image.thumbnailUrl}
        alt={image.title ?? ""}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={cn(
          "h-full w-full object-cover transition-[opacity,transform] duration-300 ease-out group-hover:scale-[1.05]",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
      {/* Its title, and a hint that it opens, once the pointer is on it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/10 to-transparent p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <span className={cn("truncate text-left font-medium text-white", large ? "text-sm" : "text-xs")}>
          {image.title}
        </span>
        <Maximize2 className="h-3.5 w-3.5 shrink-0 text-white/85" />
      </span>
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_0_1px_hsl(0_0%_100%/0.06)]" />
    </button>
  );
});

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
  // Which way the last move went, so the next picture comes in from that side.
  const [direction, setDirection] = useState<1 | -1>(1);
  const film = useRef<HTMLDivElement>(null);
  const image = index === null ? null : images[index] ?? null;

  const go = useCallback(
    (next: number, towards: 1 | -1) => {
      setDirection(towards);
      onIndex(next);
    },
    [onIndex],
  );
  const step = useCallback(
    (by: 1 | -1) => {
      if (index === null || images.length === 0) return;
      go((index + by + images.length) % images.length, by);
    },
    [go, index, images.length],
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

  // The picture on screen stays in view in the film strip below it.
  useEffect(() => {
    if (index === null) return;
    film.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  return (
    <Dialog open={image !== null} onOpenChange={(next) => !next && onIndex(null)}>
      <DialogContent className="max-w-[min(92vw,1400px)] gap-3 border-0 bg-background/95 p-3 backdrop-blur-xl">
        {image && index !== null && (
          <>
            <DialogTitle className="sr-only">{image.title || projectTitle}</DialogTitle>
            <DialogDescription className="sr-only">{t("Gallery")}</DialogDescription>
            <div className="relative flex min-h-[40vh] items-center justify-center overflow-hidden rounded-xl bg-black">
              <img
                key={image.url}
                src={image.url}
                alt={image.title ?? ""}
                draggable={false}
                className={cn(
                  "mx-auto max-h-[70vh] w-auto animate-in fade-in-0 duration-300 ease-out motion-reduce:animate-none",
                  direction === 1 ? "slide-in-from-right-6" : "slide-in-from-left-6",
                )}
              />
              {images.length > 1 && (
                <>
                  <ViewerArrow side="left" label={t("Previous")} onClick={() => step(-1)} />
                  <ViewerArrow side="right" label={t("Next")} onClick={() => step(1)} />
                  <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium tabular-nums text-white/90 backdrop-blur-md">
                    {index + 1} / {images.length}
                  </span>
                </>
              )}
            </div>
            {image.title && <div className="truncate px-1 text-sm font-medium">{image.title}</div>}
            {images.length > 1 && (
              <div
                ref={film}
                className="mx-auto flex w-fit max-w-full gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {images.map((other, at) => (
                  <button
                    key={other.url}
                    type="button"
                    data-index={at}
                    aria-label={other.title || `${at + 1}`}
                    aria-current={at === index}
                    onClick={() => go(at, at > index ? 1 : -1)}
                    className={cn(
                      "relative aspect-video h-14 shrink-0 overflow-hidden rounded-lg transition-[opacity,box-shadow,scale] duration-200 ease-out active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                      at === index
                        ? "opacity-100 shadow-[0_0_0_2px_hsl(var(--primary))]"
                        : "opacity-45 hover:opacity-80",
                    )}
                  >
                    <img src={other.thumbnailUrl} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
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
        "absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.16)] backdrop-blur-md transition-[background-color,scale] duration-150 ease-out hover:bg-black/70 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
