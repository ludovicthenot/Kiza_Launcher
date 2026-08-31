import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  Play,
  RotateCcw,
  Settings2,
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
}

export function InstancePoster({
  instance,
  selected,
  launching = false,
  className,
  onSelect,
  onPlay,
  onManage,
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

  return (
    <div
      data-anim="poster"
      data-instance-poster={instance.id}
      onClick={onSelect}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        event.stopPropagation();
        onManage();
      }}
      title={t("Double-click to manage this instance")}
      className={cn(
        // The card keeps its size whether or not it is selected: the row is a
        // shelf of equals, and only the border and the actions say which one
        // is in hand.
        "group relative flex aspect-[4/7] w-full min-w-0 shrink-0 cursor-pointer flex-col justify-end overflow-hidden rounded-2xl border transition-[border-color,box-shadow] duration-300 motion-reduce:transition-none",
        selected
          ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.6),0_18px_40px_-18px_hsl(var(--primary)/0.7)]"
          : "border-border/60 hover:-translate-y-1 hover:border-primary/50",
        className,
      )}
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 60% 26%), hsl(${(hue + 50) % 360} 65% 10%))`,
      }}
    >
      {cover && (
        <img
          src={cover.uri}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* The name and its meta line have to stay readable over any image the
          player picks, including a bright one. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-black/10" />

      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        {selected && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium backdrop-blur-sm",
              ready
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                : "border-amber-500/30 bg-amber-500/15 text-amber-300",
            )}
          >
            {ready ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <TriangleAlert className="h-3.5 w-3.5" />
            )}
            {ready ? t("Instance ready") : t("Needs attention")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          {/* Only offered when there is something to go back from. */}
          {cover?.source === "custom" && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                clearCover.mutate(instance.id);
              }}
              title={t("Back to the game version's own artwork")}
              aria-label={t("Back to the game version's own artwork")}
              className="rounded-lg border border-white/15 bg-black/40 p-1.5 text-white/70 backdrop-blur-sm transition hover:text-white"
            >
              {clearCover.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void chooseCover();
            }}
            title={t("Choose a picture for this instance")}
            aria-label={t("Choose a picture for this instance")}
            className="rounded-lg border border-white/15 bg-black/40 p-1.5 text-white/70 backdrop-blur-sm transition hover:text-white"
          >
            {setCover.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div
        className={cn(
          "relative p-6",
          // Side by side while the card is wide enough, stacked underneath
          // when it is not. Sharing the line unconditionally crushed the name
          // to a single letter on a narrow card.
          selected && "flex flex-wrap items-end justify-between gap-x-4 gap-y-4",
        )}
      >
        <div className="min-w-0 flex-1 basis-40">
          <h3
            className={cn(
              "truncate font-bold tracking-tight text-white drop-shadow",
              selected ? "text-[30px]" : "text-[26px]",
            )}
          >
            {instance.display_name}
          </h3>
          <p className="mt-2 truncate text-sm text-white/70">
            {minecraft?.mc_version}
            {minecraft && " • "}
            {minecraft?.loader === "vanilla"
              ? "Vanilla"
              : minecraft?.loader === "fabric"
                ? "Fabric"
                : minecraft?.loader === "forge"
                  ? "Forge"
                  : null}
            {" • "}
            {instance.mod_count} {instance.mod_count === 1 ? t("mod") : t("mods")}
          </p>
        </div>

        {selected && (
          <div data-anim="poster-actions" className="flex shrink-0 grow items-center gap-3 sm:grow-0">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onPlay();
              }}
              disabled={launching}
              className="inline-flex h-14 min-w-[132px] items-center justify-center gap-2 rounded-xl kiza-action px-5 text-base font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
            >
              {launching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-5 w-5" />
              )}
              {t("Play")}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onManage();
              }}
              title={t("Manage this instance")}
              aria-label={t("Manage this instance")}
              className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/15 bg-black/30 text-white transition-colors hover:bg-white/15"
            >
              <Settings2 className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
