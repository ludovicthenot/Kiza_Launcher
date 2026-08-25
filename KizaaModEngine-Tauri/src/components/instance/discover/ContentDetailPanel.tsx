import { ReactNode, useEffect, useState } from "react";
import {
  BadgeCheck,
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
  Scale,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { ProviderBadge, providerLabel } from "../../common/ProviderBadge";

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
}

export interface ContentDetailPanelProps {
  detail: ContentDetail;
  instanceName: string;
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
}

type Tab = "install" | "description" | "versions" | "dependencies";

function StatCell({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Download;
  value: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{value}</div>
        <div className="truncate text-xs text-muted-foreground">{label}</div>
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
}: ContentDetailPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("install");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [dependenciesOpen, setDependenciesOpen] = useState(false);
  const favoriteKey = `kiza.favorite.${detail.provider}.${detail.projectId}`;
  const [favorite, setFavorite] = useState(() => localStorage.getItem(favoriteKey) === "true");

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

  return (
    <div className="min-h-full space-y-5 rounded-xl bg-card/20 p-6 shadow-[0_0_0_1px_hsl(var(--border)/0.85)]">
      <div className="flex items-start gap-8">
        <div className="h-[102px] w-[102px] shrink-0 overflow-hidden rounded-[10px] bg-secondary/30 shadow-[0_0_0_1px_hsl(var(--border)/0.9)]">
          {detail.iconUrl ? (
            <img src={detail.iconUrl} alt="" className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-white/10" />
          ) : (
            <div className="h-full w-full bg-primary/10" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="-mt-3 truncate text-2xl font-bold tracking-tight">{detail.title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <span className="truncate text-muted-foreground">
              {t("By")} {detail.author}
            </span>
            {availableSources.length > 1 && onSelectSource ? (
              // Both catalogues list this project, and their builds are not
              // always the same. The switch keeps that choice visible rather
              // than picking one for you.
              <span className="inline-flex items-center gap-1 rounded-lg bg-secondary/40 p-0.5">
                {availableSources.map((source) => (
                  <button
                    key={source}
                    type="button"
                    onClick={() => onSelectSource(source)}
                    aria-pressed={source === detail.provider}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-medium transition",
                      source === detail.provider
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {providerLabel(source)}
                  </button>
                ))}
              </span>
            ) : (
              <ProviderBadge provider={detail.provider} className="py-1 text-xs" />
            )}
            <BadgeCheck className="h-4 w-4 text-muted-foreground/60" />
          </div>

          {/* Said plainly, because it is the one thing that decides whether any
              of the rest is worth reading. */}
          {detail.compatible !== null && (
            <div
              className={cn(
                "mt-1.5 inline-flex items-center gap-1.5 text-sm",
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
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">{detail.description}</p>

      <div className="grid grid-cols-3 rounded-xl bg-secondary/15 px-1 py-4 shadow-[0_0_0_1px_hsl(var(--border)/0.55)]">
        <div className="px-4">
          <StatCell icon={Download} value={detail.downloadsLabel ?? "—"} label={t("downloads")} />
        </div>
        <div className="border-x border-border/50 px-4">
          <StatCell icon={Clock} value={t("Updated")} label={detail.updatedLabel ?? t("Not specified")} />
        </div>
        <div className="px-4">
          <StatCell icon={Scale} value={t("Licence")} label={detail.licenseLabel ?? t("Not specified")} />
        </div>
      </div>

      <div className="flex gap-6 overflow-x-auto border-b border-border/60">
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

      {tab === "install" && (
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
                <div className="mb-1.5 text-sm font-medium">{t("Version to install")}</div>

                {!versionsLoaded ? (
                  <button
                    type="button"
                    onClick={onLoadVersions}
                    disabled={versionsLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm transition hover:border-primary/40 disabled:opacity-60"
                  >
                    {versionsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {t("Load the available versions")}
                  </button>
                ) : versions.length === 0 ? (
                  <p className="rounded-xl border border-border/70 bg-secondary/20 px-4 py-3 text-sm text-muted-foreground">
                    {t("No release of this project runs on this instance.")}
                  </p>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setPickerOpen((open) => !open)}
                      aria-expanded={pickerOpen}
                      className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-left transition hover:border-primary/40"
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
                      <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border/70 bg-card shadow-2xl">
                        {versions.map((version) => (
                          <button
                            key={version.id}
                            type="button"
                            onClick={() => {
                              setChosenId(version.id);
                              setPickerOpen(false);
                            }}
                            className={cn(
                              "block w-full px-4 py-2.5 text-left transition hover:bg-secondary/60",
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
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary via-primary to-violet-500 px-4 py-3.5 text-sm font-semibold text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.18),0_8px_24px_-12px_hsl(var(--primary)/0.85)] transition-[filter,scale,opacity] duration-150 hover:brightness-110 active:scale-[0.96] disabled:opacity-60"
              >
                {installingVersionId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {t("Install into {instance}").replace("{instance}", instanceName)}
              </button>

              {/* Sometimes the file is wanted for a server or a friend, and
                  putting it in this instance would be the wrong thing. */}
              <button
                type="button"
                onClick={() => chosen && onDownloadOnly(chosen.id)}
                disabled={!chosen || busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-secondary/20 px-4 py-3 text-sm font-medium shadow-[0_0_0_1px_hsl(var(--border)/0.85)] transition-[background-color,box-shadow,scale,opacity] duration-150 hover:bg-secondary/35 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.4)] active:scale-[0.96] disabled:opacity-60"
              >
                {downloadingVersionId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {t("Download only")}
              </button>

              {supportsDependencies && (
                <div className="rounded-lg bg-secondary/15 shadow-[0_0_0_1px_hsl(var(--border)/0.7)]">
                  <button
                    type="button"
                    onClick={() => setDependenciesOpen((open) => !open)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-[background-color,scale] duration-150 hover:bg-secondary/20 active:scale-[0.96]"
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
                    <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
                      {t("Kiza reads the dependency list from the platform when you install, shows you what it found, and asks before adding anything.")}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

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

      {tab === "versions" && (
        <div className="space-y-2">
          {!versionsLoaded ? (
            <button
              type="button"
              onClick={onLoadVersions}
              disabled={versionsLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm transition hover:border-primary/40 disabled:opacity-60"
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
              {t("No release of this project runs on this instance.")}
            </p>
          ) : (
            versions.map((version) => (
              <div
                key={version.id}
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/30 p-3"
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
      )}

      {tab === "dependencies" && (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            {t("Kiza reads the dependency list from the platform when you install, shows you what it found, and asks before adding anything.")}
          </p>
          <p>{t("Required dependencies will be added with this mod.")}</p>
        </div>
      )}
    </div>
  );
}
