import { useMemo, useState } from "react";
import { GameInstanceSummary } from "../../../lib/types";
import {
  useCurseForgeFiles,
  useCurseForgeSearch,
  useInstallModWithDependencies,
  useModrinthSearch,
  useResolveModDependencies,
} from "../../../lib/queries";
import type {
  DependencyInstallResult,
  DependencyResolution,
  ResolveDependenciesRequest,
} from "../../../lib/queries";
import { Download, Loader2, Search } from "lucide-react";
import { cn } from "../../../lib/utils";
import { Badge, Button, EmptyState, Input, Panel } from "../../ui/primitives";
import { DependencyInstallDialog } from "./DependencyInstallDialog";

type Provider = "modrinth" | "curseforge";

export function DiscoverTab({ instance }: { instance: GameInstanceSummary }) {
  const [provider, setProvider] = useState<Provider>("modrinth");
  const [query, setQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedCurseModId, setSelectedCurseModId] = useState<number | null>(null);
  const [installRequest, setInstallRequest] = useState<ResolveDependenciesRequest | null>(null);
  const [dependencyPlan, setDependencyPlan] = useState<DependencyResolution | null>(null);
  const [installResult, setInstallResult] = useState<DependencyInstallResult | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);

  const mcVersion = instance.minecraft?.mc_version ?? null;
  const loader = instance.minecraft?.loader ?? null;

  const modrinthSearch = useModrinthSearch();
  const curseSearch = useCurseForgeSearch();
  const curseFiles = useCurseForgeFiles();
  const resolveDependencies = useResolveModDependencies();
  const installDependencies = useInstallModWithDependencies();

  const modrinthHits = modrinthSearch.data?.hits ?? [];
  const curseHits = curseSearch.data?.data ?? [];
  const isSearching = modrinthSearch.isPending || curseSearch.isPending;
  const hasSearched = provider === "modrinth" ? !!modrinthSearch.data : !!curseSearch.data;

  const selectedModrinth = useMemo(
    () => modrinthHits.find((hit) => hit.project_id === selectedProjectId) ?? null,
    [modrinthHits, selectedProjectId],
  );
  const selectedCurse = useMemo(
    () => curseHits.find((hit) => hit.id === selectedCurseModId) ?? null,
    [curseHits, selectedCurseModId],
  );

  const runSearch = async () => {
    setSelectedProjectId(null);
    setSelectedCurseModId(null);
    if (!query.trim()) return;

    if (provider === "modrinth") {
      await modrinthSearch.mutateAsync({ query, mcVersion, loader, limit: 20, offset: 0 });
    } else {
      await curseSearch.mutateAsync({ query, mcVersion, loader, pageSize: 20, index: 0 });
    }
  };

  const loadCurseFiles = async (modId: number) => {
    await curseFiles.mutateAsync({ modId, mcVersion, loader, pageSize: 50, index: 0 });
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

  if (instance.game_id !== "minecraft") {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Discover is only available for Minecraft.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/50 bg-card/30 p-4 sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-lg font-semibold">Discover Mods</div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge className="h-6 px-2 py-0 text-[11px]">{mcVersion ? `Minecraft ${mcVersion}` : "Minecraft"}</Badge>
              {loader && <Badge className="h-6 px-2 py-0 text-[11px]">{loader}</Badge>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => setProvider("modrinth")} variant={provider === "modrinth" ? "primary" : "secondary"} className="h-9">
              Modrinth
            </Button>
            <Button onClick={() => setProvider("curseforge")} variant={provider === "curseforge" ? "primary" : "secondary"} className="h-9">
              CurseForge
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
              placeholder="Rechercher un mod..."
              className="pl-9"
            />
          </div>
          <Button onClick={runSearch} disabled={isSearching} variant="primary">
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Rechercher
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-h-0 space-y-2 overflow-y-auto border-r border-border/50 p-4">
          {!hasSearched && (
            <EmptyState
              title="Recherche un mod"
              description="Modrinth works without a key. CurseForge uses the bundled key or the one stored in System & APIs."
            />
          )}
          {hasSearched && provider === "modrinth" && modrinthHits.length === 0 && (
            <EmptyState title="No Modrinth results" description="Try a shorter name or check the Minecraft version." />
          )}
          {hasSearched && provider === "curseforge" && curseHits.length === 0 && (
            <EmptyState title="No CurseForge results" description="Try another term or check the CurseForge API connection." />
          )}

          {provider === "modrinth" &&
            modrinthHits.map((hit) => (
              <button
                key={hit.project_id}
                onClick={() => setSelectedProjectId(hit.project_id)}
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
                    <div className="truncate text-sm font-medium">{hit.title}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{hit.description}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{hit.author} - {hit.downloads.toLocaleString()} downloads</div>
                  </div>
                </div>
              </button>
            ))}

          {provider === "curseforge" &&
            curseHits.map((hit) => (
              <button
                key={hit.id}
                onClick={() => setSelectedCurseModId(hit.id)}
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
                    <div className="truncate text-sm font-medium">{hit.name}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{hit.summary ?? ""}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{Math.round(hit.download_count ?? 0).toLocaleString()} downloads</div>
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
                      <div className="mt-1 text-sm text-muted-foreground">{selectedModrinth.description}</div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge>{selectedModrinth.downloads.toLocaleString()} downloads</Badge>
                        <Badge>{selectedModrinth.versions.slice(-3).join(", ")}</Badge>
                      </div>
                    </div>
                  </Panel>

                  <Button
                    onClick={() => prepareInstall({
                      instanceId: instance.id,
                      source: "modrinth",
                      projectId: selectedModrinth.project_id,
                    })}
                    disabled={resolveDependencies.isPending || installDependencies.isPending}
                    variant="primary"
                  >
                    {resolveDependencies.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Review install
                  </Button>
                </>
              ) : (
                <EmptyState title="Select a mod" description="The detail panel will show the cover, compatible versions and the install action." />
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
                        <div className="mt-1 text-sm text-muted-foreground">{selectedCurse.summary ?? ""}</div>
                        <div className="mt-2 text-xs text-muted-foreground">{Math.round(selectedCurse.download_count ?? 0).toLocaleString()} downloads</div>
                      </div>
                    </div>
                    <Button onClick={() => loadCurseFiles(selectedCurse.id)} disabled={curseFiles.isPending} className="h-9 shrink-0">
                      {curseFiles.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Load files
                    </Button>
                  </Panel>

                  {curseFiles.data?.data?.length ? (
                    <div className="space-y-2">
                      {curseFiles.data.data.slice(0, 20).map((file) => (
                        <div key={file.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/20 p-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{file.file_name}</div>
                            <div className="truncate text-xs text-muted-foreground">{file.game_versions.slice(0, 5).join(", ")}</div>
                          </div>
                          <Button
                            onClick={() => prepareInstall({
                              instanceId: instance.id,
                              source: "curseforge",
                              projectId: selectedCurse.id.toString(),
                              fileId: file.id,
                            })}
                            disabled={resolveDependencies.isPending || installDependencies.isPending}
                            variant="primary"
                            className="h-9 shrink-0"
                          >
                            {resolveDependencies.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            Review
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Load the file list to see the builds compatible with this instance.
                    </div>
                  )}
                </>
              ) : (
                <EmptyState title="Select a mod" description="The CurseForge card and its compatible files will be shown here." />
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
