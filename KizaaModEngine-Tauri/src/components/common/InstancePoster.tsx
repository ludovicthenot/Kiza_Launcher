import {
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
function hueOf(id: string): number {
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
  onSelect: () => void;
  onPlay: () => void;
  onManage: () => void;
  /** A right click on the card, with where it happened. */
  onMenu?: (x: number, y: number) => void;
}

export function InstancePoster({
  instance,
  selected,
  launching = false,
  className,
  onSelect,
  onPlay,
  onManage,
  onMenu,
}: InstancePosterProps) {
  const { t } = useI18n();
  const { data: cover } = useInstanceCover(instance.id);
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
      onClick={onSelect}
      onContextMenu={(event) => {
        if (!onMenu) return;
        event.preventDefault();
        onSelect();
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
          selected
            ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.85),0_16px_36px_-16px_hsl(var(--primary)/0.7)]"
            : "shadow-[0_10px_28px_-18px_hsl(0_0%_0%/0.9)] group-hover:-translate-y-1 group-hover:shadow-[0_18px_36px_-18px_hsl(0_0%_0%/0.95)]",
        )}
        style={{
          background: `linear-gradient(150deg, hsl(${hue} 60% 26%), hsl(${(hue + 50) % 360} 65% 10%))`,
        }}
        {...editable("card", instance.id)}
      >
        {cover && (
          <img
            src={cover.uri}
            alt=""
            aria-hidden
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
          />
        )}
        {/* Only enough shade at the foot for the play button to sit on. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

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
                  onSelect();
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
