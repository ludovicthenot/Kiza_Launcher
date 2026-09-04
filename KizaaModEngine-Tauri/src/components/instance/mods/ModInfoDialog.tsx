import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CalendarClock, ExternalLink, FileCode2, HardDrive, Package, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Badge } from "../../ui/primitives";
import { formatBytes } from "../../../lib/utils";
import { useI18n } from "../../../lib/i18n";
import type { Mod } from "../../../lib/types";

/**
 * Everything the launcher already knows about one installed mod.
 *
 * <p>The row in the list has to fit a dozen mods on a screen, so it shows a
 * truncated name, a truncated description and one loader out of however many.
 * Everything else — who wrote it, where it came from, which files it actually
 * put in the instance, how big it is — was read at install time and then had
 * nowhere to be seen. This is that place, and it costs no new request: the
 * record the list is already holding carries all of it.
 */
export function ModInfoDialog({
  mod,
  onClose,
}: {
  mod: Mod | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!mod) return null;

  const cover = mod.cover_url ?? (mod.cover_path ? convertFileSrc(mod.cover_path) : null);
  const source = (mod.source ?? "").toLowerCase();
  const sourceLabel =
    source === "modrinth" ? "Modrinth" : source === "curseforge" ? "CurseForge" : null;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start gap-4 pr-8">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border/60">
              {cover ? (
                <img src={cover} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-primary/10">
                  <Package className="h-7 w-7 text-primary/70" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-left">{mod.name}</DialogTitle>
              <DialogDescription className="mt-1 text-left">
                {/* The whole thing, wrapped. The list truncates it because the
                    list has one line; this does not have that excuse. */}
                {mod.description || t("No description")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5">
          {sourceLabel && <Badge>{sourceLabel}</Badge>}
          <Badge>{mod.version}</Badge>
          {mod.loaders.map((loader) => (
            <Badge key={loader}>{loader}</Badge>
          ))}
          {/* Every version, not the first one. Whether a mod covers the version
              an instance runs is the question people open this to answer. */}
          {mod.game_versions.map((version) => (
            <Badge key={version}>{version}</Badge>
          ))}
          <Badge
            className={
              mod.enabled
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : undefined
            }
          >
            {/* "Active"/"Inactive" rather than "Enabled"/"Disabled": the
                launcher already uses the latter as the plural heading of a
                filter, and one mod is not a filter. */}
            {mod.enabled ? t("Active") : t("Inactive")}
          </Badge>
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Fact icon={User} label={t("Author")} value={mod.author ?? t("Unknown")} />
          <Fact
            icon={HardDrive}
            label={t("Size")}
            value={mod.file_size != null ? formatBytes(mod.file_size) : t("Unknown")}
          />
          <Fact icon={CalendarClock} label={t("Installed")} value={asDate(mod.install_date)} />
          <Fact
            icon={CalendarClock}
            label={t("Released")}
            value={mod.updated_at ? asDate(mod.updated_at) : t("Unknown")}
          />
        </dl>

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <FileCode2 className="h-3.5 w-3.5" />
            {/* Counted from what is on disk, not from what the archive claimed:
                a mod that unpacked to nothing looks identical in the list. */}
            {t("Files in this instance")} · {mod.deployed_file_count}/{mod.files.length}
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-border/60 bg-secondary/20 p-2">
            {mod.files.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                {t("This mod has no files recorded.")}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {mod.files.map((file) => (
                  <li
                    key={file}
                    className="truncate px-1 py-0.5 font-mono text-[11px] text-muted-foreground"
                    title={file}
                  >
                    {file}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {mod.homepage_url && (
          <button
            type="button"
            onClick={() => void openUrl(mod.homepage_url!).catch(() => undefined)}
            className="kiza-button inline-flex h-9 items-center justify-center gap-2 self-start border px-3 text-sm transition hover:bg-secondary/60"
          >
            <ExternalLink className="h-4 w-4" />
            {t("Open the mod page")}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
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

/**
 * A date somebody can read, or the raw string when it is not one.
 *
 * These come from two catalogues and from files on disk, so the format is not
 * guaranteed. Showing the original beats showing "Invalid Date".
 */
function asDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
