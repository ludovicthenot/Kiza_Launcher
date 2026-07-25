import { useEffect, useMemo, useRef, useState } from "react";
import { GameInstanceSummary } from "../../../lib/types";
import {
  useCurseForgeFiles,
  useCurseForgeSearch,
  useDeleteMod,
  useDeleteMinecraftContent,
  useDeleteShaderpack,
  useInstallCurseForgeContent,
  useInstallModrinthContent,
  useInstallModWithDependencies,
  useInstallShaderpack,
  useMinecraftContent,
  useMinecraftWorlds,
  useMods,
  useModrinthSearch,
  useModrinthVersions,
  useResolveModDependencies,
  useShaderpacks,
} from "../../../lib/queries";
import type {
  MinecraftContentType,
  DependencyInstallResult,
  DependencyResolution,
  ResolveDependenciesRequest,
} from "../../../lib/queries";
import { Check, Download, Loader2, Search, Trash2, TriangleAlert, UserRound } from "lucide-react";
import { cn } from "../../../lib/utils";
import { Badge, Button, EmptyState, Input, Panel } from "../../ui/primitives";
import { LauncherOptionPicker } from "../../ui/launcher-option-picker";
import { DependencyInstallDialog } from "./DependencyInstallDialog";
import { useI18n } from "../../../lib/i18n";
import { curseforgeCompat, modrinthCompat, type SearchCompat } from "../../../lib/searchCompat";
import { findInstalledByTitle } from "../../../lib/installedMatch";
import { useAppStore } from "../../../lib/store";
import { getContentCategory, type ContentCategory } from "../content/contentCategories";

type Provider = "modrinth" | "curseforge";

function allowedFileExtensions(category: ContentCategory): string[] {
  switch (category.id) {
    case "mod":
      return ["jar"];
    case "modpack":
      return ["mrpack", "zip"];
    case "shader":
    case "resourcepack":
    case "datapack":
      return ["zip"];
  }
}

function isInstallableFileName(fileName: string, category: ContentCategory): boolean {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return !!extension && allowedFileExtensions(category).includes(extension);
}

function CompatBadge({ compat }: { compat: SearchCompat }) {
  const { t } = useI18n();
  if (compat === "unknown") return null;
  if (compat === "compatible") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
        <Check className="h-3 w-3" />
        {t("Compatible")}
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
      title={compat === "wrong_loader" ? t("This mod does not support your modloader.") : t("No build for your Minecraft version yet.")}
    >
      <TriangleAlert className="h-3 w-3" />
      {compat === "wrong_loader" ? t("Other loader") : t("Other version")}
    </span>
  );
}

function NonModInstallHint({
  category,
  loader,
  hasWorld,
}: {
  category: ContentCategory;
  loader: string | null;
  hasWorld: boolean;
}) {
  const { t } = useI18n();
  let message: string | null = null;
  if (category.id === "shader" && loader !== "fabric") {
    message = t("Shader installation requires a compatible Fabric instance with Iris support.");
  } else if (category.id === "datapack" && !hasWorld) {
    message = t("Select a Minecraft world before installing a data pack so existing saves are never modified by mistake.");
  }
  if (!message) return null;
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-200/90">
      {message}
    </div>
  );
}

export function DiscoverTab({ instance }: { instance: GameInstanceSummary }) {
  const { t } = useI18n();
  const [provider, setProvider] = useState<Provider>("modrinth");
  const categoryId = useAppStore((state) => state.contentCategory);
  const [query, setQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedCurseModId, setSelectedCurseModId] = useState<number | null>(null);
  const [installRequest, setInstallRequest] = useState<ResolveDependenciesRequest | null>(null);
  const [dependencyPlan, setDependencyPlan] = useState<DependencyResolution | null>(null);
  const [installResult, setInstallResult] = useState<DependencyInstallResult | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installingShaderId, setInstallingShaderId] = useState<string | null>(null);
  const [installingContentKey, setInstallingContentKey] = useState<string | null>(null);
  const [selectedWorld, setSelectedWorld] = useState("");
  const [loadedFilesTarget, setLoadedFilesTarget] = useState<{
    provider: Provider;
    categoryId: string;
    itemId: string;
  } | null>(null);
  const [searchContext, setSearchContext] = useState<{ provider: Provider; categoryId: string; query: string } | null>(null);
  const requestIdRef = useRef(0);
  const fileRequestIdRef = useRef(0);
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);

  const mcVersion = instance.minecraft?.mc_version ?? null;
  const loader = instance.minecraft?.loader ?? null;
  const category = getContentCategory(categoryId);

  const modrinthSearch = useModrinthSearch();
  const curseSearch = useCurseForgeSearch();
  const curseFiles = useCurseForgeFiles();
  const modrinthVersions = useModrinthVersions();
  const resolveDependencies = useResolveModDependencies();
  const installDependencies = useInstallModWithDependencies();
  const worlds = useMinecraftWorlds(category.id === "datapack" ? instance.id : null);
  const managedContentType: MinecraftContentType | null =
    category.id === "resourcepack" || category.id === "datapack" ? category.id : null;
  const installedContent = useMinecraftContent(
    instance.id,
    managedContentType,
    category.id === "datapack" ? selectedWorld : null,
  );
  const { data: installedMods } = useMods(instance.id);
  const { data: installedShaders } = useShaderpacks(instance.id);
  const deleteMod = useDeleteMod();
  const deleteContent = useDeleteMinecraftContent();
  const deleteShader = useDeleteShaderpack();
  const installShader = useInstallShaderpack();
  const installModrinthContent = useInstallModrinthContent();
  const installCurseForgeContent = useInstallCurseForgeContent();

  useEffect(() => {
    if (category.id !== "datapack") {
      setSelectedWorld("");
      return;
    }
    const available = worlds.data ?? [];
    if (!available.some((world) => world.name === selectedWorld)) {
      setSelectedWorld(available[0]?.name ?? "");
    }
  }, [category.id, selectedWorld, worlds.data]);

  const worldOptions = useMemo(
    () =>
      (worlds.data ?? []).map((world) => ({
        value: world.name,
        label: world.name,
        description: `${world.data_pack_count} installed data pack${world.data_pack_count === 1 ? "" : "s"}`,
      })),
    [worlds.data],
  );

  // Finds the installed mod matching a search result title, so the detail
  // panel can offer Uninstall instead of Install.
  const findInstalledMod = (title: string) => {
    const names = (installedMods ?? []).map((mod) => mod.name);
    const matched = findInstalledByTitle(title, names);
    return matched ? (installedMods ?? []).find((mod) => mod.name === matched) ?? null : null;
  };

  const findInstalledShader = (title: string) =>
    findInstalledByTitle(title, (installedShaders ?? []).map((shader) => shader.file_name));

  const findInstalledContent = (title: string) =>
    findInstalledByTitle(title, (installedContent.data ?? []).map((content) => content.file_name));

  const searchMatchesCategory = searchContext?.provider === provider && searchContext.categoryId === category.id;
  const isPopularCatalog = searchMatchesCategory && searchContext?.query === "";
  const modrinthHits = searchMatchesCategory ? modrinthSearch.data?.hits ?? [] : [];
  const curseHits = searchMatchesCategory ? curseSearch.data?.data ?? [] : [];
  const isSearching = modrinthSearch.isPending || curseSearch.isPending;
  const hasSearched = !!searchMatchesCategory;

  const selectedModrinth = useMemo(
    () => modrinthHits.find((hit) => hit.project_id === selectedProjectId) ?? null,
    [modrinthHits, selectedProjectId],
  );
  const selectedCurse = useMemo(
    () => curseHits.find((hit) => hit.id === selectedCurseModId) ?? null,
    [curseHits, selectedCurseModId],
  );
  const hasLoadedCurrentModrinthFiles =
    loadedFilesTarget?.provider === "modrinth" &&
    loadedFilesTarget.categoryId === category.id &&
    loadedFilesTarget.itemId === selectedProjectId;
  const hasLoadedCurrentCurseFiles =
    loadedFilesTarget?.provider === "curseforge" &&
    loadedFilesTarget.categoryId === category.id &&
    loadedFilesTarget.itemId === selectedCurseModId?.toString();
  const compatibleModrinthVersions = useMemo(
    () =>
      (hasLoadedCurrentModrinthFiles ? modrinthVersions.data ?? [] : [])
        .filter((version) => version.project_id === selectedProjectId)
        .filter(
          (version) =>
            category.id !== "mod" ||
            !loader ||
            version.loaders.some((entry) => entry.toLowerCase() === loader.toLowerCase()),
        )
        .filter(
          (version) =>
            category.id === "modpack" ||
            !mcVersion ||
            version.game_versions.includes(mcVersion),
        )
        .filter((version) => version.files.some((file) => isInstallableFileName(file.filename, category)))
        .sort((a, b) => (a.date_published < b.date_published ? 1 : -1)),
    [category.id, hasLoadedCurrentModrinthFiles, loader, mcVersion, modrinthVersions.data, selectedProjectId],
  );
  const visibleCurseFiles = useMemo(
    () =>
      (hasLoadedCurrentCurseFiles ? curseFiles.data?.data ?? [] : [])
        .filter((file) => !mcVersion || file.game_versions.includes(mcVersion))
        .filter((file) => isInstallableFileName(file.file_name, category)),
    [category, curseFiles.data?.data, hasLoadedCurrentCurseFiles, mcVersion],
  );

  const runSearch = async (overrides?: { provider?: Provider; category?: ContentCategory; searchQuery?: string }) => {
    const activeProvider = overrides?.provider ?? provider;
    const activeCategory = overrides?.category ?? category;
    const searchQuery = overrides?.searchQuery ?? query.trim();
    const requestId = ++requestIdRef.current;
    fileRequestIdRef.current += 1;
    modrinthVersions.reset();
    curseFiles.reset();
    setLoadedFilesTarget(null);
    setSelectedProjectId(null);
    setSelectedCurseModId(null);
    setSearchContext(null);

    try {
      if (activeProvider === "modrinth") {
        const result = await modrinthSearch.mutateAsync({ instanceId: instance.id, query: searchQuery, projectType: activeCategory.modrinthType, limit: 20, offset: 0 });
        if (requestId !== requestIdRef.current) return;
        setSearchContext({ provider: activeProvider, categoryId: activeCategory.id, query: searchQuery });
        setSelectedProjectId(result.hits[0]?.project_id ?? null);
      } else {
        const result = await curseSearch.mutateAsync({ instanceId: instance.id, query: searchQuery, classId: activeCategory.curseClassId, pageSize: 20, index: 0 });
        if (requestId !== requestIdRef.current) return;
        setSearchContext({ provider: activeProvider, categoryId: activeCategory.id, query: searchQuery });
        setSelectedCurseModId(result.data[0]?.id ?? null);
      }
    } catch {
      // Mutation hooks present the provider-specific error.
    }
  };

  useEffect(() => {
    setQuery("");
    void runSearch({ provider, category, searchQuery: "" });
    // A category change intentionally resets to its popular catalog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, instance.id]);

  const selectProvider = (nextProvider: Provider) => {
    if (nextProvider === provider) return;
    setProvider(nextProvider);
    void runSearch({ provider: nextProvider, category, searchQuery: query.trim() });
  };

  const loadCurseFiles = async (modId: number) => {
    const requestId = ++fileRequestIdRef.current;
    await curseFiles.mutateAsync({
      instanceId: instance.id,
      modId,
      contentType: category.id,
      pageSize: 50,
      index: 0,
    });
    if (requestId !== fileRequestIdRef.current) return;
    setLoadedFilesTarget({
      provider: "curseforge",
      categoryId: category.id,
      itemId: modId.toString(),
    });
  };

  const loadModrinthFiles = async (projectId: string) => {
    const requestId = ++fileRequestIdRef.current;
    await modrinthVersions.mutateAsync(projectId);
    if (requestId !== fileRequestIdRef.current) return;
    setLoadedFilesTarget({
      provider: "modrinth",
      categoryId: category.id,
      itemId: projectId,
    });
  };

  const selectModrinthProject = (projectId: string) => {
    if (projectId === selectedProjectId) return;
    fileRequestIdRef.current += 1;
    modrinthVersions.reset();
    curseFiles.reset();
    setLoadedFilesTarget(null);
    setSelectedProjectId(projectId);
  };

  const selectCurseProject = (modId: number) => {
    if (modId === selectedCurseModId) return;
    fileRequestIdRef.current += 1;
    modrinthVersions.reset();
    curseFiles.reset();
    setLoadedFilesTarget(null);
    setSelectedCurseModId(modId);
  };

  const prepareInstall = async (request: ResolveDependenciesRequest) => {
    setInstallRequest(request);
    setDependencyPlan(null);
    setInstallResult(null);
    setInstallDialogOpen(true);
    try {
      setDependencyPlan(await resolveDependencies.mutateAsync(request));
    } catch {
      setInstallDialogOpen(false);
    }
  };

  const confirmInstall = async () => {
    if (!installRequest) return;
    try {
      setInstallResult(await installDependencies.mutateAsync(installRequest));
    } catch {
      // The mutation already presents the backend error.
    }
  };

  const setDependencyDialogOpen = (open: boolean) => {
    setInstallDialogOpen(open);
    if (!open) {
      setInstallRequest(null);
      setDependencyPlan(null);
      setInstallResult(null);
    }
  };

  const installModrinthPack = async (projectId: string, versionId: string, displayName: string) => {
    const contentType = category.id as MinecraftContentType;
    const key = `modrinth:${versionId}`;
    setInstallingContentKey(key);
    try {
      const result = await installModrinthContent.mutateAsync({
        instanceId: instance.id,
        contentType,
        projectId,
        versionId,
        worldName: category.id === "datapack" ? selectedWorld : null,
        displayName,
      });
      if (result.created_instance_id) {
        setSelectedInstanceId(result.created_instance_id);
      }
    } finally {
      setInstallingContentKey(null);
    }
  };

  const installCurseForgePack = async (
    modId: number,
    fileId: number,
    displayName: string,
  ) => {
    const contentType = category.id as MinecraftContentType;
    const key = `curseforge:${fileId}`;
    setInstallingContentKey(key);
    try {
      const result = await installCurseForgeContent.mutateAsync({
        instanceId: instance.id,
        contentType,
        modId,
        fileId,
        worldName: category.id === "datapack" ? selectedWorld : null,
        displayName,
      });
      if (result.created_instance_id) {
        setSelectedInstanceId(result.created_instance_id);
      }
    } finally {
      setInstallingContentKey(null);
    }
  };

  const hasRequiredWorld = category.id !== "datapack" || !!selectedWorld;

  if (instance.game_id !== "minecraft") {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        {t("Discover is only available for Minecraft.")}
      </div>
    );
  }

  const CategoryIcon = category.icon;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/50 bg-card/30 p-4 sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <CategoryIcon className="h-5 w-5 text-primary" />
              {t(category.label)}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge className="h-6 px-2 py-0 text-[11px]">{t("Search content")}</Badge>
              {isPopularCatalog && <Badge className="h-6 px-2 py-0 text-[11px]">{t("Most popular")}</Badge>}
              <Badge className="h-6 px-2 py-0 text-[11px]">{mcVersion ? `Minecraft ${mcVersion}` : "Minecraft"}</Badge>
              {loader && <Badge className="h-6 px-2 py-0 text-[11px]">{loader}</Badge>}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {category.id === "datapack" && (
              <div className="w-64">
                <LauncherOptionPicker
                  ariaLabel="Minecraft world"
                  options={worldOptions}
                  value={selectedWorld}
                  onValueChange={setSelectedWorld}
                  placeholder={worlds.isLoading ? "Loading worlds..." : "No Minecraft world found"}
                  disabled={worldOptions.length === 0}
                  loading={worlds.isLoading}
                />
              </div>
            )}
            <Button
              onClick={() => selectProvider("modrinth")}
              variant={provider === "modrinth" ? "primary" : "secondary"}
              className="h-9"
            >
              Modrinth
            </Button>
            <Button
              onClick={() => selectProvider("curseforge")}
              variant={provider === "curseforge" ? "primary" : "secondary"}
              className="h-9"
            >
              CurseForge
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
              placeholder={t("Search {category}...").replace("{category}", t(category.label).toLowerCase())}
              className="pr-9"
            />
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <Button onClick={() => runSearch()} disabled={isSearching} variant="primary">
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t("Search")}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-h-0 space-y-2 overflow-y-auto border-r border-border/50 p-4">
          {isSearching && !hasSearched && (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {t("Loading popular content...")}
            </div>
          )}
          {!isSearching && !hasSearched && (
            <EmptyState
              title={t("Search {category}...").replace("{category}", t(category.label).toLowerCase())}
              description={t("Browse popular content or search by name.")}
            />
          )}
          {hasSearched && provider === "modrinth" && modrinthHits.length === 0 && (
            <EmptyState title={t("No Modrinth results")} description={t("Try a shorter name or check the Minecraft version.")} />
          )}
          {hasSearched && provider === "curseforge" && curseHits.length === 0 && (
            <EmptyState title={t("No CurseForge results")} description={t("Try another term or check the CurseForge API connection.")} />
          )}

          {provider === "modrinth" &&
            modrinthHits.map((hit) => (
              <button
                key={hit.project_id}
                onClick={() => selectModrinthProject(hit.project_id)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors",
                  selectedProjectId === hit.project_id ? "border-primary/40 bg-primary/5" : "border-border bg-card/20 hover:bg-card/40",
                )}
              >
                <div className="flex gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-secondary/30">
                    {hit.icon_url ? <img src={hit.icon_url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-primary/10" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-sm font-medium">{hit.title}</div>
                      <CompatBadge compat={modrinthCompat(hit, mcVersion, category.id === "mod" ? loader : null)} />
                    </div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{hit.description}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="font-medium text-foreground/75">{t("By")} {hit.author}</span>
                      <span aria-hidden="true">·</span>
                      <span>{hit.downloads.toLocaleString()} downloads</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}

          {provider === "curseforge" &&
            curseHits.map((hit) => (
              <button
                key={hit.id}
                onClick={() => selectCurseProject(hit.id)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors",
                  selectedCurseModId === hit.id ? "border-primary/40 bg-primary/5" : "border-border bg-card/20 hover:bg-card/40",
                )}
              >
                <div className="flex gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-secondary/30">
                    {hit.logo?.thumbnail_url ? <img src={hit.logo.thumbnail_url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-primary/10" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-sm font-medium">{hit.name}</div>
                      <CompatBadge compat={curseforgeCompat(hit, mcVersion, category.id === "mod" ? loader : null)} />
                    </div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{hit.summary ?? ""}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="truncate font-medium text-foreground/75">
                        {t("By")} {hit.authors?.map((author) => author.name).join(", ") || t("Unknown author")}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">{Math.round(hit.download_count ?? 0).toLocaleString()} downloads</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
        </div>

        <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
          {provider === "modrinth" && (
            <div className="space-y-4">
              {selectedModrinth ? (
                <>
                  <Panel className="flex min-w-0 flex-col gap-4 p-4 sm:flex-row">
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary/30">
                      {selectedModrinth.icon_url ? <img src={selectedModrinth.icon_url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-primary/10" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xl font-bold">{selectedModrinth.title}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                        <UserRound className="h-3.5 w-3.5 text-primary" />
                        {t("By")} {selectedModrinth.author}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{selectedModrinth.description}</div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge>{selectedModrinth.downloads.toLocaleString()} downloads</Badge>
                        <Badge>{selectedModrinth.versions.slice(-3).join(", ")}</Badge>
                      </div>
                    </div>
                  </Panel>

                  {category.installMode === "shader" ? (() => {
                    if (loader !== "fabric") {
                      return <NonModInstallHint category={category} loader={loader} hasWorld={hasRequiredWorld} />;
                    }
                    const installed = findInstalledShader(selectedModrinth.title);
                    return installed ? (
                      <Button
                        onClick={() => deleteShader.mutate({ instanceId: instance.id, fileName: installed })}
                        disabled={deleteShader.isPending}
                        variant="danger"
                      >
                        {deleteShader.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        {t("Uninstall")}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => {
                          setInstallingShaderId(selectedModrinth.project_id);
                          installShader.mutate(
                            { instanceId: instance.id, projectId: selectedModrinth.project_id },
                            { onSettled: () => setInstallingShaderId(null) },
                          );
                        }}
                        disabled={installShader.isPending}
                        variant="primary"
                      >
                        {installingShaderId === selectedModrinth.project_id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Download className="h-4 w-4" />}
                        {t("Install")}
                      </Button>
                    );
                  })() : (() => {
                    const installedMod = category.installMode === "mod"
                      ? findInstalledMod(selectedModrinth.title)
                      : null;
                    const installedPack = category.installMode === "pack"
                      ? findInstalledContent(selectedModrinth.title)
                      : null;
                    if (installedMod) {
                      return (
                        <Button
                          onClick={() => deleteMod.mutate({ instanceId: instance.id, modId: installedMod.id })}
                          disabled={deleteMod.isPending}
                          variant="danger"
                        >
                          {deleteMod.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          {t("Uninstall")}
                        </Button>
                      );
                    }
                    if (installedPack) {
                      return (
                        <Button
                          onClick={() => deleteContent.mutate({
                            instanceId: instance.id,
                            contentType: category.id as MinecraftContentType,
                            fileName: installedPack,
                            worldName: category.id === "datapack" ? selectedWorld : null,
                          })}
                          disabled={deleteContent.isPending}
                          variant="danger"
                        >
                          {deleteContent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          {t("Uninstall")}
                        </Button>
                      );
                    }
                    return (
                      <div className="space-y-3">
                        <NonModInstallHint category={category} loader={loader} hasWorld={hasRequiredWorld} />
                        <Button
                          onClick={() => loadModrinthFiles(selectedModrinth.project_id)}
                          disabled={modrinthVersions.isPending}
                          variant="primary"
                        >
                          {modrinthVersions.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          {t("Load files")}
                        </Button>
                        {compatibleModrinthVersions.length ? (
                          <div className="space-y-2">
                            {compatibleModrinthVersions.slice(0, 20).map((version) => {
                              const installableFiles = version.files.filter((file) =>
                                isInstallableFileName(file.filename, category));
                              const fileName = installableFiles.find((file) => file.primary)?.filename
                                ?? installableFiles[0]?.filename
                                ?? version.version_number;
                              const installKey = `modrinth:${version.id}`;
                              const busy = installingContentKey === installKey;
                              return (
                                <div key={version.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/20 p-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium">{fileName}</div>
                                    <div className="truncate text-xs text-muted-foreground">{version.game_versions.slice(0, 5).join(", ")}</div>
                                  </div>
                                  <Button
                                    onClick={() => category.installMode === "mod"
                                      ? prepareInstall({
                                          instanceId: instance.id,
                                          source: "modrinth",
                                          projectId: selectedModrinth.project_id,
                                          versionId: version.id,
                                          author: selectedModrinth.author,
                                        })
                                      : installModrinthPack(
                                          selectedModrinth.project_id,
                                          version.id,
                                          selectedModrinth.title,
                                        )}
                                    disabled={
                                      !hasRequiredWorld ||
                                      resolveDependencies.isPending ||
                                      installDependencies.isPending ||
                                      installModrinthContent.isPending
                                    }
                                    variant="primary"
                                    className="h-9 shrink-0"
                                  >
                                    {(busy || resolveDependencies.isPending)
                                      ? <Loader2 className="h-4 w-4 animate-spin" />
                                      : <Download className="h-4 w-4" />}
                                    {category.installMode === "mod"
                                      ? t("Review")
                                      : category.installMode === "modpack"
                                        ? t("Create instance")
                                        : t("Install")}
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            {hasLoadedCurrentModrinthFiles
                              ? t("No compatible file for this instance. Try another version or loader.")
                              : t("Load the file list to see the builds compatible with this instance.")}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <EmptyState title={t("Select an item")} description={t("The detail panel will show the cover, compatible versions and the install action.")} />
              )}
            </div>
          )}

          {provider === "curseforge" && (
            <div className="space-y-4">
              {selectedCurse ? (
                <>
                  <Panel className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 gap-4">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary/30">
                        {selectedCurse.logo?.thumbnail_url ? <img src={selectedCurse.logo.thumbnail_url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-primary/10" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xl font-bold">{selectedCurse.name}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                          <UserRound className="h-3.5 w-3.5 text-primary" />
                          {t("By")} {selectedCurse.authors?.map((author) => author.name).join(", ") || t("Unknown author")}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">{selectedCurse.summary ?? ""}</div>
                        <div className="mt-2 text-xs text-muted-foreground">{Math.round(selectedCurse.download_count ?? 0).toLocaleString()} downloads</div>
                      </div>
                    </div>
                    {(() => {
                      const installedMod = category.installMode === "mod" ? findInstalledMod(selectedCurse.name) : null;
                      const installedShader = category.installMode === "shader" ? findInstalledShader(selectedCurse.name) : null;
                      const installedPack = category.installMode === "pack" ? findInstalledContent(selectedCurse.name) : null;
                      if (installedMod) {
                        return (
                          <Button
                            onClick={() => deleteMod.mutate({ instanceId: instance.id, modId: installedMod.id })}
                            disabled={deleteMod.isPending}
                            variant="danger"
                            className="h-9 shrink-0"
                          >
                            {deleteMod.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            {t("Uninstall")}
                          </Button>
                        );
                      }
                      if (installedShader) {
                        return (
                          <Button
                            onClick={() => deleteShader.mutate({ instanceId: instance.id, fileName: installedShader })}
                            disabled={deleteShader.isPending}
                            variant="danger"
                            className="h-9 shrink-0"
                          >
                            {deleteShader.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            {t("Uninstall")}
                          </Button>
                        );
                      }
                      if (installedPack) {
                        return (
                          <Button
                            onClick={() => deleteContent.mutate({
                              instanceId: instance.id,
                              contentType: category.id as MinecraftContentType,
                              fileName: installedPack,
                              worldName: category.id === "datapack" ? selectedWorld : null,
                            })}
                            disabled={deleteContent.isPending}
                            variant="danger"
                            className="h-9 shrink-0"
                          >
                            {deleteContent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            {t("Uninstall")}
                          </Button>
                        );
                      }
                      return (
                        <Button
                          onClick={() => loadCurseFiles(selectedCurse.id)}
                          disabled={curseFiles.isPending}
                          className="h-9 shrink-0"
                        >
                          {curseFiles.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          {t("Load files")}
                        </Button>
                      );
                    })()}
                  </Panel>

                  <NonModInstallHint category={category} loader={loader} hasWorld={hasRequiredWorld} />

                  {visibleCurseFiles.length ? (
                    <div className="space-y-2">
                      {visibleCurseFiles.slice(0, 20).map((file) => (
                        <div key={file.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/20 p-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{file.file_name}</div>
                            <div className="truncate text-xs text-muted-foreground">{file.game_versions.slice(0, 5).join(", ")}</div>
                          </div>
                          <Button
                            onClick={() => category.installMode === "mod"
                              ? prepareInstall({
                                  instanceId: instance.id,
                                  source: "curseforge",
                                  projectId: selectedCurse.id.toString(),
                                  fileId: file.id,
                                  author: selectedCurse.authors?.map((author) => author.name).join(", ") || null,
                                })
                              : installCurseForgePack(
                                  selectedCurse.id,
                                  file.id,
                                  selectedCurse.name,
                                )}
                            disabled={
                              !hasRequiredWorld ||
                              (category.installMode === "shader" && loader !== "fabric") ||
                              resolveDependencies.isPending ||
                              installDependencies.isPending ||
                              installCurseForgeContent.isPending
                            }
                            variant="primary"
                            className="h-9 shrink-0"
                          >
                            {(installingContentKey === `curseforge:${file.id}` || resolveDependencies.isPending)
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Download className="h-4 w-4" />}
                            {category.installMode === "mod"
                              ? t("Review")
                              : category.installMode === "modpack"
                                ? t("Create instance")
                                : t("Install")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {t("Load the file list to see the builds compatible with this instance.")}
                    </div>
                  )}
                </>
              ) : (
                <EmptyState title={t("Select an item")} description={t("The CurseForge card and its compatible files will be shown here.")} />
              )}
            </div>
          )}
        </div>
      </div>

      <DependencyInstallDialog
        open={installDialogOpen}
        plan={dependencyPlan}
        result={installResult}
        installing={installDependencies.isPending}
        onOpenChange={setDependencyDialogOpen}
        onConfirm={confirmInstall}
      />
    </div>
  );
}
