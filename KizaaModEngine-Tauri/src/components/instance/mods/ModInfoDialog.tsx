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
import { cn, formatBytes } from "../../../lib/utils";
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

  // CurseForge answers with a "game versions" list that is not a list of game
  // versions: it holds the loader, the side the mod runs on and the Minecraft
  // version all together. Shown raw it came out as "fabric · Client · Fabric ·
  // 1.21.11" -- the loader twice, in two capitalisations, next to a word that
  // is not a version at all.
  const loaders = uniqueBy(mod.loaders, (name) => name.toLowerCase());
  const known = new Set(loaders.map((name) => name.toLowerCase()));
  const versions = uniqueBy(
    mod.game_versions.filter((value) => looksLikeAVersion(value) && !known.has(value.toLowerCase())),
    (value) => value,
  );

  // And "version" is whatever the catalogue called the release, which for a
  // CurseForge file is its filename. A badge is not the place for sixty
  // characters ending in .jar, so a filename goes to the facts below and only
  // a real version number stays up here.
  const versionIsAFilename = /\.(jar|zip|litemod)$/i.test(mod.version.trim());

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
          <Badge
            className={
              mod.enabled
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-border/70 text-muted-foreground"
            }
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                mod.enabled ? "bg-emerald-400" : "bg-muted-foreground/50",
              )}
            />
            {/* "Active"/"Inactive" rather than "Enabled"/"Disabled": the
                launcher already uses the latter as the plural heading of a
                filter, and one mod is not a filter. */}
            {mod.enabled ? t("Active") : t("Inactive")}
          </Badge>
          {sourceLabel && (
            <Badge className="border-primary/25 bg-primary/10 text-primary">{sourceLabel}</Badge>
          )}
          {!versionIsAFilename && <Badge>{mod.version}</Badge>}
          {loaders.map((loader) => (
            <Badge key={loader} className="capitalize">
              {loader}
            </Badge>
          ))}
          {/* Every version it covers, not the first one. Whether a mod covers
              the version an instance runs is the question people open this to
              answer -- but four badges of it is a wall, so the rest are
              counted rather than listed. */}
          {versions.slice(0, 4).map((version) => (
            <Badge key={version}>{version}</Badge>
          ))}
          {versions.length > 4 && (
            <Badge title={versions.join(", ")}>+{versions.length - 4}</Badge>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 rounded-xl border border-border/50 bg-secondary/15 p-4 sm:grid-cols-2">
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
          {versionIsAFilename && (
            <Fact icon={FileCode2} label={t("Release")} value={mod.version} wide />
          )}
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

/** Keeps the first of each, in the order they arrived. */
function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const at = key(value);
    if (seen.has(at)) return false;
    seen.add(at);
    return true;
  });
}

/**
 * Whether a string is a Minecraft version rather than a loader or a side.
 *
 * Deliberately shape-based and not a list of known loaders: the list would go
 * stale the week a new one appears, and "starts with a digit and is made of
 * numbers and dots" is what every Minecraft version has looked like since
 * 2011 -- snapshots included, which are dated rather than numbered and are
 * matched separately.
 */
function looksLikeAVersion(value: string): boolean {
  const cleaned = value.trim();
  if (/^\d+(\.\d+)+(-[A-Za-z0-9.]+)?$/.test(cleaned)) return true;
  // Snapshots: 24w14a, and the pre-releases and candidates around a release.
  return /^\d{2}w\d{2}[a-z]$/i.test(cleaned) || /^\d+(\.\d+)+-(pre|rc)\d+$/i.test(cleaned);
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
