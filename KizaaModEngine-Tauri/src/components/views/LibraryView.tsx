import { useEffect, useMemo, useRef, useState } from "react";
import {
  updateDiscordStatus,
  useAppConfig,
  useCreateMinecraftInstance,
  useInstances,
  useMinecraftLoaderVersions,
  useMinecraftVersions,
  useStartMinecraftInstall,
  useVerifyInstance,
  useImportInstance,
  useImportProgress,
  useLaunchMinecraft,
  useMinecraftAccount,
  useInstanceCover,
  useOpenInstanceFolder,
  usePlayHistory,
  useRenameInstance,
  useDeleteInstance,
  useSetInstanceCover,
} from "../../lib/queries";
import { InstanceContextMenu } from "../library/InstanceContextMenu";
import { ConfirmActionDialog } from "../ui/confirm-action-dialog";
import { InstancePoster } from "../common/InstancePoster";
import { LibraryModeSwitch } from "../common/LibraryModeSwitch";
import { FilterMenu, ToolbarSearch } from "../common/Toolbar";
import { ExportInstanceDialog } from "../instance/ExportInstanceDialog";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  Box,
  Check,
  ChevronDown,
  Clock,
  Feather,
  FolderOpen,
  Hammer,
  ImagePlus,
  Leaf,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Server,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useAppStore } from "../../lib/store";
import { useMissingMods } from "../../lib/missingMods";
import { LighterPackDialog } from "../common/LighterPackDialog";
import { ImportFromLauncherDialog } from "../common/ImportFromLauncherDialog";
import type { OfficialPack } from "../../lib/queries";
import { MINECRAFT_LOADER_LABELS, MINECRAFT_LOADER_OPTIONS } from "../../lib/minecraftLoaders";
import type { MinecraftLoader } from "../../lib/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button, EmptyState, Input } from "../ui/primitives";
import { MinecraftVersionPicker } from "../common/MinecraftVersionPicker";
import { filterMinecraftVersions } from "../../lib/minecraftVersions";
import {
  filterMinecraftVersionsByJava,
  javaSelectionToMajor,
  MINECRAFT_JAVA_OPTIONS,
  type MinecraftJavaSelection,
} from "../../lib/minecraftJava";
import { LauncherOptionPicker } from "../ui/launcher-option-picker";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { part } from "../../lib/theme/parts";
import { useI18n } from "../../lib/i18n";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";
import { Skeleton, SkeletonGrid } from "../ui/skeleton";
import { ProgressRing } from "../ui/progress";

const loaderPresentation = {
  vanilla: { icon: Box, description: "Original game" },
  fabric: { icon: Feather, description: "Lightweight mods" },
  forge: { icon: Hammer, description: "Forge ecosystem" },
  neoforge: { icon: Leaf, description: "Modern Forge fork" },
} satisfies Record<MinecraftLoader, { icon: typeof Box; description: string }>;

/** Told once per page load: the moment the library is really on screen. */
let interfaceReadyReported = false;

export function LibraryView() {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: instances, isLoading, error } = useInstances();
  useEffect(() => {
    if (interfaceReadyReported || isLoading || !instances) return;
    interfaceReadyReported = true;
    // After paint, so the figure is the one a person would measure.
    requestAnimationFrame(() => {
      void invoke("interface_ready", { pageMs: performance.now() }).catch(() => undefined);
    });
  }, [isLoading, instances]);
  const verifyInstance = useVerifyInstance();
  const { data: mcVersions } = useMinecraftVersions();
  const { data: config } = useAppConfig();
  const createMinecraftInstance = useCreateMinecraftInstance();
  const startMinecraftInstall = useStartMinecraftInstall();
  const importInstance = useImportInstance();
  // An import that weighs a third of the official release, waiting on a decision.
  const [lighterPack, setLighterPack] = useState<{ instanceId: string; official: OfficialPack } | null>(null);
  // The Import button opens a small menu: a file, or another launcher.
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [importFromLauncherOpen, setImportFromLauncherOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!importMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!importMenuRef.current?.contains(event.target as Node)) setImportMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImportMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [importMenuOpen]);
  const { data: importProgress } = useImportProgress(importInstance.isPending);
  // Kept after the mutation settles: these are mods to go and fetch by hand,
  // and the window has to stay on screen long enough to do it.
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);
  const openServerCreatorFor = useAppStore((state) => state.openServerCreatorFor);
  const [exportInstanceId, setExportInstanceId] = useState<string | null>(null);
  const openInstanceFolder = useOpenInstanceFolder();
  const launchMinecraft = useLaunchMinecraft();
  const { data: minecraftAccount } = useMinecraftAccount();
  const { data: playHistory } = usePlayHistory();

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
  const [loaderFilter, setLoaderFilter] = useState("all");
  const [footerMenuOpen, setFooterMenuOpen] = useState(false);
  // The archive being imported, for the card that stands in for it.
  const [importingFile, setImportingFile] = useState<string | null>(null);
  // The right-click menu, and the two things it can open.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const renameInstance = useRenameInstance();
  const deleteInstance = useDeleteInstance();
  const setCover = useSetInstanceCover();

  const [isAddingMinecraft, setIsAddingMinecraft] = useState(false);
  const [minecraftDialogOpen, setMinecraftDialogOpen] = useState(false);
  const [minecraftName, setMinecraftName] = useState("Kiza Alpha");
  const [minecraftVersion, setMinecraftVersion] = useState("");
  const [minecraftLoader, setMinecraftLoader] = useState<MinecraftLoader>("vanilla");
  const [minecraftLoaderVersion, setMinecraftLoaderVersion] = useState("");
  const [minecraftJava, setMinecraftJava] = useState<MinecraftJavaSelection>("auto");
  const {
    data: loaderVersions,
    isLoading: loaderVersionsLoading,
    error: loaderVersionsError,
  } = useMinecraftLoaderVersions(minecraftVersion, minecraftLoader);

  const minecraftInstances = useMemo(
    () => (instances ?? []).filter((instance) => instance.game_id === "minecraft"),
    [instances],
  );
  /**
   * The card the footer describes and the Play button belongs to.
   *
   * Defaults to the most recently played instance rather than the first in the
   * list: reopening the launcher to play again is the common case, and it
   * should already be the one under the cursor.
   */
  const orderedInstances = useMemo(() => {
    const sorted = [...minecraftInstances];
    if (sortBy === "name") {
      sorted.sort((left, right) => left.display_name.localeCompare(right.display_name));
    } else {
      sorted.sort((left, right) => {
        const leftPlayed = playHistory?.[left.id] ?? "";
        const rightPlayed = playHistory?.[right.id] ?? "";
        // Never played sorts last, whatever its name.
        if (leftPlayed !== rightPlayed) return rightPlayed.localeCompare(leftPlayed);
        return left.display_name.localeCompare(right.display_name);
      });
    }
    return sorted;
  }, [minecraftInstances, playHistory, sortBy]);

  const visibleInstances = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orderedInstances.filter(
      (instance) =>
        (!needle || instance.display_name.toLowerCase().includes(needle)) &&
        (loaderFilter === "all" || (instance.minecraft?.loader ?? "vanilla") === loaderFilter),
    );
  }, [orderedInstances, query, loaderFilter]);

  const focused = orderedInstances.find((instance) => instance.id === focusedId) ?? null;

  useEffect(() => {
    if (focused || orderedInstances.length === 0) return;
    setFocusedId(orderedInstances[0].id);
  }, [focused, orderedInstances]);

  const lastPlayedLabel = useMemo(() => {
    const played = focused ? playHistory?.[focused.id] : undefined;
    if (!played) return t("Never played");
    const elapsed = Date.now() - new Date(played).getTime();
    const hours = Math.round(elapsed / 3_600_000);
    // The tile already says "Last played"; the value is only the when.
    if (hours < 1) return t("Just now");
    if (hours < 24) return t("{count} h ago").replace("{count}", String(hours));
    const days = Math.round(hours / 24);
    return t("{count} d ago").replace("{count}", String(days));
  }, [focused, playHistory, t]);

  /**
   * Launches straight from the library when there is an account to launch with.
   *
   * Without one there is a name to choose and an offline profile to pick, and
   * guessing either would start the game as somebody the player is not — so the
   * instance opens instead, where that choice lives.
   */
  const play = (instance: (typeof orderedInstances)[number]) => {
    if (!minecraftAccount) {
      setSelectedInstanceId(instance.id);
      return;
    }
    launchMinecraft.mutate({
      instanceId: instance.id,
      username: minecraftAccount.username,
      offline: false,
    });
  };

  const releasesOnly = config?.minecraft_releases_only ?? true;
  const availableMinecraftVersions = useMemo(
    () => filterMinecraftVersions(
      filterMinecraftVersionsByJava(mcVersions?.versions ?? [], minecraftJava),
      releasesOnly,
    ),
    [mcVersions?.versions, minecraftJava, releasesOnly],
  );
  const loaderReady = minecraftLoader === "vanilla"
    || (!!minecraftLoaderVersion && !loaderVersionsLoading && !loaderVersionsError);

  useEffect(() => {
    updateDiscordStatus(null, "browsing_instances");
  }, []);

  useEffect(() => {
    if (availableMinecraftVersions.some((version) => version.id === minecraftVersion)) return;
    const latestRelease = availableMinecraftVersions.find((version) => version.type === "release")?.id ?? availableMinecraftVersions[0]?.id;
    if (latestRelease) setMinecraftVersion(latestRelease);
  }, [availableMinecraftVersions, minecraftVersion]);

  useEffect(() => {
    setMinecraftLoaderVersion("");
  }, [minecraftLoader, minecraftVersion]);

  useEffect(() => {
    if (minecraftLoader === "vanilla" || !loaderVersions?.length) return;
    if (loaderVersions.some((entry) => entry.version === minecraftLoaderVersion)) return;
    const preferred = loaderVersions.find((entry) => entry.stable) ?? loaderVersions[0];
    setMinecraftLoaderVersion(preferred.version);
  }, [loaderVersions, minecraftLoader, minecraftLoaderVersion]);

  // Entrance: the header settles, then the posters deal themselves out.
  useGSAP(() => {
    if (isLoading || error || prefersReducedMotion()) return;
    gsap
      .timeline({ defaults: { ease: "power3.out" } })
      .fromTo(
        '[data-anim="header"]',
        { y: -16 },
        { y: 0, duration: 0.45, clearProps: "transform" },
      )
      .fromTo(
        '[data-anim="poster"]',
        { y: 28, scale: 0.96 },
        { y: 0, scale: 1, duration: 0.5, stagger: 0.07, clearProps: "transform" },
        "-=0.2",
      )
      .fromTo(
        '[data-anim="footer"]',
        { y: 14 },
        { y: 0, duration: 0.4, clearProps: "transform" },
        "-=0.25",
      );
  }, { dependencies: [isLoading, error != null, minecraftInstances.length], scope: containerRef });

  // The action row appears with the selection rather than snapping in, so
  // moving between cards reads as one object changing rather than two.
  useGSAP(() => {
    if (prefersReducedMotion() || !focusedId) return;
    gsap.from('[data-anim="footer-body"]', {
      y: 10,
      opacity: 0,
      duration: 0.28,
      ease: "power2.out",
      overwrite: "auto",
      clearProps: "transform,opacity",
    });
  }, { dependencies: [focusedId], scope: containerRef });

  const handleCreateMinecraft = async () => {
    if (!minecraftName.trim() || !minecraftVersion.trim()) return;

    try {
      setIsAddingMinecraft(true);
      const instance = await createMinecraftInstance.mutateAsync({
        displayName: minecraftName.trim(),
        mcVersion: minecraftVersion.trim(),
        loader: minecraftLoader,
        loaderVersion: minecraftLoader === "vanilla" ? null : minecraftLoaderVersion,
        javaMajor: javaSelectionToMajor(minecraftJava),
      });

      await startMinecraftInstall.mutateAsync(instance.id);
      setSelectedInstanceId(instance.id);
      setMinecraftDialogOpen(false);
    } finally {
      setIsAddingMinecraft(false);
    }
  };

  const handleImportInstance = async () => {
    const selected = await openFileDialog({
      multiple: false,
      filters: [
        { name: t("Instance archive"), extensions: ["zip", "mrpack", "7z", "rar", "tar", "gz", "tgz", "xz", "txz", "bz2", "tbz2"] },
      ],
    });
    if (typeof selected !== "string") return;
    importArchive(selected);
  };

  // A pack dropped anywhere on the window lands here.
  const droppedArchive = useAppStore((state) => state.droppedArchive);
  useEffect(() => {
    if (!droppedArchive || importInstance.isPending) return;
    useAppStore.getState().setDroppedArchive(null);
    importArchive(droppedArchive);
    // importArchive reads the latest mutation through its closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedArchive]);

  function importArchive(selected: string) {
    setImportingFile(
      (selected.split(/[\\/]/).pop() ?? selected).replace(/(\.tar)?\.(zip|mrpack|7z|rar|tar|tgz|txz|tbz2|gz|xz|bz2)$/i, ""),
    );

    importInstance.mutate(
      { archivePath: selected },
      {
        onSuccess: (outcome) => {
          setSelectedInstanceId(outcome.instance_id);
          // A light copy of a heavier release is asked about before anything
          // else: the missing mods of an instance about to be replaced are
          // nobody's concern.
          if (outcome.lighter_than) {
            setLighterPack({ instanceId: outcome.instance_id, official: outcome.lighter_than });
            return;
          }
          // Shown over the instance it belongs to, by the one dialog every
          // import path shares.
          useMissingMods.getState().show(outcome.instance_id, outcome.blocked);
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-6 kiza-under-bar px-6 sm:px-8 xl:px-11">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56 rounded-full" />
          <Skeleton className="h-4 w-40 rounded-full opacity-70" />
        </div>
        <SkeletonGrid count={7} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-destructive">
        <AlertCircle className="mb-4 h-12 w-12" />
        <p className="text-lg font-medium">{t("Failed to load instances")}</p>
        <p className="text-sm opacity-80">{String(error)}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex min-w-0 max-w-full flex-1 flex-col kiza-under-bar overflow-x-hidden overflow-y-auto px-6 pb-5 sm:px-8 sm:pb-7 sm:[--kiza-under-bar-gap:1.75rem] xl:px-11 xl:pb-9 xl:[--kiza-under-bar-gap:2.25rem]">
      <Dialog open={minecraftDialogOpen} onOpenChange={setMinecraftDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg gap-0 overflow-y-auto p-0">
          {/* What will be made, said as it is chosen: the header reads like
              the card the instance will become. */}
          <DialogHeader className="space-y-0 px-6 pb-4 pt-6 pr-14">
            <div className="flex items-center gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-primary/20 text-primary">
                {(() => {
                  const Icon = loaderPresentation[minecraftLoader].icon;
                  return <Icon className="h-6 w-6" />;
                })()}
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-left text-xl font-semibold tracking-tight">{t("New instance")}</DialogTitle>
                <DialogDescription className="mt-0.5 truncate text-left text-[13px]">
                  {[minecraftVersion ? `Minecraft ${minecraftVersion}` : null, MINECRAFT_LOADER_LABELS[minecraftLoader], minecraftLoader !== "vanilla" ? minecraftLoaderVersion || null : null]
                    .filter(Boolean)
                    .join(" · ")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5 px-6 pb-2">
            <Input
              value={minecraftName}
              onChange={(event) => setMinecraftName(event.target.value)}
              placeholder={t("Instance name")}
              aria-label={t("Instance name")}
              className="h-12 rounded-xl border-transparent bg-secondary/45 px-4 text-base font-medium focus:bg-secondary/60"
            />

            <section>
              <h3 className="mb-1.5 px-1 text-[13px] font-semibold text-foreground/90">{t("Modloader")}</h3>
              {/* Two rows of two rather than one row of four: at four across,
                  the tiles were narrower than their own labels. */}
              <div className="grid grid-cols-2 gap-2">
                {MINECRAFT_LOADER_OPTIONS.map((loader) => {
                  const active = minecraftLoader === loader.value;
                  const Icon = loaderPresentation[loader.value].icon;
                  return (
                    <button
                      key={loader.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setMinecraftLoader(loader.value)}
                      className={cn(
                        "relative flex items-center gap-3 rounded-xl p-3 text-left transition-[background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97]",
                        active
                          ? "bg-primary/[0.16] shadow-[inset_0_0_0_1.5px_hsl(var(--primary)/0.75)]"
                          : "bg-secondary/[0.32] hover:bg-secondary/55",
                      )}
                    >
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", active ? "bg-primary text-primary-foreground" : "bg-secondary/80 text-muted-foreground")}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold">{loader.label}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">{t(loaderPresentation[loader.value].description)}</span>
                      </span>
                      {active && (
                        <Check className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-primary animate-in zoom-in-50 fade-in-0 duration-150" strokeWidth={3} />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h3 className="mb-1.5 px-1 text-[13px] font-semibold text-foreground/90">{t("Version")}</h3>
              <div className="divide-y divide-border/40 rounded-xl bg-secondary/[0.32] px-4 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-0 [&_button]:shadow-none [&_button]:hover:bg-transparent">
                <div className="flex min-h-12 items-center justify-between gap-4 py-1.5">
                  <span className="shrink-0 text-[13.5px] text-muted-foreground">Minecraft</span>
                  <div className="w-full max-w-[16rem] [&_.h-8]:hidden">
                    <MinecraftVersionPicker
                      versions={availableMinecraftVersions}
                      value={minecraftVersion}
                      onValueChange={setMinecraftVersion}
                      releasesOnly={releasesOnly}
                    />
                  </div>
                </div>
                {minecraftLoader !== "vanilla" && (
                  <div className="flex min-h-12 items-center justify-between gap-4 py-1.5">
                    {/* Read from the map. The two-way guess labelled everything
                        that was not Fabric as Forge. */}
                    <span className="shrink-0 text-[13.5px] text-muted-foreground">{MINECRAFT_LOADER_LABELS[minecraftLoader]}</span>
                    <div className="w-full max-w-[16rem]">
                      <LauncherOptionPicker
                        ariaLabel={`Choose a ${minecraftLoader} version`}
                        options={(loaderVersions ?? []).map((entry) => ({
                          value: entry.version,
                          label: entry.version,
                          badge: entry.stable ? "Stable" : "Preview",
                        }))}
                        value={minecraftLoaderVersion}
                        onValueChange={setMinecraftLoaderVersion}
                        placeholder={t("Select a compatible loader version")}
                        loading={loaderVersionsLoading}
                        disabled={!minecraftVersion || !!loaderVersionsError}
                      />
                    </div>
                  </div>
                )}
              </div>
              {loaderVersionsError ? (
                <p className="mt-1.5 px-1 text-xs text-red-300">
                  {t("No compatible loader version is available for this Minecraft version.")}
                </p>
              ) : (
                <p className="mt-1.5 px-1 text-xs text-muted-foreground">
                  {releasesOnly ? t("Stable releases only.") : t("Stable releases, snapshots and previews.")}
                </p>
              )}
            </section>

            {/* Java is chosen for you; it is here for the few who need to. */}
            <details className="group rounded-xl bg-secondary/[0.2] px-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] text-muted-foreground transition-colors hover:text-foreground">
                <span>{t("Advanced options")}</span>
                <span className="text-xs">
                  {minecraftJava === "auto" ? t("Java automatic") : `Java ${minecraftJava}`}
                  <ChevronDown className="ml-1.5 inline h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
                </span>
              </summary>
              <div className="pb-3">
                <LauncherOptionPicker
                  ariaLabel={t("Choose a Java runtime")}
                  options={MINECRAFT_JAVA_OPTIONS}
                  value={minecraftJava}
                  onValueChange={(value) => setMinecraftJava(value as MinecraftJavaSelection)}
                  placeholder={t("Choose Java")}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("The version list above only shows releases this Java can run.")}
                </p>
              </div>
            </details>
          </div>

          <DialogFooter className="px-6 pb-6 pt-4">
            <Button onClick={() => setMinecraftDialogOpen(false)}>{t("Cancel")}</Button>
            <Button
              onClick={handleCreateMinecraft}
              disabled={isAddingMinecraft || !minecraftName.trim() || !minecraftVersion.trim() || !loaderReady}
              variant="primary"
            >
              {isAddingMinecraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("Create and install")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div data-anim="header" className="mb-5 shrink-0 xl:mb-7">
        <div className="flex min-w-0 items-center gap-4">
          <div {...part("library.icon")} className="flex h-12 w-12 shrink-0 items-center justify-center">
            <Box className="h-11 w-11 text-primary" strokeWidth={1.7} />
          </div>
          <div className="min-w-0">
            <h1 {...part("library.title")} className="kiza-heading truncate font-bold tracking-tight">
              {t("My library")}
            </h1>
            <p {...part("library.count")} className="mt-1 truncate text-base text-muted-foreground">
              {minecraftInstances.length}{" "}
              {minecraftInstances.length === 1 ? t("Minecraft instance") : t("Minecraft instances")}
            </p>
          </div>
        </div>

        {/* The toolbar: Instances | Host at the left, the search in the
            middle, the tools at the right. One row under the title on both
            front pages, so flipping between them moves nothing else. */}
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <LibraryModeSwitch />

          <ToolbarSearch
            value={query}
            onChange={setQuery}
            placeholder={t("Search instances...")}
            className="mx-auto w-full max-w-[520px] flex-1 basis-72"
          />

          <div className="flex shrink-0 items-center gap-4">
            <FilterMenu
              active={sortBy !== "recent" || loaderFilter !== "all"}
              sections={[
                {
                  title: t("Sort by"),
                  value: sortBy,
                  onChange: (id) => setSortBy(id as "recent" | "name"),
                  options: [
                    { id: "recent", label: t("Last played") },
                    { id: "name", label: t("Name") },
                  ],
                },
                {
                  title: t("Loader"),
                  value: loaderFilter,
                  onChange: setLoaderFilter,
                  options: [
                    { id: "all", label: t("All") },
                    { id: "vanilla", label: "Vanilla" },
                    { id: "fabric", label: "Fabric" },
                    { id: "forge", label: "Forge" },
                    { id: "neoforge", label: "NeoForge" },
                  ],
                },
              ]}
            />
            <div ref={importMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setImportMenuOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={importMenuOpen}
                {...part("library.import")}
                disabled={importInstance.isPending}
                {...editable("secondary")}
                className="kiza-secondary inline-flex h-[54px] items-center gap-3 border px-7 text-base font-medium transition-[border-color,background-color] hover:border-primary/40 disabled:opacity-60"
              >
                {importInstance.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-5 w-5" />
                )}
                {/* A pack of thirty mods is a minute of downloading, and the button
                    used to spend it saying nothing but "Import". */}
                {importInstance.isPending && importProgress?.total
                  ? `${importProgress.done}/${importProgress.total}`
                  : t("Import")}
              </button>
              {importMenuOpen && (
                <div role="menu" className="kiza-enter kiza-elevated absolute right-0 top-[62px] z-40 w-64 rounded-xl border border-border/80 bg-popover p-1.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      void handleImportInstance();
                    }}
                    className="flex w-full flex-col items-start rounded-md px-2.5 py-2 text-left text-sm text-foreground transition hover:bg-secondary/60"
                  >
                    <span>{t("From a file…")}</span>
                    <span className="text-xs text-muted-foreground">{t("A pack or an export: zip, mrpack, 7z, rar, tar")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      setImportFromLauncherOpen(true);
                    }}
                    className="flex w-full flex-col items-start rounded-md px-2.5 py-2 text-left text-sm text-foreground transition hover:bg-secondary/60"
                  >
                    <span>{t("From another launcher…")}</span>
                    <span className="text-xs text-muted-foreground">{t("CurseForge, Modrinth, Prism, MultiMC, Minecraft Launcher")}</span>
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setMinecraftDialogOpen(true)}
              disabled={isAddingMinecraft || createMinecraftInstance.isPending}
              {...part("library.create")}
              {...editable("action")}
              className="inline-flex h-[54px] items-center gap-3 rounded-xl kiza-action px-8 text-base font-semibold text-primary-foreground shadow-[0_0_24px_-6px_hsl(var(--primary)/0.7)] transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
            >
              {isAddingMinecraft ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-5 w-5" />
              )}
              {t("Create")}
            </button>
          </div>
        </div>
      </div>

      {minecraftInstances.length > 0 ? (
        <>
          {/*
            One layout for two very different libraries.

            With a handful of instances this fills a single line and reads as
            the shelf in the reference. With thirty it wraps and the page
            scrolls down — which is the direction a list is meant to grow.
            A horizontal shelf that never wrapped would mean scrolling
            sideways past twenty cards with no overview, and the card you want
            is never the one on screen.

            The column is capped rather than stretched so the portrait shape
            survives a wide window, and the cap follows the viewport height so
            a whole card still fits on a short screen.
          */}
          <div
            className="grid shrink-0 gap-x-5 gap-y-7 pb-1"
            style={{
              // More columns as the window grows, not bigger cards: each one
              // stays between 180 and roughly twice that, so a large window
              // holds a library instead of four giant posters.
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            }}
          >
            {importInstance.isPending && importingFile && (
              <ImportingPoster fileName={importingFile} done={importProgress?.done ?? 0} total={importProgress?.total ?? 0} current={importProgress?.name ?? null} />
            )}
            {visibleInstances.map((instance) => (
              <InstancePoster
                key={instance.id}
                instance={instance}
                selected={instance.id === focusedId}
                className="w-full"
                launching={launchMinecraft.isPending && focusedId === instance.id}
                onSelect={() => setFocusedId(instance.id)}
                onPlay={() => play(instance)}
                onManage={() => setSelectedInstanceId(instance.id)}
                onMenu={(x, y) => setMenu({ id: instance.id, x, y })}
              />
            ))}

            <button
              type="button"
              data-anim="poster"
              onClick={() => setMinecraftDialogOpen(true)}
              className="group flex w-full min-w-0 flex-col gap-2.5 text-left"
            >
              <span className="kiza-card flex aspect-[3/4] w-full items-center justify-center border border-dashed border-border/60 bg-secondary/[0.18] text-muted-foreground transition-[border-color,background-color,color,transform] duration-300 group-hover:-translate-y-1 group-hover:border-primary/50 group-hover:bg-primary/[0.06] group-hover:text-primary">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/60 transition-colors group-hover:bg-primary/15">
                  <Plus className="h-6 w-6" />
                </span>
              </span>
              <span className="px-0.5 text-[14px] font-semibold text-muted-foreground transition-colors group-hover:text-foreground">
                {t("New instance")}
              </span>
            </button>
          </div>

          {query.trim() && visibleInstances.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("No instance matches that search.")}
            </p>
          )}

          {/* The instance in hand, docked at the foot of the window: a pane of
              glass that stays put while the library scrolls under it, like a
              player bar. It changes with the selection by a short fade, so
              moving between cards reads as one object changing its contents. */}
          {/* Pushes the bar to the foot of a short library, keeps a gap
              above it in a long one. */}
          {focused && <div aria-hidden className="min-h-6 flex-1" />}
          {focused && (
            <div
              data-anim="footer"
              {...part("library.footer")}
              {...editable("panel")}
              className="kiza-panel sticky bottom-4 z-20 shrink-0 border bg-card/70 px-3 py-3 shadow-[0_20px_50px_-20px_hsl(0_0%_0%/0.85)] backdrop-blur-2xl backdrop-saturate-150 sm:px-4"
            >
              <div key={focused.id} data-anim="footer-body" className="flex min-w-0 items-center gap-4 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
                {/* Who it is: the picture, the name, the same facts as the card. */}
                <div className="flex min-w-0 shrink items-center gap-3.5">
                  <InstanceThumb instanceId={focused.id} />
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold tracking-[-0.01em]">{focused.display_name}</div>
                    <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                      {[
                        focused.minecraft?.mc_version,
                        loaderLabel(focused.minecraft?.loader),
                        `${focused.mod_count} ${focused.mod_count === 1 ? t("mod") : t("mods")}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                </div>

                {/* What there is to know, as label over value, divided by
                    hairlines rather than boxed. */}
                <div className="hidden min-w-0 shrink items-center md:flex">
                  <Stat label={t("Last played")} value={lastPlayedLabel} />
                  <Stat className="hidden lg:flex" label="Java" value={focused.minecraft?.java_major ? `Java ${focused.minecraft.java_major}` : t("Automatic")} />
                  <Stat
                    dot={focused.status === "Valid" ? "emerald" : "amber"}
                    label={t("Status")}
                    value={focused.status === "Valid" ? t("Ready to play") : t("Needs attention")}
                  />
                </div>

                <div className="relative ml-auto flex shrink-0 items-center gap-2">
                  <div className="flex items-center rounded-[12px] bg-secondary/45 p-0.5">
                    <FooterTool label={t("Open the instance folder")} icon={FolderOpen} onClick={() => openInstanceFolder.mutate(focused.id)} />
                    <FooterTool label={t("Manage this instance")} icon={Pencil} onClick={() => setSelectedInstanceId(focused.id)} />
                    <FooterTool
                      label={t("More actions")}
                      icon={MoreHorizontal}
                      active={footerMenuOpen}
                      onClick={() => setFooterMenuOpen((open) => !open)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => play(focused)}
                    disabled={launchMinecraft.isPending || focused.status !== "Valid"}
                    {...editable("action")}
                    className="kiza-action inline-flex h-10 items-center gap-2 rounded-[12px] px-5 text-sm font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
                  >
                    {launchMinecraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                    {t("Play")}
                  </button>
                  {footerMenuOpen && (
                    <div className="kiza-enter absolute bottom-[52px] right-0 z-30 w-64 overflow-hidden rounded-xl bg-popover/95 p-1.5 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.09),0_18px_44px_hsl(242_30%_2%/0.6)] backdrop-blur-2xl">
                      <button
                        type="button"
                        onClick={() => {
                          setFooterMenuOpen(false);
                          verifyInstance.mutate(focused.id);
                        }}
                        disabled={verifyInstance.isPending}
                        className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-60"
                      >
                        {verifyInstance.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        {t("Check this instance")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFooterMenuOpen(false);
                          setExportInstanceId(focused.id);
                        }}
                        className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors hover:bg-primary hover:text-primary-foreground"
                      >
                        <Share2 className="h-4 w-4" />
                        {t("Export this instance")}
                      </button>
                      {/* Host → Creator, with this instance already read: the
                          server gets the mods a server needs and nothing else. */}
                      <button
                        type="button"
                        onClick={() => {
                          setFooterMenuOpen(false);
                          openServerCreatorFor(focused.id);
                        }}
                        className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors hover:bg-primary hover:text-primary-foreground"
                      >
                        <Server className="h-4 w-4" />
                        {t("Create a server from this instance")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          className="min-h-[360px]"
          title={t("No Minecraft instance")}
          description={t("Create your first isolated Minecraft instance and choose Vanilla, Fabric or Forge.")}
        />
      )}

      {menu && (() => {
        const target = orderedInstances.find((entry) => entry.id === menu.id);
        if (!target) return null;
        const chooseCover = async () => {
          const picked = await openFileDialog({
            multiple: false,
            filters: [{ name: t("Image"), extensions: ["png", "jpg", "jpeg"] }],
          });
          if (typeof picked === "string") setCover.mutate({ instanceId: target.id, sourcePath: picked });
        };
        return (
          <InstanceContextMenu
            x={menu.x}
            y={menu.y}
            title={target.display_name}
            onClose={() => setMenu(null)}
            groups={[
              [{ label: t("Play"), icon: Play, onSelect: () => play(target), disabled: target.status !== "Valid" }],
              [
                { label: t("Rename…"), icon: Pencil, onSelect: () => setRenaming({ id: target.id, name: target.display_name }) },
                { label: t("Change the picture…"), icon: ImagePlus, onSelect: () => void chooseCover() },
                { label: t("Open folder"), icon: FolderOpen, onSelect: () => openInstanceFolder.mutate(target.id) },
              ],
              [
                { label: t("Check this instance"), icon: ShieldCheck, onSelect: () => verifyInstance.mutate(target.id) },
                { label: t("Export this instance"), icon: Share2, onSelect: () => setExportInstanceId(target.id) },
              ],
              [{ label: t("Delete…"), icon: Trash2, destructive: true, onSelect: () => setDeleting({ id: target.id, name: target.display_name }) }],
            ]}
          />
        );
      })()}

      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Rename the instance")}</DialogTitle>
            <DialogDescription>{t("Only the name changes: the folder, worlds and mods stay as they are.")}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = renaming?.name.trim();
              if (!renaming || !name) return;
              renameInstance.mutate(
                { instanceId: renaming.id, displayName: name },
                { onSuccess: () => setRenaming(null) },
              );
            }}
          >
            <Input
              autoFocus
              value={renaming?.name ?? ""}
              maxLength={64}
              onChange={(event) => setRenaming((current) => current && { ...current, name: event.target.value })}
              onFocus={(event) => event.currentTarget.select()}
            />
            <DialogFooter className="mt-4">
              <Button type="button" onClick={() => setRenaming(null)}>{t("Cancel")}</Button>
              <Button type="submit" variant="primary" disabled={!renaming?.name.trim() || renameInstance.isPending}>
                {renameInstance.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("Rename")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("Delete {name}?").replace("{name}", deleting?.name ?? "")}
        description={t("This permanently removes the instance, its worlds, content and settings. This cannot be undone.")}
        confirmLabel={t("Delete instance")}
        cancelLabel={t("Cancel")}
        destructive
        busy={deleteInstance.isPending}
        onConfirm={() => {
          if (!deleting) return;
          deleteInstance.mutate(deleting.id, {
            onSuccess: () => {
              if (focusedId === deleting.id) setFocusedId(null);
            },
            onSettled: () => setDeleting(null),
          });
        }}
      />

      {exportInstanceId && (
        <ExportInstanceDialog
          instanceId={exportInstanceId}
          open
          onOpenChange={(next) => !next && setExportInstanceId(null)}
        />
      )}

      <ImportFromLauncherDialog
        open={importFromLauncherOpen}
        onOpenChange={setImportFromLauncherOpen}
        onImported={(instance) => setSelectedInstanceId(instance.id)}
      />

      {lighterPack && (
        <LighterPackDialog
          instanceId={lighterPack.instanceId}
          official={lighterPack.official}
          onClose={(replacedWith) => {
            setLighterPack(null);
            if (replacedWith) setSelectedInstanceId(replacedWith);
          }}
        />
      )}
    </div>
  );
}

function loaderLabel(loader: string | undefined): string | null {
  switch (loader) {
    case "vanilla":
      return "Vanilla";
    case "fabric":
      return "Fabric";
    case "forge":
      return "Forge";
    case "neoforge":
      return "NeoForge";
    default:
      return null;
  }
}

/** One fact about the instance in hand: what it is, then the answer. */
function Stat({
  dot,
  label,
  value,
  className,
}: {
  dot?: "emerald" | "amber";
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 flex-col justify-center border-l border-border/50 px-4 first:border-l-0", className)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] font-medium">
        {dot && (
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot === "emerald" ? "bg-emerald-400" : "bg-amber-400")} />
        )}
        {value}
      </div>
    </div>
  );
}

/** A small tool in the bar's capsule: an icon, its name on hover. */
function FooterTool({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: typeof Clock;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={active}
      className={cn(
        "flex h-9 w-10 items-center justify-center rounded-[10px] transition-[background-color,color,scale] duration-150 active:scale-[0.94]",
        active ? "bg-background/80 text-foreground" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

/** The instance's picture, small, beside its name in the footer. */
function InstanceThumb({ instanceId }: { instanceId: string }) {
  const { data: cover } = useInstanceCover(instanceId);
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[12px] bg-gradient-to-br from-primary/30 to-primary/5 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.1)]">
      {cover && <img src={cover.uri} alt="" aria-hidden className="h-full w-full object-cover" />}
    </div>
  );
}

/**
 * The pack being imported, standing in the library before it exists: its
 * file name, a sheen passing over the picture, and a ring with how many of
 * its mods are in. Reading the archive has no count yet, and the ring turns
 * until the backend has one.
 */
function ImportingPoster({
  fileName,
  done,
  total,
  current,
}: {
  fileName: string;
  done: number;
  total: number;
  current: string | null;
}) {
  const { t } = useI18n();
  const percent = total > 0 ? (done / total) * 100 : null;
  return (
    <div className="flex w-full min-w-0 flex-col gap-2.5 animate-in fade-in-0 zoom-in-95 duration-300 motion-reduce:animate-none" aria-live="polite">
      <div className="kiza-card kiza-shimmer relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden border border-primary/40 bg-gradient-to-br from-primary/25 to-primary/5">
        <div className="relative flex flex-col items-center gap-3 px-4 text-center">
          <ProgressRing percent={percent} size={56} />
          <span className="text-[12px] font-medium text-white/85">
            {total > 0 ? t("{done} of {total} mods").replace("{done}", String(done)).replace("{total}", String(total)) : t("Reading the archive…")}
          </span>
        </div>
      </div>
      <div className="min-w-0 px-0.5">
        <h3 className="truncate text-[14px] font-semibold tracking-[-0.01em]">{fileName}</h3>
        <p key={current ?? ""} className="mt-0.5 truncate text-[12px] text-muted-foreground animate-in fade-in-0 duration-200">
          {current ?? t("Importing…")}
        </p>
      </div>
    </div>
  );
}
