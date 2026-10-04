import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, FileCode2, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Button } from "../../ui/primitives";
import { Group, GroupRow } from "../../ui/grouped";
import { cn, formatBytes } from "../../../lib/utils";
import { useI18n } from "../../../lib/i18n";
import { ProviderBadge, providerLabel, providerOf } from "../../common/ProviderBadge";
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

  const sideLabel =
    mod.side === "client"
      ? t("Client only")
      : mod.side === "server"
        ? t("Server only")
        : mod.side === "both"
          ? t("Client and server")
          : t("Unknown");
  const provider = providerOf(mod.source);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        {/* The mod's own icon, blurred, tints the top of the sheet. */}
        {cover && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-44 overflow-hidden [mask-image:linear-gradient(to_bottom,black,transparent)]"
          >
            <img src={cover} alt="" className="h-full w-full scale-150 object-cover opacity-30 blur-3xl saturate-150" />
          </div>
        )}

        <div className="relative max-h-[82vh] space-y-6 overflow-y-auto px-6 pb-6 pt-7">
          <DialogHeader className="space-y-0">
            <div className="flex items-center gap-4 pr-8">
              <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-[18px] bg-secondary/40 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.1),0_10px_28px_-10px_hsl(0_0%_0%/0.7)]">
                {cover ? (
                  <img src={cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-primary/10">
                    <Package className="h-8 w-8 text-primary/70" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-left text-xl font-semibold tracking-tight">{mod.name}</DialogTitle>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                  {/* "Active"/"Inactive" rather than "Enabled"/"Disabled": the
                      launcher already uses the latter as the plural heading of
                      a filter, and one mod is not a filter. */}
                  <span className={cn("inline-flex items-center gap-1.5", mod.enabled && "text-emerald-300")}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", mod.enabled ? "bg-emerald-400" : "bg-muted-foreground/50")} />
                    {mod.enabled ? t("Active") : t("Inactive")}
                  </span>
                  {provider && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1.5">
                        <ProviderBadge provider={provider} variant="mark" />
                        {providerLabel(provider)}
                      </span>
                    </>
                  )}
                  {mod.author && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="truncate">{mod.author}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <DialogDescription className="pt-4 text-left text-[13.5px] leading-relaxed text-foreground/75">
              {/* The whole thing, wrapped. The list truncates it because the
                  list has one line; this does not have that excuse. */}
              {mod.description || t("No description")}
            </DialogDescription>
          </DialogHeader>

          <Group title={t("Information")}>
            <GroupRow label={t("Version")}>
              <span title={mod.version}>{mod.version}</span>
            </GroupRow>
            {loaders.length > 0 && (
              <GroupRow label={t("Loader")}>
                <span className="capitalize">{loaders.join(", ")}</span>
              </GroupRow>
            )}
            {/* Every version it covers, not the first one: whether a mod covers
                the version an instance runs is the question people open this
                to answer. Past four, the rest are counted. */}
            {versions.length > 0 && (
              <GroupRow label={t("Minecraft")}>
                <span title={versions.join(", ")}>
                  {versions.slice(0, 4).join(", ")}
                  {versions.length > 4 && ` +${versions.length - 4}`}
                </span>
              </GroupRow>
            )}
            <GroupRow label={t("Side")}>{sideLabel}</GroupRow>
            <GroupRow label={t("Size")}>
              {mod.file_size != null ? formatBytes(mod.file_size) : t("Unknown")}
            </GroupRow>
            <GroupRow label={t("Installed")}>{asDate(mod.install_date)}</GroupRow>
            <GroupRow label={t("Released")}>
              {mod.updated_at ? asDate(mod.updated_at) : t("Unknown")}
            </GroupRow>
          </Group>

          {/* Counted from what is on disk, not from what the archive claimed:
              a mod that unpacked to nothing looks identical in the list. */}
          <Group
            title={t("Files in this instance")}
            trailing={`${mod.deployed_file_count}/${mod.files.length}`}
          >
            {mod.files.length === 0 ? (
              <p className="py-3 text-xs text-muted-foreground">{t("This mod has no files recorded.")}</p>
            ) : (
              <ul className="max-h-40 divide-y divide-border/40 overflow-y-auto">
                {mod.files.map((file) => (
                  <li key={file} className="flex min-h-10 items-center gap-2.5 py-2" title={file}>
                    <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono text-[11.5px] text-foreground/80">{file}</span>
                  </li>
                ))}
              </ul>
            )}
          </Group>

          {mod.homepage_url && (
            <Button
              className="w-full"
              onClick={() => void openUrl(mod.homepage_url!).catch(() => undefined)}
            >
              <ExternalLink className="h-4 w-4" />
              {t("Open the mod page")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
