import { Image, Sparkles, Database, Trash2, Loader2 } from "lucide-react";
import { Badge } from "../../ui/primitives";
import { cn, formatBytes } from "../../../lib/utils";
import { useI18n } from "../../../lib/i18n";
import type { ContentIdentity } from "../../../lib/queries";

type Kind = "shader" | "resourcepack" | "datapack";

/** The catalogue's title, else the file name without its extension. */
export function displayName(item: ContentIdentity): string {
  return item.title ?? item.file_name.replace(/\.zip$/i, "");
}

/** A pack that has not been identified yet: the file name and the size. */
export function placeholderIdentity(fileName: string, size: number): ContentIdentity {
  return {
    file_name: fileName,
    size,
    sha1: null,
    title: null,
    description: null,
    icon: null,
    author: null,
    version: null,
    published: null,
    updated: null,
    downloads: null,
    source: null,
    project_id: null,
    project_url: null,
    gallery: [],
    categories: [],
    game_versions: [],
    pack_format: null,
    local_description: null,
  };
}

export function ContentIcon({ icon, kind, className }: { icon: string | null; kind: Kind; className?: string }) {
  const Fallback = kind === "shader" ? Sparkles : kind === "datapack" ? Database : Image;
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-lg border border-border/70 bg-secondary/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        className,
      )}
    >
      {icon ? (
        <img src={icon} alt="" className="h-full w-full object-cover" style={{ imageRendering: kind === "resourcepack" ? "pixelated" : "auto" }} />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-primary/10">
          <Fallback className="h-6 w-6 text-primary/70" />
        </div>
      )}
    </div>
  );
}

/**
 * One installed pack, laid out like a mod row: the picture, the name to
 * click for more, the description, the facts as badges, and the bin.
 */
export function ContentRow({
  item,
  kind,
  identifying,
  subtitle,
  onInfo,
  onDelete,
  deleting,
}: {
  item: ContentIdentity;
  kind: Kind;
  /** The catalogue has not answered yet; the row is the file for now. */
  identifying?: boolean;
  subtitle?: string;
  onInfo: () => void;
  onDelete: () => void;
  deleting?: boolean;
}) {
  const { t } = useI18n();
  const name = displayName(item);
  const version = item.game_versions.find((v) => /^\d/.test(v));

  return (
    <div className="flex min-h-[84px] items-center gap-4 rounded-lg border border-border/60 bg-card/40 px-4 py-3 transition hover:bg-secondary/[0.08]">
      <ContentIcon icon={item.icon} kind={kind} className="h-14 w-14" />

      <div className="min-w-0 flex-[1.3]">
        <button
          type="button"
          onClick={onInfo}
          title={t("Show pack information")}
          className="block max-w-full truncate rounded text-left text-sm font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {name}
        </button>
        <div className="mt-1 truncate text-sm text-muted-foreground">
          {item.description ??
            (identifying ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("Looking it up...")}
              </span>
            ) : (
              t("No description")
            ))}
        </div>
        {(subtitle || item.title) && (
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70" title={item.file_name}>
            {subtitle ? `${subtitle} · ` : ""}
            {item.file_name}
          </div>
        )}
      </div>

      <div className="hidden min-w-[220px] flex-1 flex-wrap items-center gap-1.5 lg:flex">
        {item.source && <Badge className="border-primary/25 bg-primary/10 text-primary">Modrinth</Badge>}
        {item.author && <Badge className="text-muted-foreground">{item.author}</Badge>}
        {version && <Badge>MC {version}</Badge>}
        {item.pack_format != null && !item.source && <Badge>{t("Format")} {item.pack_format}</Badge>}
      </div>

      <div className="hidden w-[150px] shrink-0 text-left md:block">
        <div className="truncate text-sm text-muted-foreground">{item.version ?? formatBytes(item.size)}</div>
        {item.version && <div className="text-[11px] text-muted-foreground/70">{formatBytes(item.size)}</div>}
      </div>

      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        title={t("Delete")}
        aria-label={t("Delete")}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-destructive/25 bg-destructive/10 text-destructive transition hover:bg-destructive/20 disabled:opacity-60"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
