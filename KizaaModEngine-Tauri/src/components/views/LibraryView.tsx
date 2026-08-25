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
  useLaunchMinecraft,
  useMinecraftAccount,
  useOpenInstanceFolder,
  usePlayHistory,
} from "../../lib/queries";
import { InstancePoster } from "../common/InstancePoster";
import { ExportInstanceDialog } from "../instance/ExportInstanceDialog";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  ArrowUpDown,
  Box,
  Clock,
  Coffee,
  Feather,
  FolderClosed,
  FolderOpen,
  Hammer,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Server,
  Share2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useAppStore } from "../../lib/store";
import { MINECRAFT_LOADER_OPTIONS } from "../../lib/minecraftLoaders";
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
import { useI18n } from "../../lib/i18n";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";

const loaderPresentation = {
  vanilla: { icon: Box, description: "Original game" },
  fabric: { icon: Feather, description: "Lightweight mods" },
  forge: { icon: Hammer, description: "Forge ecosystem" },
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
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);
  const setShowServerHub = useAppStore((state) => state.setShowServerHub);
  const [exportInstanceId, setExportInstanceId] = useState<string | null>(null);
  const openInstanceFolder = useOpenInstanceFolder();
  const launchMinecraft = useLaunchMinecraft();
  const { data: minecraftAccount } = useMinecraftAccount();
  const { data: playHistory } = usePlayHistory();

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
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
    if (!needle) return orderedInstances;
    return orderedInstances.filter((instance) =>
      instance.display_name.toLowerCase().includes(needle),
    );
  }, [orderedInstances, query]);

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
    if (hours < 1) return t("Last played: just now");
    if (hours < 24) return `${t("Last played")}: ${t("{count} h ago").replace("{count}", String(hours))}`;
    const days = Math.round(hours / 24);
    return `${t("Last played")}: ${t("{count} d ago").replace("{count}", String(days))}`;
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
    updateDiscordStatus(null);
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
      { onSuccess: (instanceId) => setSelectedInstanceId(instanceId) },
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
              <div className="grid grid-cols-3 gap-2">
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
                <label className="text-sm font-medium">{t("Version")} {minecraftLoader === "fabric" ? "Fabric" : "Forge"}</label>
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

      <div
        data-anim="header"
        className="mb-5 flex min-h-[64px] shrink-0 flex-nowrap items-center gap-4 xl:mb-7"
      >
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center">
            <Box className="h-11 w-11 text-primary" strokeWidth={1.7} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[27px] font-bold tracking-tight">{t("My library")}</h1>
            <p className="mt-1 truncate text-base text-muted-foreground">
              {minecraftInstances.length}{" "}
              {minecraftInstances.length === 1 ? t("Minecraft instance") : t("Minecraft instances")}
            </p>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-4">
          <button
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            title={t("Search your instances")}
            aria-label={t("Search your instances")}
            className={cn(
              "flex h-[54px] w-[58px] items-center justify-center rounded-xl border transition-colors",
              searchOpen
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/70 bg-secondary/30 text-muted-foreground hover:text-foreground",
            )}
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setSortBy((current) => (current === "recent" ? "name" : "recent"))}
            title={sortBy === "recent" ? t("Sorted by last played") : t("Sorted by name")}
            aria-label={t("Change the order")}
            className="flex h-[54px] w-[68px] items-center justify-center rounded-xl border border-border/70 bg-secondary/30 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowUpDown className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleImportInstance}
            disabled={importInstance.isPending}
            className="inline-flex h-[54px] items-center gap-3 rounded-xl border border-border/70 bg-secondary/30 px-8 text-base font-medium transition-[border-color,background-color] hover:border-primary/40 disabled:opacity-60"
          >
            {importInstance.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-5 w-5" />
            )}
            {t("Import")}
          </button>
          <button
            type="button"
            onClick={() => setMinecraftDialogOpen(true)}
            disabled={isAddingMinecraft || createMinecraftInstance.isPending}
            className="inline-flex h-[54px] items-center gap-3 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-8 text-base font-semibold text-white shadow-[0_8px_24px_-10px_rgba(139,92,246,0.95)] transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
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

      {searchOpen && (
        <div className="mb-5">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search your instances…")}
          />
        </div>
      )}

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
              className="flex aspect-[4/7] w-full min-w-0 flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-border/70 bg-card/20 text-primary transition-[border-color,background-color,transform] hover:-translate-y-1 hover:border-primary/50 hover:bg-primary/[0.04]"
            >
              <Plus className="h-11 w-11" strokeWidth={1.6} />
              <span className="max-w-[9rem] text-center text-xl font-medium leading-relaxed">
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
              className="mt-5 flex min-h-[76px] shrink-0 flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-border/60 bg-card/55 px-8 py-4 xl:mt-9"
            >
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {lastPlayedLabel}
              </span>
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Coffee className="h-4 w-4" />
                Java {focused.minecraft?.java_major ?? t("automatic")}
              </span>
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <FolderClosed className="h-4 w-4" />
                {t("Isolated folder")}
              </span>

              <div className="relative ml-auto flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => openInstanceFolder.mutate(focused.id)}
                  title={t("Open the instance folder")}
                  aria-label={t("Open the instance folder")}
                  className="flex h-[50px] w-[56px] items-center justify-center rounded-xl border border-border/70 bg-secondary/20 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => verifyInstance.mutate(focused.id)}
                  disabled={verifyInstance.isPending}
                  title={t("Check this instance")}
                  aria-label={t("Check this instance")}
                  className="flex h-[50px] w-[56px] items-center justify-center rounded-xl border border-border/70 bg-secondary/20 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                >
                  {verifyInstance.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setExportInstanceId(focused.id)}
                  title={t("Export this instance")}
                  aria-label={t("Export this instance")}
                  className="flex h-[50px] w-[56px] items-center justify-center rounded-xl border border-border/70 bg-secondary/20 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                >
                  {(
                    <Share2 className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setFooterMenuOpen((open) => !open)}
                  title={t("More actions")}
                  aria-label={t("More actions")}
                  aria-expanded={footerMenuOpen}
                  className="flex h-[50px] w-[56px] items-center justify-center rounded-xl border border-border/70 bg-secondary/20 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {footerMenuOpen && (
                  <div className="absolute bottom-[58px] right-0 z-30 w-60 overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setFooterMenuOpen(false);
                        setSelectedInstanceId(focused.id);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-secondary/60"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                      {t("Manage this instance")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFooterMenuOpen(false);
                        setShowServerHub(true);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-secondary/60"
                    >
                      <Server className="h-4 w-4" />
                      {t("Servers")}
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
