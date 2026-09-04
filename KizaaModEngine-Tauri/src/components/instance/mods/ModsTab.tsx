import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  useApplyInstanceUpdates,
  useDeleteMod,
  useInstallMod,
  useInstanceUpdates,
  useInstallMissingDependency,
  useModCompatibility,
  useMods,
  useOpenModFolder,
  useRunningInstances,
  useSafeModeStart,
  useSafeModeStatus,
  useToggleMod,
} from "../../../lib/queries";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleArrowUp,
  CircleCheck,
  CirclePause,
  Download,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  MoreVertical,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldQuestion,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { DismissibleNotice } from "../../ui/dismissible-notice";
import { UpdateCenterPanel } from "../UpdateCenterPanel";
import { SafeModePanel } from "../SafeModePanel";
import { Checkbox } from "../../ui/checkbox";
import { cn } from "../../../lib/utils";
import { ConfirmActionDialog } from "../../ui/confirm-action-dialog";
import { useI18n } from "../../../lib/i18n";
import { useAppStore } from "../../../lib/store";
import { LauncherOptionPicker } from "../../ui/launcher-option-picker";
import { ProviderBadge, providerLabel, providerOf } from "../../common/ProviderBadge";
import { ModInfoDialog } from "./ModInfoDialog";
import type { Mod } from "../../../lib/types";

interface ModsTabProps {
  instanceId: string;
  lastVerifiedAt?: string | null;
}

interface PendingModDeletion {
  id: string;
  name: string;
  enabled: boolean;
  deployedFileCount: number;
}

type PendingDeletion =
  | { kind: "single"; mod: PendingModDeletion }
  | { kind: "bulk"; mods: PendingModDeletion[] };

type Filter = "all" | "enabled" | "disabled";
type SortKey = "name" | "load_order" | "enabled";

/**
 * How a mod's stored `source` reads in the filter and the search index.
 *
 * A mod installed from a file has a source Kiza has no mark for — the file
 * name, or nothing at all. It keeps its own words rather than being forced into
 * one of the two catalogues, because "where did this come from" is exactly the
 * question the badge exists to answer honestly.
 */
function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  const provider = providerOf(source);
  return provider ? providerLabel(provider) : source;
}

function deletionDescription(pending: PendingDeletion | null): string {
  if (!pending) return "";
  if (pending.kind === "bulk") {
    return `Delete ${pending.mods.length} mods from this instance? Their deployed files will also be removed. This cannot be undone.`;
  }

  const mod = pending.mod;
  const activeState = mod.enabled
    ? "This mod is active and will be removed from every profile."
    : "This mod will be removed from every profile.";
  const deployedState =
    mod.deployedFileCount > 0
      ? `${mod.deployedFileCount} deployed file${mod.deployedFileCount === 1 ? "" : "s"} will also be removed from the instance.`
      : "No deployed files are currently tracked for this mod.";

  return `Delete ${mod.name} from this instance? ${activeState} ${deployedState} This cannot be undone.`;
}

function relativeCheckLabel(date: Date, t: (key: string) => string): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (elapsedMinutes < 1) return t("just now");
  if (elapsedMinutes < 60) {
    return t("{count} min ago").replace("{count}", String(elapsedMinutes));
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return t("{count} h ago").replace("{count}", String(elapsedHours));
}

export function ModsTab({ instanceId, lastVerifiedAt = null }: ModsTabProps) {
  const { t } = useI18n();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const { data: mods, isLoading, error } = useMods(instanceId);
  const toggleMod = useToggleMod();
  const installMod = useInstallMod();
  const deleteMod = useDeleteMod();
  const openModFolder = useOpenModFolder();
  const applyUpdates = useApplyInstanceUpdates();
  const { data: runningInstances } = useRunningInstances();
  const instanceIsRunning = runningInstances?.[instanceId] !== undefined;

  const checkUpdates = useInstanceUpdates(instanceId);
  const { data: safeMode } = useSafeModeStatus(instanceId);
  const startSafeMode = useSafeModeStart();

  const modsKey = useMemo(
    () => (mods ?? []).map((mod) => `${mod.id}:${mod.enabled ? 1 : 0}`).join(","),
    [mods],
  );
  const { data: compat } = useModCompatibility(instanceId, modsKey);
  const installMissing = useInstallMissingDependency();
  const compatProblems = useMemo(
    () => (compat?.mods ?? []).filter((entry) => entry.issues.length > 0),
    [compat],
  );

  const [searchQuery, setSearchQuery] = useState("");
  // The mod whose details are on screen, or none.
  const [infoMod, setInfoMod] = useState<Mod | null>(null);
  const [filterEnabled, setFilterEnabled] = useState<Filter>("all");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showUpdates, setShowUpdates] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(() =>
    lastVerifiedAt ? new Date(lastVerifiedAt) : null,
  );

  const all = mods ?? [];
  const enabledCount = all.filter((mod) => mod.enabled).length;

  const updatesByModId = useMemo(() => {
    const map = new Map<string, { from: string; to: string; path: string }>();
    const candidates = (checkUpdates.data ?? []).filter(
      (candidate) => candidate.status === "available",
    );
    for (const candidate of candidates) {
      const fileName = candidate.path.split(/[\\/]/).pop() ?? candidate.path;
      const owner = all.find((mod) =>
        // Defended rather than trusted. This line ran for the first time on the
        // day the update check finally found something, and a field the backend
        // had never actually been sending took the whole interface down.
        (mod.files ?? []).some((file) => file.split(/[\\/]/).pop() === fileName),
      );
      if (owner && candidate.target) {
        map.set(owner.id, {
          from: owner.version,
          to: candidate.target.version_name,
          path: candidate.path,
        });
      }
    }
    return map;
  }, [checkUpdates.data, all]);

  const sources = useMemo(() => {
    const found = new Set<string>();
    for (const mod of all) {
      const source = sourceLabel(mod.source);
      if (source) found.add(source);
    }
    return Array.from(found).sort();
  }, [all]);

  const visible = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    const filtered = all.filter((mod) => {
      const matchesSearch =
        !needle ||
        mod.name.toLowerCase().includes(needle) ||
        (mod.description ?? "").toLowerCase().includes(needle);
      const matchesState =
        filterEnabled === "all"
          ? true
          : filterEnabled === "enabled"
            ? mod.enabled
            : !mod.enabled;
      const matchesSource = !sourceFilter || sourceLabel(mod.source) === sourceFilter;
      return matchesSearch && matchesState && matchesSource;
    });

    return [...filtered].sort((left, right) => {
      if (sortKey === "name") return left.name.localeCompare(right.name);
      if (sortKey === "load_order") return left.load_order - right.load_order;
      return left.enabled === right.enabled ? 0 : left.enabled ? -1 : 1;
    });
  }, [all, searchQuery, filterEnabled, sourceFilter, sortKey]);

  const selectedMods = all.filter((mod) => selected.has(mod.id));
  const selectedUpdatePaths = selectedMods
    .map((mod) => updatesByModId.get(mod.id)?.path)
    .filter((path): path is string => !!path);
  const contentSynced = all.length === 0 || all.every((mod) => mod.deployed_file_count > 0);

  const coverSrc = (mod: (typeof all)[number]) => {
    if (mod.cover_url) return mod.cover_url;
    if (mod.cover_path) return convertFileSrc(mod.cover_path);
    return null;
  };

  const handleInstallMod = async () => {
    const chosen = await open({
      multiple: false,
      filters: [{ name: "Archives", extensions: ["jar", "zip", "7z", "rar"] }],
      title: t("Select a mod archive"),
    });
    if (typeof chosen === "string") {
      installMod.mutate({ instanceId, archivePath: chosen });
    }
  };

  const runUpdateCheck = (revealCenter: boolean) => {
    if (revealCenter) setShowUpdates(true);
    checkUpdates.mutate(undefined, { onSuccess: () => setLastCheckedAt(new Date()) });
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setSelectedEnabled = (enabled: boolean) => {
    for (const mod of selectedMods) {
      if (mod.enabled !== enabled) {
        toggleMod.mutate({ instanceId, modId: mod.id, enabled });
      }
    }
    setSelected(new Set());
  };

  const confirmDeletion = async () => {
    if (!pendingDeletion) return;
    if (pendingDeletion.kind === "single") {
      deleteMod.mutate(
        { instanceId, modId: pendingDeletion.mod.id },
        { onSuccess: () => setPendingDeletion(null) },
      );
      return;
    }
    const targets =
      pendingDeletion.mods;
    setDeletionBusy(true);
    try {
      for (const mod of targets) {
        await deleteMod.mutateAsync({ instanceId, modId: mod.id });
      }
      setSelected(new Set());
      setPendingDeletion(null);
    } finally {
      setDeletionBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-destructive">
        <Package className="mb-4 h-12 w-12 opacity-50" />
        <h3 className="text-lg font-medium">{t("Failed to load mods")}</h3>
        <p className="mt-1 max-w-sm text-center text-sm opacity-80">{String(error)}</p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background/35">
      <ConfirmActionDialog
        open={!!pendingDeletion}
        onOpenChange={(isOpen) => {
          if (!isOpen && !deletionBusy) setPendingDeletion(null);
        }}
        title={pendingDeletion?.kind === "bulk" ? "Delete selected mods" : "Delete mod"}
        description={deletionDescription(pendingDeletion)}
        confirmLabel={pendingDeletion?.kind === "bulk" ? "Delete selected mods" : "Delete mod"}
        destructive
        busy={deletionBusy}
        onConfirm={() => void confirmDeletion()}
      />

      <header className="flex min-h-[102px] shrink-0 items-center justify-between gap-4 border-b border-border/55 px-8 py-5">
        <div className="min-w-0">
          <h1 className="text-[23px] font-bold tracking-tight">{t("Mods")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("{count} installed").replace("{count}", String(all.length))}{" "}
            <span className="mx-1">•</span> {enabledCount}{" "}
            {t("active")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveTab("discover")}
            className="inline-flex h-12 items-center gap-2 rounded-xl kiza-action px-6 text-sm font-semibold text-primary-foreground transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98]"
          >
            <Plus className="h-5 w-5" />
            {t("Add a mod")}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setHeaderMenuOpen((openMenuState) => !openMenuState)}
              title={t("More actions")}
              aria-label={t("More actions")}
              aria-expanded={headerMenuOpen}
              className="flex h-12 w-14 items-center justify-center rounded-xl border border-border/75 bg-card/35 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {headerMenuOpen && (
              <div className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    void handleInstallMod();
                  }}
                  disabled={installMod.isPending}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-secondary/60 disabled:opacity-60"
                >
                  {installMod.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {t("Install from a file")}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="shrink-0 border-b border-border/45 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("Search a mod…")}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-12 w-full rounded-xl border border-border/70 bg-card/30 pl-11 pr-4 text-sm outline-none transition-[border-color,box-shadow] focus:border-primary/50 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.1)]"
            />
          </div>

          <div className="flex h-12 shrink-0 items-center rounded-xl border border-border/70 bg-card/30 p-1">
            {(
              [
                ["all", t("All"), all.length],
                ["enabled", t("Active mods"), enabledCount],
                ["disabled", t("Disabled"), all.length - enabledCount],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilterEnabled(value)}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-[background-color,color,box-shadow]",
                  filterEnabled === value
                    ? "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                <span
                  className={cn(
                    "rounded-full bg-secondary/75 px-2 py-0.5 text-[11px] tabular-nums",
                    filterEnabled === value && "bg-primary/10",
                  )}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>

          <div className="w-[190px] shrink-0">
            <LauncherOptionPicker
              ariaLabel={t("Filter by source")}
              options={[
                { value: "", label: t("All sources") },
                ...sources.map((source) => ({ value: source, label: source })),
              ]}
              value={sourceFilter}
              onValueChange={setSourceFilter}
              placeholder={t("All sources")}
            />
          </div>

          <div className="w-[136px] shrink-0">
            <LauncherOptionPicker
              ariaLabel={t("Sort the list")}
              options={[
                { value: "name", label: t("Name A–Z") },
                { value: "enabled", label: t("Active first") },
                { value: "load_order", label: t("Load order") },
              ]}
              value={sortKey}
              onValueChange={(value) => setSortKey(value as SortKey)}
              placeholder={t("Name A–Z")}
            />
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                if (updatesByModId.size > 0) {
                  setShowUpdates((visibleState) => !visibleState);
                } else {
                  runUpdateCheck(false);
                }
              }}
              disabled={checkUpdates.isPending}
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-border/70 bg-card/30 px-4 text-sm font-medium transition-[border-color,background-color] hover:border-primary/40 hover:bg-secondary/30 disabled:opacity-60"
            >
              {checkUpdates.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t("Check for updates")}
            </button>
            {updatesByModId.size > 0 && (
              <span className="pointer-events-none absolute -bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-primary/15 bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {updatesByModId.size} {updatesByModId.size === 1 ? t("update") : t("updates")}
              </span>
            )}
          </div>
        </div>
      </section>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          selected.size > 0 ? "pb-[92px]" : "pb-0",
        )}
      >
        {safeMode ? (
          <div className="m-5 mb-4">
            <SafeModePanel instanceId={instanceId} />
          </div>
        ) : (
          <DismissibleNotice
            signature={`safe-mode-offer:${instanceId}`}
            className="mx-5 mb-4 mt-1 rounded-xl border border-border/75 bg-card/20 px-5 py-4"
          >
            <div className="flex min-h-11 items-center gap-4">
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{t("Is a mod crashing the game?")}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {t("Run the hunt to find which one, by halves rather than one at a time.")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => startSafeMode.mutate({ instanceId })}
                disabled={startSafeMode.isPending || all.length === 0}
                className="mr-6 inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-border/75 bg-card/35 px-5 text-sm font-medium transition-[border-color,background-color] hover:border-primary/40 hover:bg-secondary/30 disabled:opacity-60"
              >
                {startSafeMode.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldQuestion className="h-4 w-4" />
                )}
                {t("Run the diagnosis")}
              </button>
            </div>
          </DismissibleNotice>
        )}

        {showUpdates && (
          <div className="mx-5 mb-4">
            <UpdateCenterPanel instanceId={instanceId} />
          </div>
        )}

        {compat && compatProblems.length > 0 && (
          <DismissibleNotice
            signature={`compat-issues:${instanceId}:${compat.mc_version}:${compatProblems
              .map((entry) => `${entry.file_name}#${entry.issues.length}`)
              .join(",")}`}
            className="mx-5 mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
              <span className="text-sm font-medium text-amber-200">
                {compat.errors > 0
                  ? `${compat.errors} ${t(compat.errors > 1 ? "compatibility problems" : "compatibility problem")}`
                  : `${compat.warnings} ${t(compat.warnings > 1 ? "warnings" : "warning")}`}
                {" — Minecraft "}
                {compat.mc_version}
              </span>
            </div>

            {/* What is actually wrong, and with which file. The backend has
                always said so — "Fabric mod detected in a Forge instance", a
                missing dependency by name — and this notice threw all of it
                away and printed a number, which tells someone there is a
                problem and nothing about how to end it. */}
            <ul className="mt-3 space-y-2">
              {compatProblems.map((entry) => (
                <li key={entry.file_name} className="text-xs leading-relaxed">
                  <span className="font-medium text-foreground">
                    {entry.name ?? entry.file_name}
                  </span>
                  {entry.name && (
                    <span className="ml-1.5 text-muted-foreground">{entry.file_name}</span>
                  )}
                  <ul className="mt-0.5 space-y-0.5">
                    {entry.issues.map((issue, index) => (
                      <li
                        key={`${entry.file_name}:${index}`}
                        className={cn(
                          "flex flex-wrap items-baseline gap-1.5",
                          issue.severity === "error" ? "text-red-300" : "text-amber-200/80",
                        )}
                      >
                        <span aria-hidden className="select-none">
                          {issue.severity === "error" ? "✕" : "!"}
                        </span>
                        <span className="min-w-0 break-words">{issue.message}</span>
                        {/* The notice knew which mod was missing and could only
                            name it, leaving the reader to go and find the right
                            project among the near misses. */}
                        {issue.missing_dependency && (
                          <button
                            type="button"
                            disabled={installMissing.isPending}
                            onClick={() =>
                              installMissing.mutate({
                                instanceId,
                                dependencyId: issue.missing_dependency as string,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-foreground transition hover:bg-primary/20 disabled:opacity-60"
                          >
                            {installMissing.isPending &&
                            installMissing.variables?.dependencyId === issue.missing_dependency ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            {t("Install it")}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </DismissibleNotice>
        )}

        {all.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-secondary/30">
              <Package className="h-8 w-8 opacity-50" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-foreground">{t("No mods installed")}</h3>
            <p className="mb-6 max-w-xs text-center text-sm">
              {t("This instance is empty. Add your first mod to get started.")}
            </p>
            <button
              type="button"
              onClick={() => setActiveTab("discover")}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-medium text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" />
              {t("Add a mod")}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {t("No mods match your current filter or search query.")}
          </p>
        ) : (
          <div className="border-y border-border/50">
            {visible.map((mod) => {
              const update = updatesByModId.get(mod.id);
              const cover = coverSrc(mod);
              const source = sourceLabel(mod.source);
              const provider = providerOf(mod.source);
              return (
                <div
                  key={mod.id}
                  className={cn(
                    "relative border-b border-border/50 last:border-b-0",
                    selected.has(mod.id) ? "bg-primary/[0.035]" : "hover:bg-secondary/[0.08]",
                  )}
                >
                  <div className="flex min-h-[84px] items-center gap-4 px-7 py-3">
                    <Checkbox
                      checked={selected.has(mod.id)}
                      onChange={() => toggleSelected(mod.id)}
                      aria-label={`Sélectionner ${mod.name}`}
                      className="h-6 w-6"
                    />

                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-secondary/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      {cover ? (
                        <img src={cover} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-primary/10">
                          <Package className="h-6 w-6 text-primary/70" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-[1.3]">
                      <button
                        type="button"
                        onClick={() => setInfoMod(mod)}
                        title={t("Show mod information")}
                        className="block max-w-full truncate rounded text-left text-sm font-semibold transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        {mod.name}
                      </button>
                      <div className="mt-1 truncate text-sm text-muted-foreground">
                        {mod.description || t("No description")}
                      </div>
                    </div>

                    <div className="hidden min-w-[300px] flex-1 items-center gap-2 lg:flex">
                      <span className="sr-only">
                        {mod.deployed_file_count > 0
                          ? `Deployed (${mod.deployed_file_count})`
                          : "Not deployed"}
                      </span>
                      {provider ? (
                        <ProviderBadge provider={provider} />
                      ) : (
                        source && (
                          <span className="rounded-md border border-border/70 bg-secondary/30 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                            {source}
                          </span>
                        )
                      )}
                      {mod.loaders.slice(0, 1).map((loader) => (
                        <span
                          key={loader}
                          className="rounded-md border border-border/70 bg-secondary/20 px-2 py-1 text-[11px] capitalize text-muted-foreground"
                        >
                          {loader}
                        </span>
                      ))}
                      {mod.game_versions.slice(0, 1).map((version) => (
                        <span
                          key={version}
                          className="rounded-md border border-border/70 bg-secondary/20 px-2 py-1 text-[11px] text-muted-foreground"
                        >
                          MC {version}
                        </span>
                      ))}
                    </div>

                    <div className="hidden w-[225px] shrink-0 text-left md:block">
                      {update ? (
                        <>
                          <div className="truncate text-sm text-muted-foreground">
                            <span className="text-foreground">{update.from}</span>
                            <ArrowRight className="mx-1 inline h-3.5 w-3.5" />
                            <span className="text-amber-400">{update.to}</span>
                          </div>
                          <span className="mt-1 inline-block rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                            {t("Update")}
                          </span>
                        </>
                      ) : (
                        <span className="truncate text-sm text-muted-foreground">{mod.version}</span>
                      )}
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={mod.enabled}
                      aria-label={`${mod.enabled ? "Désactiver" : "Activer"} ${mod.name}`}
                      disabled={toggleMod.isPending || deletionBusy}
                      onClick={() =>
                        toggleMod.mutate({ instanceId, modId: mod.id, enabled: !mod.enabled })
                      }
                      className={cn(
                        "relative h-7 w-[52px] shrink-0 rounded-full transition-colors disabled:opacity-50",
                        mod.enabled
                          ? "kiza-action-sm"
                          : "bg-muted",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-[left] duration-150",
                          mod.enabled ? "left-7" : "left-1",
                        )}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === mod.id ? null : mod.id)}
                      title={t("More actions")}
                      aria-label={`More actions for ${mod.name}`}
                      aria-expanded={openMenu === mod.id}
                      className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                  </div>

                  {openMenu === mod.id && (
                    <div className="flex items-center gap-2 border-t border-border/50 bg-card/20 px-7 py-2">
                      <button
                        type="button"
                        onClick={() => openModFolder.mutate({ instanceId, modId: mod.id })}
                        className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-secondary/20 px-3 py-2 text-xs transition-colors hover:border-primary/40"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        {t("Open folder")}
                      </button>
                      <span className="text-xs text-muted-foreground">#{mod.load_order}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingDeletion({
                            kind: "single",
                            mod: {
                              id: mod.id,
                              name: mod.name,
                              enabled: mod.enabled,
                              deployedFileCount: mod.deployed_file_count,
                            },
                          })
                        }
                        disabled={instanceIsRunning || deletionBusy}
                        aria-label={`Delete ${mod.name}`}
                        title={
                          instanceIsRunning
                            ? t("Stop Minecraft before deleting mods")
                            : `Supprimer ${mod.name}`
                        }
                        className="ml-auto inline-flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300 transition-colors hover:bg-red-500/15 disabled:opacity-45"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("Delete")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {compat && compatProblems.length === 0 && all.length > 0 && (
          <p className="mx-7 my-4 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            {t("All {count} mods are compatible with Minecraft {version}.")
              .replace("{count}", String(compat.mods.length))
              .replace("{version}", compat.mc_version)}
          </p>
        )}
      </div>

      <footer className="flex h-[54px] shrink-0 items-center gap-3 border-t border-border/60 bg-card/20 px-7 text-sm text-muted-foreground">
        <CheckCircle2
          className={cn("h-5 w-5", contentSynced ? "text-emerald-400" : "text-amber-400")}
        />
        <span>{contentSynced ? t("Content synced") : t("Sync required")}</span>
        <span>•</span>
        <span>
          {t("Last checked")}{" "}
          {lastCheckedAt ? relativeCheckLabel(lastCheckedAt, t) : t("Not checked").toLowerCase()}
        </span>
      </footer>

      {selected.size > 0 && (
        <div className="absolute inset-x-3 bottom-[66px] z-20 flex min-h-[77px] items-center gap-5 rounded-xl border border-border/75 bg-card/95 px-7 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.95)] backdrop-blur-xl">
          <span className="min-w-[160px] text-sm font-semibold">
            {selected.size} {t("selected")}
          </span>
          <button
            type="button"
            onClick={() => setSelectedEnabled(true)}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border/75 bg-secondary/15 px-5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-secondary/30"
          >
            <CircleCheck className="h-4 w-4 text-muted-foreground" />
            {t("Enable")}
          </button>
          <button
            type="button"
            onClick={() => setSelectedEnabled(false)}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border/75 bg-secondary/15 px-5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-secondary/30"
          >
            <CirclePause className="h-4 w-4 text-muted-foreground" />
            {t("Disable")}
          </button>
          <button
            type="button"
            onClick={() =>
              applyUpdates.mutate({ instanceId, paths: selectedUpdatePaths }, {
                onSuccess: () => setSelected(new Set()),
              })
            }
            disabled={selectedUpdatePaths.length === 0 || applyUpdates.isPending}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border/75 bg-secondary/15 px-5 text-sm font-medium transition-colors hover:border-amber-500/40 hover:bg-secondary/30 disabled:opacity-45"
          >
            {applyUpdates.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CircleArrowUp className="h-4 w-4 text-amber-400" />
            )}
            {t("Update")}
            {selectedUpdatePaths.length > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
                {selectedUpdatePaths.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() =>
              setPendingDeletion({
                kind: "bulk",
                mods: selectedMods.map((mod) => ({
                  id: mod.id,
                  name: mod.name,
                  enabled: mod.enabled,
                  deployedFileCount: mod.deployed_file_count,
                })),
              })
            }
            disabled={instanceIsRunning || deletionBusy}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/5 px-5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-45"
          >
            <Trash2 className="h-4 w-4" />
            {t("Delete")}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            aria-label={t("Clear selection")}
            className="ml-auto rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Rendered last so it sits over the selection bar, and mounted only when
          there is something to show: an always-mounted dialog keeps a stale mod
          in memory after the list refreshes under it. */}
      <ModInfoDialog mod={infoMod} onClose={() => setInfoMod(null)} />
    </div>
  );
}
