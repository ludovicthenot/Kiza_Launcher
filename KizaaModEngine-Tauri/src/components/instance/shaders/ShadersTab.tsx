import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Loader2, Search, Sparkles, Trash2, Upload } from "lucide-react";
import { GameInstanceSummary } from "../../../lib/types";
import {
  useDeleteShaderpack,
  useImportShaderpack,
  useInstallShaderpack,
  useOpenShaderpacksFolder,
  useShaderpacks,
  useShaderSearch,
} from "../../../lib/queries";
import { Button, EmptyState, Input, Panel } from "../../ui/primitives";
import { ConfirmActionDialog } from "../../ui/confirm-action-dialog";
import { formatBytes } from "../../../lib/utils";
import { findInstalledByTitle } from "../../../lib/installedMatch";

interface ShadersTabProps {
  instance: GameInstanceSummary;
  mode?: "all" | "installed";
}

export function ShadersTab({ instance, mode = "all" }: ShadersTabProps) {
  const instanceId = instance.id;
  const mcVersion = instance.minecraft?.mc_version ?? null;
  const loader = instance.minecraft?.loader ?? "vanilla";
  const loaderVersion = instance.minecraft?.loader_version ?? null;
  // Fabric drives shaders through Iris, Forge through OptiFine; only Vanilla
  // has no shader engine at all.
  const usesIris = loader !== "vanilla";
  const loaderLabel = loader === "forge" ? "Forge" : loader === "fabric" ? "Fabric" : "Vanilla";
  const instanceTarget = [
    mcVersion ? `Minecraft ${mcVersion}` : null,
    `${loaderLabel}${loaderVersion ? ` ${loaderVersion}` : ""}`,
  ]
    .filter(Boolean)
    .join(" with ");

  const { data: packs, isLoading } = useShaderpacks(instanceId);
  const installedNames = packs?.map((pack) => pack.file_name) ?? [];
  const deletePack = useDeleteShaderpack();
  const importPack = useImportShaderpack();
  const openFolder = useOpenShaderpacksFolder();
  const shaderSearch = useShaderSearch();
  const installShader = useInstallShaderpack();

  const [query, setQuery] = useState("");
  const [packToDelete, setPackToDelete] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const runSearch = () => {
    if (!usesIris || !query.trim()) return;
    shaderSearch.mutate({ instanceId, query: query.trim() });
  };

  const handleImport = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Shader pack", extensions: ["zip"] }],
      title: "Select a shader pack (.zip)",
    });
    if (selected && typeof selected === "string") {
      importPack.mutate({ instanceId, sourcePath: selected });
    }
  };

  return (
    <div className="flex-1 min-h-0 space-y-5 overflow-y-auto p-6">
      <ConfirmActionDialog
        open={!!packToDelete}
        onOpenChange={(openState) => !openState && setPackToDelete(null)}
        title="Delete shader pack"
        description={`Remove ${packToDelete ?? ""} from this instance?`}
        confirmLabel="Delete"
        destructive
        busy={deletePack.isPending}
        onConfirm={() => {
          if (packToDelete) {
            deletePack.mutate(
              { instanceId, fileName: packToDelete },
              { onSettled: () => setPackToDelete(null) },
            );
          }
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Shaders</h2>
          <p className="text-sm text-muted-foreground">
            {usesIris
              ? `Shader packs for this instance, loaded by ${loader === "forge" ? "OptiFine" : "Iris"}. Select one in game under Options > Video Settings > Shader Packs.`
              : "Manage shader pack files for this instance. Packs remain inactive until a compatible shader engine is available."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => openFolder.mutate(instanceId)}>
            <FolderOpen className="h-3.5 w-3.5" />
            Open folder
          </Button>
          <Button onClick={handleImport} disabled={importPack.isPending} variant="primary">
            {importPack.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Import .zip
          </Button>
        </div>
      </div>

      {!usesIris && (
        <Panel className="flex flex-wrap items-center justify-between gap-3 border-amber-500/30 bg-amber-500/5 p-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-amber-200">No compatible shader engine available</div>
            <p className="text-sm text-muted-foreground">
              No shader engine is currently verified for {instanceTarget}. Shader discovery and installation are disabled for this instance.
            </p>
          </div>
        </Panel>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Installed ({packs?.length ?? 0})
        </h3>
        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : !packs || packs.length === 0 ? (
          <EmptyState
            title="No shader pack yet"
            description={usesIris ? "Use Search content to find a shader, or import a .zip you already have." : "Import a .zip to keep it ready for a compatible shader engine."}
          />
        ) : (
          <div className="space-y-1.5">
            {packs.map((pack) => (
              <div
                key={pack.file_name}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/50 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-sm font-medium">{pack.file_name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(pack.size)}</span>
                </div>
                <button
                  onClick={() => setPackToDelete(pack.file_name)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Delete shader pack"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {mode === "all" && <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Discover shaders
        </h3>
        {usesIris ? (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && runSearch()}
                  placeholder="Search Modrinth shaders (BSL, Complementary, ...)"
                  className="pl-9"
                />
              </div>
              <Button onClick={runSearch} disabled={shaderSearch.isPending || !query.trim()} variant="primary">
                {shaderSearch.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Search
              </Button>
            </div>

            {shaderSearch.data && (
              shaderSearch.data.hits.length === 0 ? (
                <EmptyState title="No results" description="Try another name or check the Minecraft version." />
              ) : (
                <div className="space-y-1.5">
                  {shaderSearch.data.hits.map((hit) => {
                    const installedName = findInstalledByTitle(hit.title, installedNames);
                    return (
                    <div
                      key={hit.project_id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/50 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {hit.icon_url ? (
                          <img src={hit.icon_url} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10" />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <Sparkles className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{hit.title}</div>
                          <div className="truncate text-xs text-muted-foreground">{hit.description}</div>
                        </div>
                      </div>
                      {installedName ? (
                        <Button
                          onClick={() => setPackToDelete(installedName)}
                          variant="danger"
                          className="h-9 shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Uninstall
                        </Button>
                      ) : (
                        <Button
                          onClick={() => {
                            setInstallingId(hit.project_id);
                            installShader.mutate(
                              { instanceId, projectId: hit.project_id },
                              { onSettled: () => setInstallingId(null) },
                            );
                          }}
                          disabled={installShader.isPending}
                          variant="primary"
                          className="h-9 shrink-0"
                        >
                          {installingId === hit.project_id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          Install
                        </Button>
                      )}
                    </div>
                    );
                  })}
                </div>
              )
            )}
          </>
        ) : (
          <EmptyState
            title="Shader discovery unavailable"
            description={`Modrinth shader results are hidden because ${instanceTarget} has no compatible engine.`}
          />
        )}
      </section>}
    </div>
  );
}
