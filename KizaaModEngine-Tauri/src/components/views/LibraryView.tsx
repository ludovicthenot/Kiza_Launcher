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
} from "../../lib/queries";
import { InstancePoster } from "../common/InstancePoster";
import { LibraryModeSwitch } from "../common/LibraryModeSwitch";
import { FilterMenu, ToolbarSearch } from "../common/Toolbar";
import { ExportInstanceDialog } from "../instance/ExportInstanceDialog";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  Box,
  Clock,
  Coffee,
  Feather,
  FolderClosed,
  FolderOpen,
  Hammer,
  Leaf,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Server,
  Share2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useAppStore } from "../../lib/store";
import { useMissingMods } from "../../lib/missingMods";
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

const loaderPresentation = {
  vanilla: { icon: Box, description: "Original game" },
  fabric: { icon: Feather, description: "Lightweight mods" },
  forge: { icon: Hammer, description: "Forge ecosystem" },
  neoforge: { icon: Leaf, description: "Modern Forge fork" },
} satisfies Record<MinecraftLoader, { icon: typeof Box; description: string }>;

export function LibraryView() {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: instances, isLoading, error } = useInstances();
  const verifyInstance = useVerifyInstance();
  const { data: mcVersions } = useMinecraftVersions();
  const { data: config } = useAppConfig();
  const createMinecraftInstance = useCreateMinecraftInstance();
  const startMinecraftInstall = useStartMinecraftInstall();
  const importInstance = useImportInstance();
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
    gsap.from('[data-anim="poster-actions"]', {
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
      filters: [{ name: t("Instance archive"), extensions: ["zip"] }],
    });
    if (typeof selected !== "string") return;

    importInstance.mutate(
      { archivePath: selected },
      {
        onSuccess: (outcome) => {
          setSelectedInstanceId(outcome.instance_id);
          // Shown over the instance it belongs to, by the one dialog every
          // import path shares.
          useMissingMods.getState().show(outcome.instance_id, outcome.blocked);
        },
      },
    );
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
        <AlertCircle className="mb-4 h-12 w-12" />
        <p className="text-lg font-medium">{t("Failed to load instances")}</p>
        <p className="text-sm opacity-80">{String(error)}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex min-w-0 max-w-full flex-1 flex-col overflow-x-hidden overflow-y-auto px-6 py-5 sm:px-8 sm:py-7 xl:px-11 xl:py-9">
      <Dialog open={minecraftDialogOpen} onOpenChange={setMinecraftDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Create a Minecraft instance")}</DialogTitle>
            <DialogDescription>
              {t("Create an isolated Minecraft instance with the modloader you choose.")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Instance name")}</label>
              <Input value={minecraftName} onChange={(event) => setMinecraftName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Java runtime")}</label>
              <LauncherOptionPicker
                ariaLabel="Choose a Java runtime"
                options={MINECRAFT_JAVA_OPTIONS}
                value={minecraftJava}
                onValueChange={(value) => setMinecraftJava(value as MinecraftJavaSelection)}
                placeholder="Select Java"
              />
              <p className="text-xs text-muted-foreground">
                {t("The Minecraft catalog below only shows versions compatible with this Java choice.")}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Minecraft version")}</label>
              <MinecraftVersionPicker
                versions={availableMinecraftVersions}
                value={minecraftVersion}
                onValueChange={setMinecraftVersion}
                releasesOnly={releasesOnly}
              />
              <p className="text-xs text-muted-foreground">
                {releasesOnly ? t("Stable releases only.") : t("Stable releases, snapshots and previews.")} {minecraftJava === "auto" ? t("Java is selected automatically.") : `Java ${minecraftJava}.`}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Modloader")}</label>
              {/* Two rows of two rather than one row of four: at four across,
                  the tiles were narrower than their own labels. */}
              <div className="grid grid-cols-2 gap-2">
                {MINECRAFT_LOADER_OPTIONS.map((loader) => (
                  <button
                    key={loader.value}
                    type="button"
                    aria-pressed={minecraftLoader === loader.value}
                    onClick={() => setMinecraftLoader(loader.value)}
                    className={cn(
                      "flex min-h-20 flex-col items-start justify-between rounded-lg border p-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.96]",
                      minecraftLoader === loader.value
                        ? "border-primary/55 bg-primary/12 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.05)]"
                        : "border-border bg-secondary/20 hover:border-primary/25 hover:bg-secondary/40",
                    )}
                  >
                    {(() => {
                      const Icon = loaderPresentation[loader.value].icon;
                      return <Icon className={cn("h-4 w-4", minecraftLoader === loader.value ? "text-primary" : "text-muted-foreground")} />;
                    })()}
                    <span>
                      <span className="block text-sm font-semibold">{loader.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{t(loaderPresentation[loader.value].description)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {minecraftLoader !== "vanilla" && (
              <div className="space-y-2">
                {/* Read from the map. The two-way guess labelled everything that was
                    not Fabric as Forge, so choosing NeoForge asked for a
                    "Version Forge". */}
                <label className="text-sm font-medium">
                  {t("Version")} {MINECRAFT_LOADER_LABELS[minecraftLoader]}
                </label>
                <LauncherOptionPicker
                  ariaLabel={`Choose a ${minecraftLoader} version`}
                  options={(loaderVersions ?? []).map((entry) => ({
                    value: entry.version,
                    label: entry.version,
                    badge: entry.stable ? "Stable" : "Preview",
                  }))}
                  value={minecraftLoaderVersion}
                  onValueChange={setMinecraftLoaderVersion}
                  placeholder="Select a compatible loader version"
                  loading={loaderVersionsLoading}
                  disabled={!minecraftVersion || !!loaderVersionsError}
                />
                {loaderVersionsError && (
                  <p className="text-xs text-destructive">
                    {t("No compatible loader version is available for this Minecraft version.")}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
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
            <button
              type="button"
              onClick={handleImportInstance}
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
            className="grid shrink-0 gap-5 pb-1"
            style={{
              gridTemplateColumns:
                "repeat(auto-fill, minmax(240px, min(420px, calc((100dvh - 320px) * 0.58))))",
            }}
          >
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
              />
            ))}

            <button
              type="button"
              data-anim="poster"
              onClick={() => setMinecraftDialogOpen(true)}
              className="kiza-card flex aspect-[4/7] w-full min-w-0 flex-col items-center justify-center gap-5 border border-dashed border-border/70 bg-card/20 text-primary transition-[border-color,background-color,transform] hover:-translate-y-1 hover:border-primary/50 hover:bg-primary/[0.04]"
            >
              <Plus className="h-12 w-12" strokeWidth={1.4} />
              <span className="max-w-[9rem] text-center text-2xl font-semibold leading-relaxed">
                {t("New instance")}
              </span>
            </button>
          </div>

          {query.trim() && visibleInstances.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("No instance matches that search.")}
            </p>
          )}

          {focused && (
            <div
              data-anim="footer"
              {...part("library.footer")}
              {...editable("panel")}
              className="kiza-panel mt-5 flex min-h-[112px] shrink-0 flex-nowrap items-center gap-4 border px-5 py-4 xl:mt-9"
            >
              {/* Who the row is about: the picture, the name, the same meta
                  line as the card, so the eye does not have to travel back
                  up to check. */}
              <div className="flex min-w-0 shrink items-center gap-4 pr-4 sm:border-r sm:border-border/60">
                <InstanceThumb instanceId={focused.id} />
                <div className="min-w-0">
                  <div className="truncate text-xl font-bold tracking-tight">{focused.display_name}</div>
                  <div className="mt-1 truncate text-sm text-muted-foreground">
                    {focused.minecraft?.mc_version}
                    {focused.minecraft && " • "}
                    {loaderLabel(focused.minecraft?.loader)}
                    {" • "}
                    {focused.mod_count} {focused.mod_count === 1 ? t("mod") : t("mods")}
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 shrink items-center gap-3">
                <Stat icon={Clock} label={t("Last played")} value={lastPlayedLabel} />
                <Stat className="hidden lg:flex" icon={Coffee} label="Java" value={focused.minecraft?.java_major ? `Java ${focused.minecraft.java_major}` : t("Java automatic")} />
                <Stat className="hidden 2xl:flex" icon={FolderClosed} label={t("Folder type")} value={t("Isolated folder")} />
                <Stat
                  dot={focused.status === "Valid" ? "emerald" : "amber"}
                  label={t("Status")}
                  value={focused.status === "Valid" ? t("Ready to play") : t("Needs attention")}
                />
              </div>

              <div className="relative ml-auto flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => openInstanceFolder.mutate(focused.id)}
                  title={t("Open the instance folder")}
                  {...editable("secondary")}
                  className="kiza-secondary inline-flex h-[54px] shrink-0 items-center gap-3 border px-4 text-base font-medium text-foreground transition-colors hover:border-primary/40 xl:px-5"
                >
                  <FolderOpen className="h-5 w-5" />
                  <span className="hidden xl:inline">{t("Open folder")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedInstanceId(focused.id)}
                  title={t("Manage this instance")}
                  {...editable("secondary")}
                  className="kiza-secondary inline-flex h-[54px] shrink-0 items-center gap-3 border px-4 text-base font-medium text-foreground transition-colors hover:border-primary/40 xl:px-5"
                >
                  <Pencil className="h-5 w-5" />
                  <span className="hidden xl:inline">{t("Edit")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFooterMenuOpen((open) => !open)}
                  title={t("More actions")}
                  aria-label={t("More actions")}
                  aria-expanded={footerMenuOpen}
                  {...editable("secondary")}
                  className={cn(
                    "kiza-secondary inline-flex h-[54px] shrink-0 items-center gap-3 border px-4 text-base font-medium transition-colors xl:px-5",
                    footerMenuOpen ? "border-primary/50 text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <MoreHorizontal className="h-5 w-5" />
                  <span className="hidden xl:inline">{t("More")}</span>
                </button>
                {footerMenuOpen && (
                  <div className="kiza-enter absolute bottom-[62px] right-0 z-30 w-64 overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setFooterMenuOpen(false);
                        verifyInstance.mutate(focused.id);
                      }}
                      disabled={verifyInstance.isPending}
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm transition-colors hover:bg-secondary/60 disabled:opacity-60"
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
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm transition-colors hover:bg-secondary/60"
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
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm transition-colors hover:bg-secondary/60"
                    >
                      <Server className="h-4 w-4" />
                      {t("Create a server from this instance")}
                    </button>
                  </div>
                )}
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

      {exportInstanceId && (
        <ExportInstanceDialog
          instanceId={exportInstanceId}
          open
          onOpenChange={(next) => !next && setExportInstanceId(null)}
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
  icon: Icon,
  dot,
  label,
  value,
  className,
}: {
  icon?: typeof Clock;
  dot?: "emerald" | "amber";
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex h-[62px] shrink-0 items-center gap-3 rounded-xl border border-border/60 bg-background/35 px-4", className)}>
      {Icon && <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />}
      {dot && (
        <span
          className={cn(
            "h-3 w-3 shrink-0 rounded-full",
            dot === "emerald" ? "bg-emerald-400 shadow-[0_0_8px_hsl(160_80%_50%/0.8)]" : "bg-amber-400 shadow-[0_0_8px_hsl(40_90%_55%/0.8)]",
          )}
        />
      )}
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

/** The instance's picture, small, beside its name in the footer. */
function InstanceThumb({ instanceId }: { instanceId: string }) {
  const { data: cover } = useInstanceCover(instanceId);
  return (
    <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-primary/30 to-primary/5">
      {cover && <img src={cover.uri} alt="" aria-hidden className="h-full w-full object-cover" />}
    </div>
  );
}
