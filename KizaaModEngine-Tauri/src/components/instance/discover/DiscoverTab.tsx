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
  useMinecraftContent,
  useMinecraftWorlds,
  useMods,
  useDownloadContentFile,
  useModrinthSearch,
  useModrinthVersions,
  useResolveModDependencies,
  useShaderpacks,
  useOptiFineReleases,
  useInstallOptiFine,
} from "../../../lib/queries";
import type {
  MinecraftContentType,
  CurseForgeMod,
  CurseForgeSearchResponse,
  DependencyInstallResult,
  DependencyResolution,
  ModrinthProjectHit,
  ModrinthSearchResponse,
  ResolveDependenciesRequest,
} from "../../../lib/queries";
import {
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn, formatBytes } from "../../../lib/utils";
import { Badge, Button, EmptyState } from "../../ui/primitives";
import { Checkbox } from "../../ui/checkbox";
import { LauncherOptionPicker } from "../../ui/launcher-option-picker";
import { DependencyInstallDialog } from "./DependencyInstallDialog";
import { ContentDetailPanel } from "./ContentDetailPanel";
import { ProviderBadge, type ContentProvider } from "./ProviderBadge";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../../../lib/i18n";
import { formatDate } from "../../../lib/datetime";
import { useRegionFormats } from "../../../lib/useRegionFormats";
import { curseforgeCompat, modrinthCompat, type SearchCompat } from "../../../lib/searchCompat";
import { findInstalledByTitle } from "../../../lib/installedMatch";
import { projectKey } from "../../../lib/projectMatch";
import { useAppStore } from "../../../lib/store";
import { getContentCategory, type ContentCategory } from "../content/contentCategories";

type SourceProvider = ContentProvider;
type Provider = "all" | SourceProvider;
type SortMode = "relevance" | "downloads" | "updated";

type UnifiedResult =
  | { provider: "modrinth"; rank: number; hit: ModrinthProjectHit }
  | { provider: "curseforge"; rank: number; hit: CurseForgeMod };

/** One project, with whichever catalogues list it. */
type MergedResult = {
  key: string;
  /** The catalogue that ranked it first; decides what the row displays. */
  primary: SourceProvider;
  modrinth?: ModrinthProjectHit;
  curseforge?: CurseForgeMod;
};

function resultTitle(result: UnifiedResult): string {
  return result.provider === "modrinth" ? result.hit.title : result.hit.name;
}

function resultDownloads(result: UnifiedResult): number {
  return result.provider === "modrinth" ? result.hit.downloads : result.hit.download_count ?? 0;
}

function orderUnifiedResults(
  results: UnifiedResult[],
  provider: Provider,
  sort: SortMode,
): UnifiedResult[] {
  if (provider !== "all") return results;

  const ordered = [...results];
  switch (sort) {
    case "downloads":
      return ordered.sort((a, b) => resultDownloads(b) - resultDownloads(a));
    case "updated":
      return ordered.sort(
        (a, b) =>
          new Date(b.hit.date_modified ?? 0).getTime() -
          new Date(a.hit.date_modified ?? 0).getTime(),
      );
    case "relevance":
      // Relevance scores are provider-specific. Interleaving equal ranks avoids
      // pretending one catalogue's score is comparable with the other's.
      return ordered.sort((a, b) => a.rank - b.rank || (a.provider === "modrinth" ? -1 : 1));
  }
}

// Results are paged in; a full page back means there is probably more.
const SEARCH_PAGE_SIZE = 30;

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

/**
 * One search result.
 *
 * Compatibility is the last line rather than a badge tucked beside the name:
 * it is the fact that decides whether the rest of the card matters, and it
 * should be readable while scanning down the column.
 */
function ResultCard({
  selected,
  onClick,
  iconUrl,
  title,
  author,
  summary,
  providers,
  downloads,
  compat,
}: {
  selected: boolean;
  onClick: () => void;
  iconUrl: string | null;
  title: string;
  author: string;
  summary: string;
  /** Every catalogue carrying this project, in display order. */
  providers: SourceProvider[];
  downloads: number;
  compat: SearchCompat;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative min-h-[140px] w-full shrink-0 overflow-hidden px-5 py-4 text-left outline-none transition-[background-color,box-shadow,scale] duration-150 ease-out last:flex-1 active:scale-[0.96] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary/70",
        selected
          ? "bg-primary/[0.08] shadow-[inset_3px_0_0_hsl(var(--primary)),inset_0_0_0_1px_hsl(var(--primary)/0.22)]"
          : "hover:bg-secondary/25",
      )}
    >
      {selected && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] bg-primary"
        />
      )}
      <div className="flex gap-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-secondary/30 shadow-[0_0_0_1px_hsl(var(--border)/0.85)]">
          {iconUrl ? (
            <img src={iconUrl} alt="" className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-white/10" />
          ) : (
            <div className="h-full w-full bg-primary/10" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold leading-tight">{title}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {t("By")} {author}
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {summary}
          </p>
        </div>

        <div className="flex min-w-[108px] shrink-0 flex-col items-end justify-between gap-1.5">
          {/* One card per project, one badge per catalogue that has it. */}
          <div className="flex flex-wrap justify-end gap-1">
            {providers.map((source) => (
              <ProviderBadge key={source} provider={source} />
            ))}
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
            <Download className="h-3 w-3" />
            {compactCount(downloads)}
          </span>
          <CompatBadge compat={compat} />
        </div>
      </div>
    </button>
  );
}

/** 22 700 000 reads as 22.7 M; the exact figure is noise at this size. */
function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} k`;
  return Math.round(value).toLocaleString();
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
  // Shaders are driven by Iris on Fabric and by OptiFine on Forge; only
  // Vanilla genuinely has no shader engine.
  if (category.id === "shader" && loader === "vanilla") {
    message = t("Shaders need a modloader: create a Fabric instance (Iris) or a Forge instance (OptiFine).");
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
  const regionFormats = useRegionFormats();
  const [provider, setProvider] = useState<Provider>("all");
  const [selectedProvider, setSelectedProvider] = useState<SourceProvider | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("relevance");
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterVersion, setFilterVersion] = useState(true);
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
    provider: SourceProvider;
    categoryId: string;
    itemId: string;
  } | null>(null);
  const [searchContext, setSearchContext] = useState<{
    provider: Provider;
    categoryId: string;
    query: string;
    compatibleOnly: boolean;
    filterVersion: boolean;
    sort: SortMode;
  } | null>(null);
  const [compatibleOnly, setCompatibleOnly] = useState(true);
  // Results accumulate page by page so the catalogue is browsable beyond the
  // first request instead of being capped at one page.
  const [modrinthResults, setModrinthResults] = useState<ModrinthProjectHit[]>([]);
  const [curseResults, setCurseResults] = useState<CurseForgeMod[]>([]);
  const [nextIndex, setNextIndex] = useState<Record<SourceProvider, number>>({ modrinth: 0, curseforge: 0 });
  const [hasMoreByProvider, setHasMoreByProvider] = useState<Record<SourceProvider, boolean>>({ modrinth: false, curseforge: false });
  const [modrinthTotal, setModrinthTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestIdRef = useRef(0);
  const fileRequestIdRef = useRef(0);
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const mcVersion = instance.minecraft?.mc_version ?? null;
  const loader = instance.minecraft?.loader ?? null;
  const category = getContentCategory(categoryId);

  // OptiFine only exists on optifine.net, so searching for it here would
  // otherwise return nothing at all.
  const wantsOptiFine = query.trim().toLowerCase().includes("optifine")
    || searchContext?.query.trim().toLowerCase().includes("optifine") === true;
  const showOptiFine = category.id === "mod" && wantsOptiFine;
  const optifineReleases = useOptiFineReleases(instance.id, showOptiFine);
  const installOptiFine = useInstallOptiFine();

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

  const searchMatchesCategory =
    searchContext?.provider === provider &&
    searchContext.categoryId === category.id &&
    searchContext.compatibleOnly === compatibleOnly &&
    searchContext.filterVersion === filterVersion &&
    searchContext.sort === sortMode;
  const isPopularCatalog = searchMatchesCategory && searchContext?.query === "";
  const modrinthHits =
    searchMatchesCategory && (provider === "all" || provider === "modrinth") ? modrinthResults : [];
  const curseHits =
    searchMatchesCategory && (provider === "all" || provider === "curseforge") ? curseResults : [];
  const isSearching = modrinthSearch.isPending || curseSearch.isPending;
  const hasSearched = !!searchMatchesCategory;
  const hasMore =
    (provider === "all" || provider === "modrinth" ? hasMoreByProvider.modrinth : false) ||
    (provider === "all" || provider === "curseforge" ? hasMoreByProvider.curseforge : false);

  // The version filter runs on the provider side, so results are already
  // scoped to this instance's Minecraft version; the loader filter is opt-in.
  // Results are trusted as-is here: re-filtering them against the (incomplete)
  // file index would hide builds the provider already confirmed.
  const compatLoader = category.id === "mod" ? loader : null;
  const compatChecked = category.id === "mod" && !!compatLoader;
  const visibleModrinthHits = modrinthHits;
  const visibleCurseHits = curseHits;

  const unifiedResults = useMemo<UnifiedResult[]>(() => {
    const combined: UnifiedResult[] = [
      ...visibleModrinthHits.map((hit, rank) => ({ provider: "modrinth" as const, rank, hit })),
      ...visibleCurseHits.map((hit, rank) => ({ provider: "curseforge" as const, rank, hit })),
    ];
    return orderUnifiedResults(combined, provider, sortMode);
  }, [provider, sortMode, visibleCurseHits, visibleModrinthHits]);

  /**
   * One row per project, carrying every catalogue that lists it.
   *
   * The same mod is published on both platforms far more often than not, and
   * two rows with the same name and icon read as a bug. Merging them keeps the
   * choice of source without spending a row on it — the detail panel offers the
   * switch.
   *
   * Ordering follows the first listing seen, so the merged row keeps the rank
   * the better-placed catalogue gave it.
   */
  const mergedResults = useMemo<MergedResult[]>(() => {
    const rows: MergedResult[] = [];
    const byKey = new Map<string, MergedResult>();

    for (const result of unifiedResults) {
      const title = resultTitle(result);
      const key = projectKey(title);
      // No comparable identity means no merging: an unnamed project must not
      // collapse into another unnamed one.
      const existing = key ? byKey.get(key) : undefined;

      if (existing) {
        if (result.provider === "modrinth" && !existing.modrinth) existing.modrinth = result.hit;
        if (result.provider === "curseforge" && !existing.curseforge) existing.curseforge = result.hit;
        continue;
      }

      const row: MergedResult = {
        key: key || `${result.provider}:${title}:${rows.length}`,
        primary: result.provider,
        modrinth: result.provider === "modrinth" ? result.hit : undefined,
        curseforge: result.provider === "curseforge" ? result.hit : undefined,
      };
      rows.push(row);
      if (key) byKey.set(key, row);
    }

    return rows;
  }, [unifiedResults]);

  const selectedModrinth = useMemo(
    () => selectedProvider === "modrinth" ? modrinthHits.find((hit) => hit.project_id === selectedProjectId) ?? null : null,
    [modrinthHits, selectedProjectId, selectedProvider],
  );
  const selectedCurse = useMemo(
    () => selectedProvider === "curseforge" ? curseHits.find((hit) => hit.id === selectedCurseModId) ?? null : null,
    [curseHits, selectedCurseModId, selectedProvider],
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

  const runSearch = async (overrides?: {
    provider?: Provider;
    category?: ContentCategory;
    searchQuery?: string;
    compatible?: boolean;
    versionFilter?: boolean;
    sort?: SortMode;
  }) => {
    const activeProvider = overrides?.provider ?? provider;
    const activeCategory = overrides?.category ?? category;
    const searchQuery = overrides?.searchQuery ?? query.trim();
    const activeCompatible = overrides?.compatible ?? compatibleOnly;
    const activeVersionFilter = overrides?.versionFilter ?? filterVersion;
    const activeSort = overrides?.sort ?? sortMode;
    const requestId = ++requestIdRef.current;
    fileRequestIdRef.current += 1;
    modrinthVersions.reset();
    curseFiles.reset();
    setLoadedFilesTarget(null);
    setSelectedProjectId(null);
    setSelectedCurseModId(null);
    setSelectedProvider(null);
    setSearchContext(null);
    setModrinthResults([]);
    setCurseResults([]);
    setNextIndex({ modrinth: 0, curseforge: 0 });
    setHasMoreByProvider({ modrinth: false, curseforge: false });
    setModrinthTotal(0);

    const modrinthRequest: Promise<ModrinthSearchResponse | null> =
      activeProvider === "all" || activeProvider === "modrinth"
        ? modrinthSearch.mutateAsync({
          instanceId: instance.id,
          query: searchQuery,
          projectType: activeCategory.modrinthType,
          limit: SEARCH_PAGE_SIZE,
          offset: 0,
          compatibleOnly: activeCompatible,
          filterVersion: activeVersionFilter,
          sort: activeSort,
        })
        : Promise.resolve(null);
    const curseRequest: Promise<CurseForgeSearchResponse | null> =
      activeProvider === "all" || activeProvider === "curseforge"
        ? curseSearch.mutateAsync({
          instanceId: instance.id,
          query: searchQuery,
          classId: activeCategory.curseClassId,
          pageSize: SEARCH_PAGE_SIZE,
          index: 0,
          compatibleOnly: activeCompatible,
          contentType: activeCategory.id,
          filterVersion: activeVersionFilter,
          sort: activeSort,
        })
        : Promise.resolve(null);

    const [modrinthOutcome, curseOutcome] = await Promise.allSettled([modrinthRequest, curseRequest]);
    if (requestId !== requestIdRef.current) return;

    const modrinthResult = modrinthOutcome.status === "fulfilled" ? modrinthOutcome.value : null;
    const curseResult = curseOutcome.status === "fulfilled" ? curseOutcome.value : null;

    const nextModrinth = modrinthResult?.hits ?? [];
    const nextCurse = curseResult?.data ?? [];
    setModrinthResults(nextModrinth);
    setCurseResults(nextCurse);
    setModrinthTotal(modrinthResult?.total_hits ?? 0);
    setSearchContext({
      provider: activeProvider,
      categoryId: activeCategory.id,
      query: searchQuery,
      compatibleOnly: activeCompatible,
      filterVersion: activeVersionFilter,
      sort: activeSort,
    });
    setNextIndex({ modrinth: nextModrinth.length, curseforge: nextCurse.length });
    setHasMoreByProvider({
      modrinth: !!modrinthResult && nextModrinth.length < modrinthResult.total_hits,
      curseforge: nextCurse.length >= SEARCH_PAGE_SIZE,
    });

    const candidates: UnifiedResult[] = [
      ...nextModrinth.map((hit, rank) => ({ provider: "modrinth" as const, rank, hit })),
      ...nextCurse.map((hit, rank) => ({ provider: "curseforge" as const, rank, hit })),
    ];
    const first = orderUnifiedResults(candidates, activeProvider, activeSort)[0];
    if (first?.provider === "modrinth") {
      setSelectedProvider("modrinth");
      setSelectedProjectId(first.hit.project_id);
    } else if (first?.provider === "curseforge") {
      setSelectedProvider("curseforge");
      setSelectedCurseModId(first.hit.id);
    }
  };

  // Appends the next page, keeping what is already on screen.
  const loadMore = async () => {
    if (loadingMore || !hasMore || !searchContext) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const searches: Promise<void>[] = [];
      if (
        (searchContext.provider === "all" || searchContext.provider === "modrinth") &&
        hasMoreByProvider.modrinth
      ) {
        searches.push(
          modrinthSearch.mutateAsync({
            instanceId: instance.id,
            query: searchContext.query,
            projectType: category.modrinthType,
            limit: SEARCH_PAGE_SIZE,
            offset: nextIndex.modrinth,
            compatibleOnly: searchContext.compatibleOnly,
            filterVersion: searchContext.filterVersion,
            sort: searchContext.sort,
          }).then((result) => {
            if (requestId !== requestIdRef.current) return;
            const fresh = result.hits.filter(
              (hit) => !modrinthResults.some((existing) => existing.project_id === hit.project_id),
            );
            setModrinthResults((current) => [...current, ...fresh]);
            setNextIndex((current) => ({ ...current, modrinth: current.modrinth + result.hits.length }));
            setHasMoreByProvider((current) => ({
              ...current,
              modrinth: nextIndex.modrinth + result.hits.length < result.total_hits,
            }));
            setModrinthTotal(result.total_hits);
          }),
        );
      }
      if (
        (searchContext.provider === "all" || searchContext.provider === "curseforge") &&
        hasMoreByProvider.curseforge
      ) {
        searches.push(
          curseSearch.mutateAsync({
            instanceId: instance.id,
            query: searchContext.query,
            classId: category.curseClassId,
            pageSize: SEARCH_PAGE_SIZE,
            index: nextIndex.curseforge,
            compatibleOnly: searchContext.compatibleOnly,
            contentType: category.id,
            filterVersion: searchContext.filterVersion,
            sort: searchContext.sort,
          }).then((result) => {
            if (requestId !== requestIdRef.current) return;
            const fresh = result.data.filter(
              (hit) => !curseResults.some((existing) => existing.id === hit.id),
            );
            setCurseResults((current) => [...current, ...fresh]);
            setNextIndex((current) => ({ ...current, curseforge: current.curseforge + result.data.length }));
            setHasMoreByProvider((current) => ({
              ...current,
              curseforge: result.data.length >= SEARCH_PAGE_SIZE,
            }));
          }),
        );
      }
      await Promise.allSettled(searches);
    } finally {
      setLoadingMore(false);
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
    if (selectedProvider === "modrinth" && projectId === selectedProjectId) return;
    fileRequestIdRef.current += 1;
    modrinthVersions.reset();
    curseFiles.reset();
    setLoadedFilesTarget(null);
    setSelectedProvider("modrinth");
    setSelectedProjectId(projectId);
    setSelectedCurseModId(null);
  };

  const selectCurseProject = (modId: number) => {
    if (selectedProvider === "curseforge" && modId === selectedCurseModId) return;
    fileRequestIdRef.current += 1;
    modrinthVersions.reset();
    curseFiles.reset();
    setLoadedFilesTarget(null);
    setSelectedProvider("curseforge");
    setSelectedProjectId(null);
    setSelectedCurseModId(modId);
  };

  // The reference flow opens on a ready-to-install recommendation. Load the
  // selected project's versions immediately instead of asking for an extra
  // "load files" click first.
  useEffect(() => {
    if (selectedProvider === "modrinth" && selectedProjectId && !hasLoadedCurrentModrinthFiles) {
      void loadModrinthFiles(selectedProjectId);
    } else if (selectedProvider === "curseforge" && selectedCurseModId && !hasLoadedCurrentCurseFiles) {
      void loadCurseFiles(selectedCurseModId);
    }
    // Only a new selection starts an automatic load. A failed request remains
    // available through the manual retry button in the detail panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category.id, selectedCurseModId, selectedProjectId, selectedProvider]);

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

  /**
   * The selected result, flattened so the detail panel never has to know which
   * platform it came from.
   *
   * Both providers describe the same things under different names; doing the
   * translation once here is what lets one panel serve both.
   */
  const selected = useMemo(() => {
    const numberLabel = (value: number | null | undefined) =>
      value == null ? null : compactCount(value);
    const dateLabel = (value: string | null | undefined) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : formatDate(date, regionFormats);
    };

    if (selectedModrinth) {
      const installedMod =
        category.installMode === "mod" ? findInstalledMod(selectedModrinth.title) : null;
      const installedShader =
        category.installMode === "shader" ? findInstalledShader(selectedModrinth.title) : null;
      const installedPack =
        category.installMode === "pack" ? findInstalledContent(selectedModrinth.title) : null;

      return {
        detail: {
          projectId: selectedModrinth.project_id,
          title: selectedModrinth.title,
          author: selectedModrinth.author,
          description: selectedModrinth.description,
          iconUrl: selectedModrinth.icon_url ?? null,
          provider: "modrinth" as const,
          downloadsLabel: numberLabel(selectedModrinth.downloads),
          updatedLabel: dateLabel(selectedModrinth.date_modified),
          // Modrinth's search payload carries no licence field.
          licenseLabel: null,
          compatible: compatChecked
            ? modrinthCompat(selectedModrinth, mcVersion, compatLoader) === "compatible"
            : null,
        },
        versions: compatibleModrinthVersions.slice(0, 30).map((version) => {
          const installable = version.files.filter((file) =>
            isInstallableFileName(file.filename, category),
          );
          const primary = installable.find((file) => file.primary) ?? installable[0];
          return {
            id: version.id,
            name: primary?.filename ?? version.version_number,
            subtitle: [version.loaders.join(", "), version.game_versions.slice(0, 4).join(", ")]
              .filter(Boolean)
              .join(" • "),
            sizeLabel: primary?.size ? formatBytes(primary.size, 1) : undefined,
          };
        }),
        versionsLoaded: hasLoadedCurrentModrinthFiles,
        loadVersions: (): void => void loadModrinthFiles(selectedModrinth.project_id),
        installedLabel: installedMod?.name ?? installedShader ?? installedPack ?? null,
        uninstall: installedMod
          ? () => deleteMod.mutate({ instanceId: instance.id, modId: installedMod.id })
          : installedShader
            ? () => deleteShader.mutate({ instanceId: instance.id, fileName: installedShader })
            : installedPack
              ? () =>
                  deleteContent.mutate({
                    instanceId: instance.id,
                    contentType: category.id as MinecraftContentType,
                    fileName: installedPack,
                    worldName: category.id === "datapack" ? selectedWorld : null,
                  })
              : undefined,
        install: (versionId: string) => {
          if (category.installMode === "mod") {
            void prepareInstall({
              instanceId: instance.id,
              source: "modrinth",
              projectId: selectedModrinth.project_id,
              versionId,
              author: selectedModrinth.author,
            });
            return;
          }
          if (category.installMode === "shader") {
            setInstallingShaderId(versionId);
            installModrinthContent.mutate(
              {
                instanceId: instance.id,
                contentType: "shader",
                projectId: selectedModrinth.project_id,
                versionId,
                displayName: selectedModrinth.title,
              },
              { onSettled: () => setInstallingShaderId(null) },
            );
            return;
          }
          void installModrinthPack(selectedModrinth.project_id, versionId, selectedModrinth.title);
        },
        downloadOnly: (versionId: string): void => {
          void downloadOnly("modrinth", selectedModrinth.project_id, versionId);
        },
      };
    }

    if (selectedCurse) {
      const authors = selectedCurse.authors?.map((author) => author.name).join(", ") ?? "";
      const installedMod =
        category.installMode === "mod" ? findInstalledMod(selectedCurse.name) : null;
      const installedShader =
        category.installMode === "shader" ? findInstalledShader(selectedCurse.name) : null;
      const installedPack =
        category.installMode === "pack" ? findInstalledContent(selectedCurse.name) : null;

      return {
        detail: {
          projectId: selectedCurse.id.toString(),
          title: selectedCurse.name,
          author: authors || t("Unknown author"),
          description: selectedCurse.summary ?? "",
          iconUrl: selectedCurse.logo?.thumbnail_url ?? null,
          provider: "curseforge" as const,
          downloadsLabel: numberLabel(selectedCurse.download_count),
          updatedLabel: dateLabel(selectedCurse.date_modified),
          // CurseForge does not publish a licence on the project payload.
          licenseLabel: null,
          compatible: compatChecked
            ? curseforgeCompat(selectedCurse, mcVersion, compatLoader) === "compatible"
            : null,
        },
        versions: visibleCurseFiles.slice(0, 30).map((file) => ({
          id: file.id.toString(),
          name: file.file_name,
          subtitle: file.game_versions.slice(0, 4).join(", "),
          sizeLabel: file.file_length ? formatBytes(file.file_length, 1) : undefined,
        })),
        versionsLoaded: hasLoadedCurrentCurseFiles,
        loadVersions: (): void => void loadCurseFiles(selectedCurse.id),
        installedLabel: installedMod?.name ?? installedShader ?? installedPack ?? null,
        uninstall: installedMod
          ? () => deleteMod.mutate({ instanceId: instance.id, modId: installedMod.id })
          : installedShader
            ? () => deleteShader.mutate({ instanceId: instance.id, fileName: installedShader })
            : installedPack
              ? () =>
                  deleteContent.mutate({
                    instanceId: instance.id,
                    contentType: category.id as MinecraftContentType,
                    fileName: installedPack,
                    worldName: category.id === "datapack" ? selectedWorld : null,
                  })
              : undefined,
        install: (versionId: string) => {
          const fileId = Number(versionId);
          if (category.installMode === "mod") {
            void prepareInstall({
              instanceId: instance.id,
              source: "curseforge",
              projectId: selectedCurse.id.toString(),
              fileId,
              author: authors || null,
            });
            return;
          }
          void installCurseForgePack(selectedCurse.id, fileId, selectedCurse.name);
        },
        downloadOnly: (versionId: string): void => {
          void downloadOnly("curseforge", selectedCurse.id.toString(), versionId);
        },
      };
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedModrinth,
    selectedCurse,
    category,
    compatibleModrinthVersions,
    visibleCurseFiles,
    hasLoadedCurrentModrinthFiles,
    hasLoadedCurrentCurseFiles,
    installedMods,
    installedShaders,
    installedContent.data,
    selectedWorld,
    compatChecked,
    compatLoader,
    mcVersion,
  ]);

  /**
   * The catalogues carrying the selected project, and how to switch between
   * them.
   *
   * The same mod is often on both, and the two listings are not identical: one
   * may publish a build the other has not. Keeping the switch means the merged
   * row never hides that choice.
   */
  const selectedRow = useMemo(
    () =>
      mergedResults.find(
        (row) =>
          (!!row.modrinth &&
            selectedProvider === "modrinth" &&
            row.modrinth.project_id === selectedProjectId) ||
          (!!row.curseforge &&
            selectedProvider === "curseforge" &&
            row.curseforge.id === selectedCurseModId),
      ) ?? null,
    [mergedResults, selectedProvider, selectedProjectId, selectedCurseModId],
  );

  const selectedSources = useMemo<SourceProvider[]>(() => {
    if (!selectedRow) return [];
    const sources: SourceProvider[] = [];
    if (selectedRow.modrinth) sources.push("modrinth");
    if (selectedRow.curseforge) sources.push("curseforge");
    return sources;
  }, [selectedRow]);

  const switchSource = (source: SourceProvider) => {
    if (!selectedRow) return;
    if (source === "modrinth" && selectedRow.modrinth) {
      selectModrinthProject(selectedRow.modrinth.project_id);
    }
    if (source === "curseforge" && selectedRow.curseforge) {
      selectCurseProject(selectedRow.curseforge.id);
    }
  };

  const installingVersionId =
    installingShaderId ??
    (installingContentKey ? installingContentKey.split(":")[1] ?? null : null) ??
    (resolveDependencies.isPending || installDependencies.isPending
      ? (installRequest?.versionId ?? installRequest?.fileId?.toString() ?? null)
      : null);

  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null);
  const downloadContentFile = useDownloadContentFile();

  /**
   * Saves a release somewhere the user chose, without touching the instance.
   *
   * Nothing is recorded about it: the file is leaving Kiza's care, so claiming
   * to know where it came from later would be wrong.
   */
  const downloadOnly = async (
    provider: Provider,
    projectId: string,
    versionId: string,
    suggestedName?: string,
  ) => {
    const destination = await saveFileDialog({
      title: t("Save the file"),
      defaultPath: suggestedName,
    });
    if (!destination) return;
    setDownloadingVersionId(versionId);
    downloadContentFile.mutate(
      { provider, projectId, versionId, destination },
      { onSettled: () => setDownloadingVersionId(null) },
    );
  };

  const hasRequiredWorld = category.id !== "datapack" || !!selectedWorld;

  if (instance.game_id !== "minecraft") {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        {t("Discover is only available for Minecraft.")}
      </div>
    );
  }

  const filterCount = Number(filterVersion && !!mcVersion) + Number(compatibleOnly && !!loader);
  const sortLabels: Record<SortMode, string> = {
    relevance: t("Relevance"),
    downloads: t("Downloads"),
    updated: t("Recently updated"),
  };
  const resultCount = provider === "modrinth" ? modrinthTotal : mergedResults.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/50 px-6 pb-3 pt-5 lg:px-8">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight">
              {t("Discover {category}").replace("{category}", t(category.label).toLowerCase())}
            </h2>
            {/* The instance is named here because every result below is judged
                against it, and a compatibility badge means nothing without
                saying compatible with what. */}
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {t("Compatible with")} {instance.display_name}
              {mcVersion && ` • Minecraft ${mcVersion}`}
              {loader && ` • ${loader}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab("mods")}
            className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary transition-[color,opacity] duration-150 hover:underline active:opacity-70"
          >
            {t("See what is installed")}
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid items-center gap-4 xl:grid-cols-[minmax(260px,1fr)_350px_236px_68px]">
          <div className="relative min-w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
              placeholder={t("Search {category}...").replace("{category}", t(category.label).toLowerCase())}
              className="h-12 w-full rounded-lg border border-border/80 bg-secondary/20 pl-11 pr-10 text-sm outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted-foreground/80 hover:bg-secondary/25 focus:border-primary/60 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  void runSearch({ searchQuery: "" });
                }}
                aria-label={t("Clear the search")}
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,scale] duration-150 hover:bg-secondary/60 hover:text-foreground active:scale-[0.96]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="grid h-12 grid-cols-3 rounded-lg bg-secondary/20 p-1 shadow-[0_0_0_1px_hsl(var(--border)/0.9)]">
            {(
              [
                ["all", t("All catalogues")],
                ["modrinth", "Modrinth"],
                ["curseforge", "CurseForge"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => selectProvider(value)}
                className={cn(
                  "min-w-0 rounded-md px-3 text-sm font-medium transition-[background-color,color,box-shadow,scale] duration-150 active:scale-[0.96]",
                  provider === value
                    ? "bg-primary/[0.08] text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setSortOpen((open) => !open);
                setFiltersOpen(false);
              }}
              aria-expanded={sortOpen}
              className="flex h-12 w-full items-center justify-between rounded-lg bg-secondary/20 px-4 text-sm font-medium text-foreground shadow-[0_0_0_1px_hsl(var(--border)/0.9)] transition-[background-color,box-shadow,scale] duration-150 hover:bg-secondary/35 active:scale-[0.96]"
            >
              {sortLabels[sortMode]}
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-150", sortOpen && "rotate-180")} />
            </button>
            {sortOpen && (
              <div className="absolute right-0 z-30 mt-2 w-full min-w-52 overflow-hidden rounded-lg bg-popover p-1.5 shadow-[0_0_0_1px_hsl(var(--border)),0_16px_40px_hsl(242_30%_2%/0.55)]">
                {(["relevance", "downloads", "updated"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setSortMode(value);
                      setSortOpen(false);
                      void runSearch({ sort: value });
                    }}
                    className={cn(
                      "flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm transition-[background-color,color] duration-150",
                      sortMode === value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )}
                  >
                    {sortLabels[value]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setFiltersOpen((open) => !open);
                setSortOpen(false);
              }}
              aria-label={t("Active filters")}
              aria-expanded={filtersOpen}
              className="relative flex h-12 w-full items-center justify-center rounded-lg bg-secondary/20 text-muted-foreground shadow-[0_0_0_1px_hsl(var(--border)/0.9)] transition-[background-color,color,box-shadow,scale] duration-150 hover:bg-secondary/35 hover:text-foreground active:scale-[0.96]"
            >
              <SlidersHorizontal className="h-5 w-5" />
              {filterCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums text-primary-foreground shadow-[0_0_0_2px_hsl(var(--background))]">
                  {filterCount}
                </span>
              )}
            </button>
            {filtersOpen && (
              <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg bg-popover p-4 shadow-[0_0_0_1px_hsl(var(--border)),0_16px_40px_hsl(242_30%_2%/0.55)]">
                <div className="mb-3 text-sm font-semibold">{t("Active filters")}</div>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <Checkbox
                    checked={filterVersion}
                    disabled={isSearching || !mcVersion}
                    onChange={() => {
                      const next = !filterVersion;
                      setFilterVersion(next);
                      void runSearch({ versionFilter: next });
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{t("Exact Minecraft version")}</span>
                    <span className="block truncate text-xs text-muted-foreground">Minecraft {mcVersion}</span>
                  </span>
                </label>
                {compatChecked && (
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <Checkbox
                      checked={compatibleOnly}
                      disabled={isSearching}
                      onChange={() => {
                        const next = !compatibleOnly;
                        setCompatibleOnly(next);
                        void runSearch({ compatible: next });
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{t("Mod loader")}</span>
                      <span className="block truncate text-xs capitalize text-muted-foreground">{loader}</span>
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>

          {category.id === "datapack" && (
            <div className="w-56">
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

        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {filterVersion && mcVersion && (
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary/10 pl-3 pr-1 text-xs font-medium text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]">
              Minecraft {mcVersion}
              <button
                type="button"
                onClick={() => {
                  setFilterVersion(false);
                  void runSearch({ versionFilter: false });
                }}
                aria-label={t("Remove Minecraft version filter")}
                className="flex h-8 w-8 items-center justify-center rounded-md transition-[background-color,scale] duration-150 hover:bg-primary/10 active:scale-[0.96]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {compatibleOnly && loader && (
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary/10 pl-3 pr-1 text-xs font-medium capitalize text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]">
              {loader}
              <button
                type="button"
                onClick={() => {
                  setCompatibleOnly(false);
                  void runSearch({ compatible: false });
                }}
                aria-label={t("Remove mod loader filter")}
                className="flex h-8 w-8 items-center justify-center rounded-md transition-[background-color,scale] duration-150 hover:bg-primary/10 active:scale-[0.96]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {isPopularCatalog && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-secondary/30 px-2.5 py-1 text-xs text-muted-foreground">
              {t("Most popular")}
            </span>
          )}

          {compatChecked && (
            <label className="ml-2 inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={compatibleOnly}
                disabled={isSearching}
                onChange={() => {
                  const next = !compatibleOnly;
                  setCompatibleOnly(next);
                  void runSearch({ compatible: next });
                }}
              />
              {t("Only show compatible versions")}
            </label>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(500px,0.94fr)_minmax(520px,1.06fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden border-r border-border/50">
          {hasSearched && (
            <div className="ml-3.5 flex min-h-[84px] shrink-0 flex-col justify-center rounded-tl-xl border-b border-l border-t border-border/50 px-6">
              <span className="text-base font-semibold">{t("Results")}</span>
              <span className="mt-1 text-sm tabular-nums text-muted-foreground">
                {resultCount} {t(category.label).toLowerCase()}
              </span>
            </div>
          )}
          <div
            className="ml-3.5 flex min-h-0 flex-1 flex-col divide-y divide-border/50 overflow-y-auto border-l border-border/50"
            onScroll={(event) => {
              const viewport = event.currentTarget;
              if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 180) {
                void loadMore();
              }
            }}
          >
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
          {hasSearched && provider === "modrinth" && mergedResults.length === 0 && (
            <EmptyState title={t("No Modrinth results")} description={t("Try a shorter name or check the Minecraft version.")} />
          )}
          {hasSearched && provider === "curseforge" && mergedResults.length === 0 && (
            <EmptyState title={t("No CurseForge results")} description={t("Try another term or check the CurseForge API connection.")} />
          )}
          {hasSearched && provider === "all" && mergedResults.length === 0 && (
            <EmptyState title={t("No results")} description={t("Try another term or relax the active filters.")} />
          )}

          {showOptiFine && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 shrink-0 text-primary" />
                <div className="text-sm font-semibold">OptiFine</div>
                <Badge className="h-5 px-1.5 py-0 text-[10px] border-primary/30 bg-primary/10 text-primary">
                  {t("Powered by OptiFine.net")}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("OptiFine is not on Modrinth or CurseForge. Builds are downloaded straight from the official site.")}
              </p>

              {optifineReleases.isLoading && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  {t("Loading builds...")}
                </div>
              )}
              {optifineReleases.error && (
                <p className="mt-2 text-xs text-destructive">
                  {t("Could not reach optifine.net. Download it manually and use Add Mod.")}
                </p>
              )}
              {optifineReleases.data?.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("No OptiFine build for this Minecraft version.")}
                </p>
              )}

              <div className="mt-2 space-y-1.5">
                {(optifineReleases.data ?? []).map((release) => (
                  <div
                    key={release.file_name}
                    className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-2.5 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{release.display_name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        MC {release.mc_version}
                      </span>
                    </span>
                    {release.preview && (
                      <Badge className="h-5 shrink-0 border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-300">
                        {t("Preview")}
                      </Badge>
                    )}
                    <Button
                      variant="primary"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={installOptiFine.isPending}
                      onClick={() =>
                        installOptiFine.mutate({
                          instanceId: instance.id,
                          fileName: release.file_name,
                        })
                      }
                    >
                      {installOptiFine.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                      {t("Install")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mergedResults.map((row) => {
            const sources: SourceProvider[] = [];
            if (row.modrinth) sources.push("modrinth");
            if (row.curseforge) sources.push("curseforge");

            // Display comes from the catalogue that ranked it first; the other
            // one is still selectable from the detail panel.
            const showModrinth = row.primary === "modrinth" && row.modrinth;
            const modrinthHit = row.modrinth;
            const curseHit = row.curseforge;

            const selectedHere =
              (!!modrinthHit &&
                selectedProvider === "modrinth" &&
                selectedProjectId === modrinthHit.project_id) ||
              (!!curseHit &&
                selectedProvider === "curseforge" &&
                selectedCurseModId === curseHit.id);

            const open = () => {
              if (showModrinth && modrinthHit) selectModrinthProject(modrinthHit.project_id);
              else if (curseHit) selectCurseProject(curseHit.id);
              else if (modrinthHit) selectModrinthProject(modrinthHit.project_id);
            };

            return (
              <ResultCard
                key={row.key}
                selected={selectedHere}
                onClick={open}
                iconUrl={
                  showModrinth && modrinthHit
                    ? modrinthHit.icon_url
                    : curseHit?.logo?.thumbnail_url ?? modrinthHit?.icon_url ?? null
                }
                title={
                  showModrinth && modrinthHit ? modrinthHit.title : curseHit?.name ?? modrinthHit?.title ?? ""
                }
                author={
                  showModrinth && modrinthHit
                    ? modrinthHit.author
                    : curseHit?.authors?.map((author) => author.name).join(", ") ||
                      modrinthHit?.author ||
                      t("Unknown author")
                }
                summary={
                  showModrinth && modrinthHit
                    ? modrinthHit.description
                    : curseHit?.summary ?? modrinthHit?.description ?? ""
                }
                providers={sources}
                downloads={
                  // The larger of the two: the same mod counted twice would be
                  // a made-up number, and the smaller one understates it.
                  Math.max(modrinthHit?.downloads ?? 0, curseHit?.download_count ?? 0)
                }
                compat={
                  showModrinth && modrinthHit
                    ? modrinthCompat(modrinthHit, mcVersion, category.id === "mod" ? loader : null)
                    : curseHit
                      ? curseforgeCompat(curseHit, mcVersion, category.id === "mod" ? loader : null)
                      : "unknown"
                }
              />
            );
          })}

          {hasSearched && loadingMore && (
            <div className="flex min-h-12 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              {t("Loading more...")}
            </div>
          )}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto pb-1.5 pl-3 pr-5">
          {selected ? (
            <ContentDetailPanel
              detail={selected.detail}
              instanceName={instance.display_name}
              availableSources={selectedSources}
              onSelectSource={switchSource}
              versions={selected.versions}
              versionsLoaded={selected.versionsLoaded}
              versionsLoading={modrinthVersions.isPending || curseFiles.isPending}
              onLoadVersions={selected.loadVersions}
              installedLabel={selected.installedLabel}
              onUninstall={selected.uninstall}
              uninstalling={
                deleteMod.isPending || deleteShader.isPending || deleteContent.isPending
              }
              onInstall={selected.install}
              installingVersionId={installingVersionId}
              onDownloadOnly={selected.downloadOnly}
              downloadingVersionId={downloadingVersionId}
              supportsDependencies={category.installMode === "mod"}
              blockedReason={
                <NonModInstallHint
                  category={category}
                  loader={loader}
                  hasWorld={hasRequiredWorld}
                />
              }
            />
          ) : (
            <EmptyState
              title={t("Select an item")}
              description={t("Its details and installable versions appear here.")}
            />
          )}
        </div>
      </div>

      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border/50 px-5 text-xs text-muted-foreground sm:px-6">
        <LinkIcon className="h-3.5 w-3.5" />
        {t("Connected sources: Modrinth and CurseForge")}
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
