import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CalendarClock,
  Download,
  ExternalLink,
  FileArchive,
  HardDrive,
  Layers,
  Tag,
  User,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/dialog";
import { Badge } from "../../ui/primitives";
import { cn, formatBytes } from "../../../lib/utils";
import { formatDate } from "../../../lib/datetime";
import { useI18n } from "../../../lib/i18n";
import type { ContentIdentity } from "../../../lib/queries";
import { ContentIcon, displayName } from "./ContentRow";

/**
 * Everything the launcher knows about one pack, the way the mod dialog
 * shows a mod: who made it, where it came from, what it looks like.
 *
 * A pack identified on Modrinth gets the catalogue's gallery — screenshots
 * and the odd GIF — which is what a shader is chosen by. One that is not
 * gets what its own files say: the description from `pack.mcmeta`, the
 * picture from `pack.png`, its size and its format.
 */
export function ContentInfoDialog({
  item,
  kind,
  onClose,
}: {
  item: ContentIdentity | null;
  kind: "shader" | "resourcepack" | "datapack";
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!item) return null;

  const name = displayName(item);
  const versions = item.game_versions.filter((v) => /^\d/.test(v));
  const categories = item.categories.filter((c) => !["fabric", "forge", "neoforge", "quilt", "iris", "optifine", "vanilla"].includes(c));
  const loaders = item.categories.filter((c) => ["iris", "optifine", "canvas", "vanilla"].includes(c));

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start gap-4 pr-8">
            <ContentIcon icon={item.icon} kind={kind} className="h-16 w-16 rounded-xl" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-left">{name}</DialogTitle>
              <DialogDescription className="mt-1 text-left">
                {item.description || t("No description")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {item.gallery.length > 0 && (
          <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
            {item.gallery.slice(0, 10).map((url) => (
              <GalleryPicture key={url} url={url} title={t("Open the picture")} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {item.source && (
            <Badge className="border-primary/25 bg-primary/10 text-primary">Modrinth</Badge>
          )}
          {item.version && <Badge>{item.version}</Badge>}
          {loaders.map((loader) => (
            <Badge key={loader} className="capitalize">
              {loader}
            </Badge>
          ))}
          {versions.slice(0, 4).map((version) => (
            <Badge key={version}>{version}</Badge>
          ))}
          {versions.length > 4 && <Badge title={versions.join(", ")}>+{versions.length - 4}</Badge>}
          {categories.map((category) => (
            <Badge key={category} className="capitalize text-muted-foreground">
              {category}
            </Badge>
          ))}
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 rounded-xl border border-border/50 bg-secondary/15 p-4 sm:grid-cols-2">
          <Fact icon={User} label={t("Author")} value={item.author ?? t("Unknown")} />
          <Fact icon={HardDrive} label={t("Size")} value={formatBytes(item.size)} />
          <Fact icon={CalendarClock} label={t("Released")} value={item.published ? asDate(item.published) : t("Unknown")} />
          <Fact icon={CalendarClock} label={t("Updated")} value={item.updated ? asDate(item.updated) : t("Unknown")} />
          {item.downloads != null && (
            <Fact icon={Download} label={t("Downloads")} value={item.downloads.toLocaleString()} />
          )}
          {item.pack_format != null && (
            <Fact icon={Layers} label={t("Pack format")} value={String(item.pack_format)} />
          )}
          <Fact icon={FileArchive} label={t("File")} value={item.file_name} wide />
          {item.local_description && item.local_description !== item.description && (
            <Fact icon={Tag} label={t("Says about itself")} value={item.local_description} wide />
          )}
        </dl>

        {item.project_url && (
          <button
            type="button"
            onClick={() => void openUrl(item.project_url!).catch(() => undefined)}
            className="kiza-button inline-flex h-9 items-center justify-center gap-2 self-start border px-3 text-sm transition hover:bg-secondary/60"
          >
            <ExternalLink className="h-4 w-4" />
            {t("Open on Modrinth")}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One picture of the gallery; gone rather than broken when it fails. */
function GalleryPicture({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <button
      type="button"
      onClick={() => void openUrl(url).catch(() => undefined)}
      title={title}
      className="h-36 shrink-0 snap-start overflow-hidden rounded-lg border border-border/60 bg-secondary/20 transition hover:border-primary/50"
    >
      <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-auto max-w-[320px] object-cover" />
    </button>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  wide,
}: {
  icon: typeof User;
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("flex items-start gap-2", wide && "sm:col-span-2")}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm" title={value}>
          {value}
        </dd>
      </div>
    </div>
  );
}

function asDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDate(date);
}
