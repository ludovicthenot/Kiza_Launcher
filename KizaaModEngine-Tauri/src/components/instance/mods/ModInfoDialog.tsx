import type { ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowRight, CircleArrowUp, ExternalLink, FileCode2, FolderOpen, Power, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog";
import { cn, formatBytes } from "../../../lib/utils";
import { formatDate } from "../../../lib/datetime";
import { useI18n } from "../../../lib/i18n";
import { providerLabel, providerOf } from "../../common/ProviderBadge";
import { MenuItem, ProjectPageView, SideCard, SplitAction, type PageDetail } from "../discover/ProjectPageView";
import type { Mod } from "../../../lib/types";

/**
 * An installed mod opened whole: the same page a catalogue project gets --
 * its banner, its pictures, its author's description, its links -- with what
 * this instance holds of it at the top of the side: whether it is on, the
 * release on disk, the files it put there, and what to do with it.
 *
 * <p>A mod that came from a file rather than a catalogue has no page to ask
 * for, so it shows only what was read from the jar at install time.
 */
export function ModInfoDialog({
  mod,
  onClose,
  onToggle,
  toggling,
  onOpenFolder,
  onDelete,
  deleteBlockedReason,
  update,
}: {
  mod: Mod | null;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  toggling: boolean;
  onOpenFolder: () => void;
  onDelete: () => void;
  /** Why it cannot be removed right now, or null when it can. */
  deleteBlockedReason: string | null;
  /** A newer release the update check found for it. */
  update: { from: string; to: string } | null;
}) {
  const { t } = useI18n();
  if (!mod) return null;

  const cover = mod.cover_url ?? (mod.cover_path ? convertFileSrc(mod.cover_path) : null);
  const provider = providerOf(mod.source);
  const projectId = mod.project_id ?? "";

  const detail: PageDetail = {
    projectId,
    title: mod.name,
    author: mod.author ?? "",
    description: mod.description || t("No description"),
    iconUrl: cover,
    provider: provider && projectId ? provider : null,
    downloadsLabel: null,
    updatedLabel: mod.updated_at ? asDate(mod.updated_at) : null,
    licenseLabel: null,
    compatible: null,
    gallery: [],
    bannerUrl: null,
  };

  // "Active"/"Inactive" rather than "Enabled"/"Disabled": the launcher already
  // uses the latter as the plural heading of a filter, and one mod is not one.
  const status = (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", mod.enabled ? "text-emerald-300" : "text-muted-foreground")}>
      <span className={cn("h-1.5 w-1.5 rounded-full", mod.enabled ? "bg-emerald-400" : "bg-muted-foreground/50")} />
      {mod.enabled ? t("Active") : t("Inactive")}
    </span>
  );

  const filesTab = {
    id: "files",
    label: `${t("Files")} ${mod.deployed_file_count}/${mod.files.length}`,
    // Counted from what is on disk, not from what the archive claimed: a mod
    // that unpacked to nothing looks identical in the list.
    body:
      mod.files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("This mod has no files recorded.")}</p>
      ) : (
        <ul className="divide-y divide-border/40 rounded-xl bg-secondary/[0.32] px-4 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
          {mod.files.map((file) => (
            <li key={file} className="flex min-h-11 items-center gap-3 py-2" title={file}>
              <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-xs text-foreground/85">{file}</span>
            </li>
          ))}
        </ul>
      ),
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="h-[calc(100dvh-2rem)] w-[min(1240px,calc(100vw-24px))] max-w-none gap-0 overflow-y-auto rounded-2xl border-0 bg-background p-0 [container-type:inline-size] [&>button:last-child]:z-20 [&>button:last-child]:rounded-full [&>button:last-child]:bg-secondary/70 [&>button:last-child]:p-1.5 [&>button:last-child]:opacity-100 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.09),0_30px_80px_hsl(242_30%_2%/0.7)]">
        <DialogTitle className="sr-only">{mod.name}</DialogTitle>
        <DialogDescription className="sr-only">{mod.description || t("No description")}</DialogDescription>
        <ProjectPageView
          detail={detail}
          status={status}
          tabs={[filesTab]}
          primaryAction={
            <SplitAction
              tone={mod.enabled ? "quiet" : "primary"}
              label={mod.enabled ? t("Disable") : t("Enable")}
              icon={<Power className="h-[18px] w-[18px]" />}
              onClick={() => onToggle(!mod.enabled)}
              disabled={toggling}
              menu={(close) => (
                <>
                  <MenuItem
                    icon={<FolderOpen className="h-4 w-4" />}
                    onClick={() => {
                      close();
                      onOpenFolder();
                    }}
                  >
                    {t("Open folder")}
                  </MenuItem>
                  {mod.homepage_url && (
                    <MenuItem
                      icon={<ExternalLink className="h-4 w-4" />}
                      onClick={() => {
                        close();
                        void openUrl(mod.homepage_url!).catch(() => undefined);
                      }}
                    >
                      {provider ? `${t("Open on")} ${providerLabel(provider)}` : t("Open the mod page")}
                    </MenuItem>
                  )}
                  <div className="my-1.5 h-px bg-border/50" />
                  <MenuItem
                    danger
                    icon={<Trash2 className="h-4 w-4" />}
                    disabled={deleteBlockedReason !== null}
                    hint={deleteBlockedReason}
                    onClick={() => {
                      close();
                      onDelete();
                    }}
                  >
                    {t("Delete")}
                  </MenuItem>
                </>
              )}
            />
          }
          sideCard={<InstalledCard mod={mod} update={update} />}
        />
      </DialogContent>
    </Dialog>
  );
}

/** What the instance holds of the mod: the release on disk and what it covers. */
function InstalledCard({ mod, update }: { mod: Mod; update: { from: string; to: string } | null }) {
  const { t } = useI18n();

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

  const sideLabel = sideLabelOf(mod.side, t);

  return (
    <SideCard title={t("In this instance")}>
      <div className="space-y-4">
      <div className="truncate text-lg font-semibold tracking-[-0.01em]" title={mod.version}>
        {mod.version}
      </div>

      {update && (
        <div className="flex items-center gap-3 rounded-xl bg-amber-500/10 px-3.5 py-3 text-sm shadow-[inset_0_0_0_0.5px_hsl(38_92%_50%/0.25)]">
          <CircleArrowUp className="h-4 w-4 shrink-0 text-amber-300" />
          <div className="min-w-0">
            <div className="font-medium text-amber-200">{t("Update available")}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {update.from}
              <ArrowRight className="mx-1 inline h-3 w-3" />
              <span className="text-amber-300">{update.to}</span>
            </div>
          </div>
        </div>
      )}

      <dl className="space-y-2.5 text-sm">
        {loaders.length > 0 && <Fact label={t("Loader")}><span className="capitalize">{loaders.join(", ")}</span></Fact>}
        {/* Every version it covers, not the first one: whether a mod covers
            the version an instance runs is the question people open this to
            answer. Past four, the rest are counted. */}
        {versions.length > 0 && (
          <Fact label={t("Minecraft")} title={versions.join(", ")}>
            {versions.slice(0, 4).join(", ")}
            {versions.length > 4 && ` +${versions.length - 4}`}
          </Fact>
        )}
        <Fact label={t("Side")}>{sideLabel}</Fact>
        <Fact label={t("Size")}>{mod.file_size != null ? formatBytes(mod.file_size) : t("Unknown")}</Fact>
        <Fact label={t("Installed")}>{asDate(mod.install_date)}</Fact>
        <Fact label={t("Released")}>{mod.updated_at ? asDate(mod.updated_at) : t("Unknown")}</Fact>
      </dl>

      </div>
    </SideCard>
  );
}

function Fact({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium tabular-nums" title={title}>
        {children}
      </dd>
    </div>
  );
}

function sideLabelOf(side: string | null, t: (text: string) => string): string {
  switch (side) {
    case "client":
      return t("Client only");
    case "server":
      return t("Server only");
    case "both":
      return t("Client and server");
    default:
      return t("Unknown");
  }
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
  return formatDate(parsed);
}
