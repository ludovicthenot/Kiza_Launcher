import { useState } from "react";
import {
  Check,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Play,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { GameInstanceSummary } from "../../lib/types";
import {
  useClearInstanceCover,
  useInstanceCover,
  useSetInstanceCover,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { LoaderLogo } from "./LoaderLogo";

/**
 * A stable hue for an instance, from its identifier.
 *
 * The last resort behind the picture: the player's own image first, then the
 * Minecraft version's own title-screen artwork. This gradient only shows for a
 * version whose assets are not downloaded yet, and it is always the same one
 * for the same instance so a card stays recognisable meanwhile.
 */
export function hueOf(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

export interface InstancePosterProps {
  instance: GameInstanceSummary;
  selected: boolean;
  launching?: boolean;
  className?: string;
  /** A click on the card; Ctrl or Cmd held adds it to a multiple choice. */
  onSelect: (event: React.MouseEvent) => void;
  /** In the multiple choice made with Ctrl or Cmd. */
  picked?: boolean;
  onPlay: () => void;
  onManage: () => void;
  /** A right click on the card, with where it happened. */
  onMenu?: (x: number, y: number) => void;
}

export function InstancePoster({
  instance,
  selected,
  picked = false,
  launching = false,
  className,
  onSelect,
  onPlay,
  onManage,
  onMenu,
}: InstancePosterProps) {
  const { t } = useI18n();
  const { data: cover } = useInstanceCover(instance.id);
  // A picked picture that is about square -- a modpack's logo, most often --
  // would lose a quarter of its width to a 3:4 card and show its middle,
  // blown up. It is drawn whole instead, as a tile over a deep blur of
  // itself, softened toward its own colours (the average of its top half
  // above, of its bottom half below). A version's panorama and a wide
  // wallpaper still fill the card.
  // Kept with the picture it was read from, so it cannot be lost to a reset
  // racing the load, nor outlive a picture it no longer describes.
  const [measured, setMeasured] = useState<{ uri: string; tint: [string, string] | null } | null>(null);
  const tint = cover && measured?.uri === cover.uri ? measured.tint : null;
  const measure = (image: HTMLImageElement | null) => {
    if (!image || !cover || cover.source !== "custom" || measured?.uri === cover.uri) return;
    // A picture already decoded (from the cache, the card drawn again) may
    // never fire its load: read it now.
    if (image.complete && image.naturalWidth > 0) setMeasured({ uri: cover.uri, tint: logoTint(image) });
  };
  const setCover = useSetInstanceCover();
  const clearCover = useClearInstanceCover();

  const hue = hueOf(instance.id);
  const minecraft = instance.minecraft;
  const ready = instance.status === "Valid";

  const chooseCover = async () => {
    const selectedPath = await openFileDialog({
      multiple: false,
      filters: [{ name: t("Image"), extensions: ["png", "jpg", "jpeg"] }],
    });
    if (typeof selectedPath !== "string") return;
    setCover.mutate({ instanceId: instance.id, sourcePath: selectedPath });
  };

  const loader =
    minecraft?.loader === "vanilla"
      ? "Vanilla"
      : minecraft?.loader === "fabric"
        ? "Fabric"
        : minecraft?.loader === "forge"
          ? "Forge"
          : minecraft?.loader === "neoforge"
            ? "NeoForge"
            : minecraft?.loader === "quilt"
              ? "Quilt"
              : null;

  return (
    // An album, not a poster: the picture on top, its name and one line of
    // facts underneath. The words no longer have to be shouted over an image
    // to be read, so the card can be small, and a wide window holds more of
    // them rather than bigger ones.
    <div
      data-anim="poster"
      data-instance-poster={instance.id}
      // The same card for the grid's slides, inside a group's tray or out of it.
      data-flip-id={instance.id}
      onClick={onSelect}
      onContextMenu={(event) => {
        if (!onMenu) return;
        event.preventDefault();
        onSelect(event);
        onMenu(event.clientX, event.clientY);
      }}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        event.stopPropagation();
        onManage();
      }}
      className={cn("group flex w-full min-w-0 cursor-pointer flex-col gap-2.5", className)}
    >
      <div
        className={cn(
          // `kiza-card` rather than `rounded-2xl border-border/60`: the corner
          // and the edge come from custom properties so the Maker can change
          // them, and a utility here would win the cascade and make the
          // designer's slider do nothing.
          "kiza-card relative aspect-[3/4] w-full overflow-hidden border",
          "transition-[transform,box-shadow,border-color] duration-300 ease-drawer motion-reduce:transition-none",
          // A press answers at once and lets go on the slower curve.
          "active:scale-[0.98] active:duration-100",
          picked
            ? "scale-[0.96] border-primary shadow-[0_0_0_3px_hsl(var(--primary)),0_16px_36px_-16px_hsl(var(--primary)/0.7)]"
            : selected
            ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.85),0_16px_36px_-16px_hsl(var(--primary)/0.7)]"
            : "shadow-[0_10px_28px_-18px_hsl(0_0%_0%/0.9)] group-hover:-translate-y-1 group-hover:shadow-[0_18px_36px_-18px_hsl(0_0%_0%/0.95)]",
        )}
        style={{
          background: `linear-gradient(150deg, hsl(${hue} 60% 26%), hsl(${(hue + 50) % 360} 65% 10%))`,
        }}
        {...editable("card", instance.id)}
      >
        {cover && tint && (
          <>
            <img
              src={cover.uri}
              alt=""
              aria-hidden
              decoding="async"
              className="absolute inset-0 h-full w-full scale-150 object-cover blur-[28px] saturate-[1.4]"
            />
            {/* The blur of a busy picture is blotchy; its own colours, laid
                over at half strength, smooth it into a field. */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage: [
                  "radial-gradient(120% 70% at 50% 0%, hsl(0 0% 100% / 0.1), transparent 60%)",
                  `linear-gradient(180deg, ${tint[0]}80, ${tint[1]}99)`,
                ].join(","),
              }}
            />
          </>
        )}
        {cover && (
          <img
            src={cover.uri}
            alt=""
            aria-hidden
            decoding="async"
            ref={measure}
            onLoad={(event) => {
              if (cover.source !== "custom") return;
              setMeasured({ uri: cover.uri, tint: logoTint(event.currentTarget) });
            }}
            className={cn(
              "absolute transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none",
              tint
                ? "inset-x-[11%] top-1/2 aspect-square w-[78%] -translate-y-1/2 rounded-[14%] object-cover shadow-[0_14px_30px_-10px_hsl(0_0%_0%/0.6)] ring-1 ring-white/15"
                : "inset-0 h-full w-full object-cover",
            )}
          />
        )}
        {/* Only enough shade at the foot for the play button to sit on. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {/* Chosen with Ctrl: a tick that pops in, as on a phone's photo grid. */}
        {picked && (
          <span className="absolute left-2.5 top-2.5 z-[2] flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_12px_hsl(0_0%_0%/0.45)] ring-2 ring-white/90 animate-in zoom-in-50 fade-in-0 duration-200 ease-spring">
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
        )}

        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
          {/* Nothing to say when all is well: only trouble gets a mark. */}
          {!ready && (
            <span
              title={t("Needs attention")}
              className="inline-flex h-6 items-center gap-1 rounded-full bg-black/55 px-2 text-[0.6875rem] font-medium text-amber-300 backdrop-blur-md"
            >
              <TriangleAlert className="h-3 w-3" />
              {t("Needs attention")}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
            {/* Only offered when there is something to go back from. */}
            {cover?.source === "custom" && (
              <CardTool
                label={t("Back to the game version's own artwork")}
                busy={clearCover.isPending}
                icon={RotateCcw}
                onClick={() => clearCover.mutate(instance.id)}
              />
            )}
            <CardTool
              label={t("Choose a picture for this instance")}
              busy={setCover.isPending}
              icon={ImagePlus}
              onClick={() => void chooseCover()}
            />
            {onMenu && (
              <CardTool
                label={t("More")}
                icon={MoreHorizontal}
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  onSelect(event);
                  onMenu(box.left, box.bottom + 6);
                }}
              />
            )}
          </div>
        </div>

        {/* Play, round, in the corner: there on hover and on the chosen card,
            the one thing a card is for. */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPlay();
          }}
          disabled={launching || !ready}
          title={t("Play")}
          aria-label={`${t("Play")} ${instance.display_name}`}
          {...editable("action")}
          className={cn(
            "kiza-action absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-full text-primary-foreground",
            "shadow-[0_8px_20px_-6px_hsl(0_0%_0%/0.7)] transition-[opacity,transform,filter] duration-200 ease-out hover:scale-105 hover:brightness-110 active:scale-95 disabled:opacity-50",
            selected || launching
              ? "translate-y-0 opacity-100"
              : "translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100",
          )}
        >
          {launching ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          )}
        </button>
      </div>

      <div className="min-w-0 px-0.5">
        <h3 className={cn("truncate text-[0.875rem] font-semibold tracking-[-0.01em]", selected ? "text-foreground" : "text-foreground/90")}>
          {instance.display_name}
        </h3>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.75rem] text-muted-foreground">
          {minecraft && <LoaderLogo loader={minecraft.loader} className="h-3.5 w-3.5 rounded-[3px] shadow-none" />}
          <span className="truncate">
            {[
              minecraft?.mc_version,
              loader,
              `${instance.mod_count} ${instance.mod_count === 1 ? t("mod") : t("mods")}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
      </div>
    </div>
  );
}

/** A small round tool on the card's picture, shown on hover. */
function CardTool({
  label,
  icon: Icon,
  busy,
  onClick,
}: {
  label: string;
  icon: typeof Play;
  busy?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white/85 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * The colours a square picture is set on: the average of its top half and of
 * its bottom half, a little darker so the tile stands off them. None for a
 * picture that is not about square, which fills the card instead.
 */
function logoTint(image: HTMLImageElement): [string, string] | null {
  const { naturalWidth: width, naturalHeight: height } = image;
  const ratio = height ? width / height : 0;
  if (ratio < 0.85 || ratio > 1.2) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 2;
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, 1, 2);
    const [r1, g1, b1, , r2, g2, b2] = context.getImageData(0, 0, 1, 2).data;
    const hex = (value: number) => Math.round(value * 0.72).toString(16).padStart(2, "0");
    const shade = (r: number, g: number, b: number) => `#${hex(r)}${hex(g)}${hex(b)}`;
    return [shade(r1, g1, b1), shade(r2, g2, b2)];
  } catch {
    // A picture the page may not read back: the tile still shows, on dark.
    return ["#1e182c", "#0e0b16"];
  }
}
