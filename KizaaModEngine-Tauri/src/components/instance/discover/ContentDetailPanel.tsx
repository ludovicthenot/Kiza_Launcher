import { ReactNode, useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Info,
  Heart,
  Loader2,
  Maximize2,
  Scale,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { ProviderBadge, providerLabel } from "../../common/ProviderBadge";
import { part } from "../../../lib/theme/parts";
import { ProjectGallery, type GalleryImage } from "./ProjectGallery";
import { MenuItem, ProjectPageView, SplitAction, pageGallery } from "./ProjectPageView";
import { useModpackProgress, useProjectPage, type PackProgress } from "../../../lib/queries";

/** One installable release, flattened from whichever platform it came from. */
export interface DetailVersion {
  id: string;
  /** What to show: the file name, or the version number. */
  name: string;
  /** Loader and game versions, already joined. */
  subtitle: string;
  sizeLabel?: string;
}

export interface ContentDetail {
  projectId: string;
  title: string;
  author: string;
  description: string;
  iconUrl: string | null;
  provider: "modrinth" | "curseforge";
  downloadsLabel: string | null;
  updatedLabel: string | null;
  licenseLabel: string | null;
  /** True when this project declares support for the instance's loader. */
  compatible: boolean | null;
  /** The project's pictures; empty when it has none. */
  gallery: GalleryImage[];
  /** The picture its author put forward, or the first: the banner behind the header. */
  bannerUrl: string | null;
}

export interface ContentDetailPanelProps {
  detail: ContentDetail;
  /** Where it goes; null for a modpack, which makes an instance of its own. */
  instanceName: string | null;
  /** Compatible releases, newest first. Empty until they are loaded. */
  versions: DetailVersion[];
  versionsLoaded: boolean;
  versionsLoading: boolean;
  onLoadVersions: () => void;
  /** Null while nothing is installed; otherwise the label of what to remove. */
  installedLabel: string | null;
  onUninstall?: () => void;
  uninstalling?: boolean;
  onInstall: (versionId: string) => void;
  installingVersionId: string | null;
  onDownloadOnly: (versionId: string) => void;
  downloadingVersionId: string | null;
  /** Every catalogue carrying this project, when it is on more than one. */
  availableSources?: ("modrinth" | "curseforge")[];
  onSelectSource?: (source: "modrinth" | "curseforge") => void;
  /** Only mods resolve dependencies; anything else hides the section. */
  supportsDependencies: boolean;
  /** Shown when the instance cannot take this content at all. */
  blockedReason?: ReactNode;
  /** `panel` beside the list, or `page`: the project opened whole. */
  layout?: "panel" | "page";
  /** Opens the project's own page; the panel shows the button for it when given. */
  onExpand?: () => void;
}

type Tab = "install" | "description" | "versions" | "dependencies";

function packStageLabel(progress: PackProgress | null | undefined, t: (text: string) => string): string {
  switch (progress?.stage) {
    case undefined:
      return t("Preparing the instance…");
    case "archive":
      return t("Downloading the modpack…");
    case "files":
      return t("Downloading the mods");
    case "overrides":
      return t("Unpacking its settings…");
    case "catalogue":
      return t("Adding the mods to the instance");
  }
}

/** What a modpack install is doing, in words and as a bar. */
function ModpackProgress({ progress, className }: { progress: PackProgress | null | undefined; className?: string }) {
  const { t } = useI18n();
  const counted = progress && progress.total > 0;
  const label = packStageLabel(progress, t);
  const share = counted ? Math.min(1, progress.done / progress.total) : null;
  return (
    <div className={cn("w-full", className)} role="status">
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        {counted && (
          <span className="shrink-0 tabular-nums">
            {progress.done} / {progress.total}
          </span>
        )}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
        {share === null ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
        ) : (
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-violet-400 transition-[width] duration-300 ease-out"
            style={{ width: `${Math.max(3, share * 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

function StatCell({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Download;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 flex-1 px-4 first:pl-0">
      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground/80">{label}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-[0.9375rem] font-semibold tabular-nums tracking-[-0.01em]">{value}</span>
      </div>
    </div>
  );
}

/**
 * Everything known about one search result, and the way to install it.
 *
 * The version to install is chosen explicitly rather than picked for you: the
 * newest build is usually right, but "usually" is not good enough when a mod's
 * latest release breaks on the loader you run.
 */
export function ContentDetailPanel({
  detail,
  instanceName,
  versions,
  versionsLoaded,
  versionsLoading,
  onLoadVersions,
  installedLabel,
  onUninstall,
  uninstalling = false,
  onInstall,
  installingVersionId,
  onDownloadOnly,
  downloadingVersionId,
  availableSources = [],
  onSelectSource,
  supportsDependencies,
  blockedReason,
  layout = "panel",
  onExpand,
}: ContentDetailPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("install");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [dependenciesOpen, setDependenciesOpen] = useState(false);
  // The project's page, asked as soon as it is chosen: its pictures are
  // the right size for the strip and the viewer, and opening the page
  // finds it already there.
  const projectPage = useProjectPage(detail.provider, detail.projectId, layout === "panel");
  const gallery = projectPage.data ? pageGallery(projectPage.data) : projectPage.isError ? detail.gallery : [];
  const bannerUrl = projectPage.data?.gallery[0]?.url ?? detail.bannerUrl;
  // A modpack becoming an instance takes a while; how far it has got is asked
  // for while it does.
  const makingInstance = !instanceName && !!installingVersionId;
  const packProgress = useModpackProgress(makingInstance).data;
  const favoriteKey = `kiza.favorite.${detail.provider}.${detail.projectId}`;
  const [favorite, setFavorite] = useState(() => localStorage.getItem(favoriteKey) === "true");

  // A page is read before it is installed from: its releases are asked for
  // at once, so the header's button knows what it will install.
  useEffect(() => {
    if (layout === "page" && !versionsLoaded && !versionsLoading) onLoadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, detail.provider, detail.projectId]);

  useEffect(() => {
    setTab("install");
    setPickerOpen(false);
    setChosenId(null);
    setDependenciesOpen(false);
    setFavorite(localStorage.getItem(favoriteKey) === "true");
  }, [favoriteKey]);

  const toggleFavorite = () => {
    const next = !favorite;
    setFavorite(next);
    if (next) localStorage.setItem(favoriteKey, "true");
    else localStorage.removeItem(favoriteKey);
  };

  // The newest compatible release is the recommendation, and the default.
  const recommended = versions[0] ?? null;
  const chosen = versions.find((version) => version.id === chosenId) ?? recommended;
  const busy =
    !!installingVersionId || !!downloadingVersionId || uninstalling || versionsLoading;

  const tabs: { id: Tab; label: string }[] = [
    { id: "install", label: t("Install") },
    { id: "description", label: t("Description") },
    { id: "versions", label: t("Versions") },
    ...(supportsDependencies ? [{ id: "dependencies" as Tab, label: t("Dependencies") }] : []),
  ];

  // What both layouts show: how to install it, and every release.
  const installBody = (
        <div className="space-y-3">
          {blockedReason}

          {installedLabel ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("Already installed in this instance.")}
              </p>
              {onUninstall && (
                <button
                  type="button"
                  onClick={onUninstall}
                  disabled={uninstalling}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/15 disabled:opacity-60"
                >
                  {uninstalling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {t("Uninstall")}
                </button>
              )}
            </div>
          ) : (
            <>
              <div>
                <div className="mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground/80">{t("Version to install")}</div>

                {!versionsLoaded ? (
                  <button
                    type="button"
                    onClick={onLoadVersions}
                    disabled={versionsLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-secondary/40 px-4 py-3 text-sm transition-[background-color] duration-150 hover:bg-secondary/55 disabled:opacity-60"
                  >
                    {versionsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {t("Load the available versions")}
                  </button>
                ) : versions.length === 0 ? (
                  <p className="rounded-xl bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
                    {instanceName ? t("No release of this project runs on this instance.") : t("This project has no release to install.")}
                  </p>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setPickerOpen((open) => !open)}
                      aria-expanded={pickerOpen}
                      className="flex w-full items-center gap-3 rounded-xl bg-secondary/40 px-4 py-3 text-left transition-[background-color] duration-150 hover:bg-secondary/55"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {chosen?.name}
                          {chosen?.id === recommended?.id && (
                            <span className="text-muted-foreground">
                              {" "}
                              — {t("Recommended")}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {chosen?.subtitle}
                          {chosen?.sizeLabel && ` • ${chosen.sizeLabel}`}
                        </span>
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition",
                          pickerOpen && "rotate-180",
                        )}
                      />
                    </button>

                    {pickerOpen && (
                      <div className="absolute z-20 mt-1.5 max-h-64 w-full origin-top overflow-y-auto rounded-xl bg-popover/95 p-1 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.08),0_18px_44px_hsl(242_30%_2%/0.6)] backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-150">
                        {versions.map((version) => (
                          <button
                            key={version.id}
                            type="button"
                            onClick={() => {
                              setChosenId(version.id);
                              setPickerOpen(false);
                            }}
                            className={cn(
                              "block w-full rounded-lg px-3 py-2.5 text-left transition-[background-color] duration-150 hover:bg-secondary/60",
                              version.id === chosen?.id && "text-primary",
                            )}
                          >
                            <span className="block truncate text-sm">{version.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {version.subtitle}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Stated, not offered as a choice. Kiza has no way to install a
                  mod while skipping its dependencies, so a switch here would do
                  nothing — and a tick that merely *looks* like a switch is
                  worse, because it invites a click that will never respond.
                  Marked disabled so it reads as fixed rather than broken. */}
              {supportsDependencies && (
                <div
                  role="checkbox"
                  aria-checked
                  aria-disabled
                  title={t("Kiza cannot install a mod without its required dependencies.")}
                  className="flex min-h-10 cursor-not-allowed items-center gap-2.5 text-sm text-muted-foreground"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-primary/50 text-primary-foreground">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    {t("Required dependencies are included automatically")}
                  </span>
                  <Info className="h-4 w-4 shrink-0" />
                </div>
              )}

              <button
                type="button"
                onClick={() => chosen && onInstall(chosen.id)}
                disabled={!chosen || busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary via-primary to-violet-500 px-4 py-3.5 text-sm font-semibold text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.18),0_8px_24px_-12px_hsl(var(--primary)/0.85)] transition-[filter,scale,opacity] duration-150 hover:brightness-110 active:scale-[0.96] disabled:opacity-60"
              >
                {installingVersionId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {instanceName
                  ? t("Install into {instance}").replace("{instance}", instanceName)
                  : t("Create the instance")}
              </button>
              {makingInstance && <ModpackProgress progress={packProgress} />}

              {/* Sometimes the file is wanted for a server or a friend, and
                  putting it in this instance would be the wrong thing. */}
              <button
                type="button"
                onClick={() => chosen && onDownloadOnly(chosen.id)}
                disabled={!chosen || busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-primary transition-[background-color,scale,opacity] duration-150 hover:bg-primary/10 active:scale-[0.97] disabled:opacity-60"
              >
                {downloadingVersionId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {t("Download only")}
              </button>

              {supportsDependencies && (
                <div className="border-t border-border/40 pt-1">
                  <button
                    type="button"
                    onClick={() => setDependenciesOpen((open) => !open)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-xl px-1 py-3 text-left transition-[background-color] duration-150 hover:bg-secondary/20"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{t("Dependencies")}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {/* Nothing is claimed before the check runs: the list
                            is resolved when you install, and saying "none
                            missing" beforehand would be a guess. */}
                        {t("Checked and installed with this mod")}
                      </span>
                    </span>
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition",
                        dependenciesOpen && "rotate-90",
                      )}
                    />
                  </button>
                  {dependenciesOpen && (
                    <p className="px-1 pb-3 text-xs leading-relaxed text-muted-foreground">
                      {t("Kiza reads the dependency list from the platform when you install, shows you what it found, and asks before adding anything.")}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
  );

  const versionsBody = (
        <div>
          {!versionsLoaded ? (
            <button
              type="button"
              onClick={onLoadVersions}
              disabled={versionsLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-secondary/40 px-4 py-3 text-sm transition-[background-color] duration-150 hover:bg-secondary/55 disabled:opacity-60"
            >
              {versionsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {t("Load the available versions")}
            </button>
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {instanceName ? t("No release of this project runs on this instance.") : t("This project has no release to install.")}
            </p>
          ) : (
            versions.map((version) => (
              <div
                key={version.id}
                className="flex items-center gap-3 border-b border-border/40 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{version.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{version.subtitle}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onInstall(version.id)}
                  disabled={busy || !!installedLabel}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
                >
                  {installingVersionId === version.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {t("Install")}
                </button>
              </div>
            ))
          )}
        </div>
  );

  const favoriteButton = (
    <button
      type="button"
      onClick={toggleFavorite}
      aria-label={favorite ? t("Remove from favorites") : t("Add to favorites")}
      aria-pressed={favorite}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-secondary/50 hover:text-foreground active:scale-[0.96]",
        favorite && "text-primary",
      )}
    >
      <Heart className={cn("h-6 w-6", favorite && "fill-current")} />
    </button>
  );

  if (layout === "page") {
    // Under the button: how far the install has got, or what it will install.
    let actionCaption: ReactNode = null;
    if (makingInstance) {
      actionCaption = <ModpackProgress progress={packProgress} className="w-[19rem]" />;
    } else if (versionsLoaded && chosen) {
      actionCaption = `${chosen.name}${chosen.id === recommended?.id ? ` — ${t("Recommended")}` : ""}`;
    } else if (versionsLoaded) {
      actionCaption = instanceName
        ? t("No release of this project runs on this instance.")
        : t("This project has no release to install.");
    }
    const action = installedLabel ? (
      <SplitAction
        tone="quiet"
        label={t("Installed")}
        icon={<CheckCircle2 className="h-[18px] w-[18px] text-emerald-400" />}
        onClick={() => undefined}
        disabled
        menu={
          onUninstall &&
          ((close) => (
            <MenuItem
              danger
              icon={uninstalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              disabled={uninstalling}
              onClick={() => {
                close();
                onUninstall();
              }}
            >
              {t("Uninstall")}
            </MenuItem>
          ))
        }
      />
    ) : (
      <SplitAction
        label={instanceName ? t("Install") : t("Create the instance")}
        icon={
          installingVersionId || versionsLoading ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          ) : (
            <Download className="h-[18px] w-[18px]" />
          )
        }
        onClick={() => (chosen ? onInstall(chosen.id) : onLoadVersions())}
        disabled={busy || (versionsLoaded && versions.length === 0)}
        caption={actionCaption}
        onMenuOpen={() => !versionsLoaded && !versionsLoading && onLoadVersions()}
        menu={(close) => (
          <div>
            <div className="px-3 pb-1.5 pt-2 text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground/80">
              {t("Version to install")}
            </div>
            {!versionsLoaded ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("Load the available versions")}
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                {versions.map((version) => (
                  <MenuItem
                    key={version.id}
                    selected={version.id === chosen?.id}
                    icon={version.id === chosen?.id ? <Check className="h-4 w-4" /> : null}
                    hint={[version.subtitle, version.sizeLabel].filter(Boolean).join(" • ")}
                    onClick={() => {
                      setChosenId(version.id);
                      close();
                    }}
                  >
                    {version.name}
                  </MenuItem>
                ))}
              </div>
            )}
            <div className="my-1.5 h-px bg-border/50" />
            {/* Sometimes the file is wanted for a server or a friend, and
                putting it in this instance would be the wrong thing. */}
            <MenuItem
              icon={downloadingVersionId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              disabled={!chosen || busy}
              onClick={() => {
                close();
                if (chosen) onDownloadOnly(chosen.id);
              }}
            >
              {t("Download only")}
            </MenuItem>
            {supportsDependencies && (
              <p className="flex items-center gap-2 px-3 pb-2 pt-1.5 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0" />
                {t("Required dependencies are included automatically")}
              </p>
            )}
          </div>
        )}
      />
    );
    return (
      <ProjectPageView
        detail={detail}
        availableSources={availableSources}
        onSelectSource={onSelectSource}
        favorite={{ active: favorite, onToggle: toggleFavorite }}
        primaryAction={action}
        notice={blockedReason && <div className="mb-5">{blockedReason}</div>}
        tabs={[{ id: "versions", label: t("Versions"), body: versionsBody }]}
      />
    );
  }

  return (
    <div key={`${detail.provider}:${detail.projectId}`} className="relative min-h-full animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      {bannerUrl ? (
        // The project's own picture behind its name, fading into the panel:
        // what it looks like, before a word of what it does.
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden rounded-t-2xl [mask-image:linear-gradient(to_bottom,black_30%,transparent)] contrast-more:hidden">
          <img
            src={bannerUrl}
            alt=""
            className="h-full w-full object-cover opacity-[0.42] animate-in fade-in-0 duration-500"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-card/10 via-card/30 to-card/80" />
          {/* Darker where the name sits: a banner is often words of its own. */}
          <div className="absolute inset-0 bg-gradient-to-r from-card/75 via-card/30 to-transparent" />
        </div>
      ) : detail.iconUrl ? (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black,transparent)] motion-reduce:hidden contrast-more:hidden">
          <img
            src={detail.iconUrl}
            alt=""
            className="h-full w-full scale-150 object-cover opacity-[0.28] blur-[64px] saturate-150"
          />
        </div>
      ) : null}

      <div className="relative space-y-6 px-8 pb-8 pt-7">
      <div className="flex items-start gap-6">
        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-[24px] bg-secondary/30 shadow-[0_12px_32px_-12px_hsl(242_30%_2%/0.8)]">
          {detail.iconUrl ? (
            <img src={detail.iconUrl} alt="" className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-white/10" />
          ) : (
            <div className="h-full w-full bg-primary/10" />
          )}
        </div>

        <div className="min-w-0 flex-1 pt-1">
          <h2 {...part("discover.project-title")} className="line-clamp-2 text-[1.875rem] font-bold leading-[1.1] tracking-[-0.025em]">{detail.title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <span className="truncate text-muted-foreground">
              {t("By")} {detail.author}
            </span>
            {availableSources.length > 1 && onSelectSource ? (
              // Both catalogues list this project, and their builds are not
              // always the same. The switch keeps that choice visible rather
              // than picking one for you.
              <span className="inline-flex items-center gap-0.5 rounded-[10px] bg-secondary/50 p-[3px] backdrop-blur-md">
                {availableSources.map((source) => (
                  <button
                    key={source}
                    type="button"
                    onClick={() => onSelectSource(source)}
                    aria-pressed={source === detail.provider}
                    className={cn(
                      "rounded-[7px] px-2.5 py-1 text-xs font-medium transition-[background-color,color,box-shadow] duration-200",
                      source === detail.provider
                        ? "bg-background text-foreground shadow-[0_1px_3px_hsl(242_30%_2%/0.45)]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {providerLabel(source)}
                  </button>
                ))}
              </span>
            ) : (
              <ProviderBadge provider={detail.provider} variant="subtle" className="py-1 text-xs" />
            )}
          </div>

          {/* Said plainly, because it is the one thing that decides whether any
              of the rest is worth reading. */}
          {detail.compatible !== null && (
            <div
              className={cn(
                "mt-2.5 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium",
                detail.compatible ? "text-emerald-400" : "text-amber-400",
              )}
            >
              {detail.compatible ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <TriangleAlert className="h-4 w-4" />
              )}
              {detail.compatible
                ? t("Compatible with this instance")
                : t("Not built for this instance")}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              aria-label={t("Open its page")}
              title={t("Open its page")}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-secondary/50 hover:text-foreground active:scale-[0.96]"
            >
              <Maximize2 className="h-5 w-5" />
            </button>
          )}
          {favoriteButton}
        </div>
      </div>

      <p className="max-w-[62ch] text-[0.9375rem] leading-relaxed text-foreground/80">{detail.description}</p>

      <ProjectGallery images={gallery} projectTitle={detail.title} />

      {/* Three facts in a row, divided by hairlines and nothing else. */}
      <div className="flex divide-x divide-border/40">
        <StatCell icon={Download} label={t("downloads")} value={detail.downloadsLabel ?? "—"} />
        <StatCell icon={Clock} label={t("Updated")} value={detail.updatedLabel ?? t("Not specified")} />
        <StatCell icon={Scale} label={t("Licence")} value={detail.licenseLabel ?? t("Not specified")} />
      </div>

      <div className="flex gap-6 overflow-x-auto border-b border-border/40">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              "-mb-px min-h-11 shrink-0 border-b-2 pt-1 text-sm font-medium transition-[border-color,color] duration-150",
              tab === entry.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "install" && installBody}

      {tab === "description" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {detail.title}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {detail.description || t("This project has no description.")}
          </p>
        </div>
      )}

      {tab === "versions" && versionsBody}

      {tab === "dependencies" && (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            {t("Kiza reads the dependency list from the platform when you install, shows you what it found, and asks before adding anything.")}
          </p>
          <p>{t("Required dependencies will be added with this mod.")}</p>
        </div>
      )}
      </div>
    </div>
  );
}
