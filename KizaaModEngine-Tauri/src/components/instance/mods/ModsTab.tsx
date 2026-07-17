import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useMods, useToggleMod, useInstallMod, useDeleteMod, useModCompatibility, useOpenModFolder, useRunningInstances } from "../../../lib/queries";
import { AlertTriangle, ShieldCheck, Search, Plus, Package, Loader2, ArrowUpDown, FolderOpen, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { cn, formatBytes } from "../../../lib/utils";
import { ConfirmActionDialog } from "../../ui/confirm-action-dialog";

interface ModsTabProps {
  instanceId: string;
}

interface PendingModDeletion {
  id: string;
  name: string;
  enabled: boolean;
  deployedFileCount: number;
}

function describeModDeletion(mod: PendingModDeletion | null): string {
  if (!mod) return "";

  const activeState = mod.enabled
    ? "This mod is active and will be removed from every profile."
    : "This mod will be removed from every profile.";
  const deployedState = mod.deployedFileCount > 0
    ? `${mod.deployedFileCount} deployed file${mod.deployedFileCount === 1 ? "" : "s"} will also be removed from the instance.`
    : "No deployed files are currently tracked for this mod.";

  return `Delete ${mod.name} from this instance? ${activeState} ${deployedState} This cannot be undone.`;
}

export function ModsTab({ instanceId }: ModsTabProps) {
  const { data: mods, isLoading, error } = useMods(instanceId);
  const toggleMod = useToggleMod();
  const installMod = useInstallMod();
  const deleteMod = useDeleteMod();
  const openModFolder = useOpenModFolder();
  const { data: runningInstances } = useRunningInstances();
  const instanceIsRunning = runningInstances?.[instanceId] !== undefined;
  
  // Re-check compatibility whenever the mod list changes (install/toggle/delete).
  const modsKey = useMemo(
    () => (mods ?? []).map((mod) => `${mod.id}:${mod.enabled ? 1 : 0}`).join(","),
    [mods],
  );
  const { data: compat } = useModCompatibility(instanceId, modsKey);
  const compatProblems = useMemo(
    () => (compat?.mods ?? []).filter((entry) => entry.issues.length > 0),
    [compat],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [filterEnabled, setFilterEnabled] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [sortConfig, setSortConfig] = useState<{ key: 'name' | 'load_order' | 'enabled'; direction: 'asc' | 'desc' }>({ key: 'load_order', direction: 'asc' });
  const [modToDelete, setModToDelete] = useState<PendingModDeletion | null>(null);

  const handleInstallMod = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Archives', extensions: ['zip', '7z', 'rar'] }],
        title: "Select Mod Archive"
      });

      if (selected && typeof selected === "string") {
        installMod.mutate({ instanceId, archivePath: selected });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const toggleSort = (key: 'name' | 'load_order' | 'enabled') => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const filteredMods = mods?.filter(mod => {
    const matchesSearch = mod.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterEnabled === 'all' 
      ? true 
      : filterEnabled === 'enabled' ? mod.enabled : !mod.enabled;
    return matchesSearch && matchesFilter;
  }) ?? [];

  const sortedMods = [...filteredMods].sort((a, b) => {
    const { key, direction } = sortConfig;
    let comparison = 0;
    
    if (key === 'name') {
      comparison = a.name.localeCompare(b.name);
    } else if (key === 'load_order') {
      comparison = a.load_order - b.load_order;
    } else if (key === 'enabled') {
      comparison = (a.enabled === b.enabled) ? 0 : a.enabled ? -1 : 1;
    }

    return direction === 'asc' ? comparison : -comparison;
  });

  const coverSrc = (mod: typeof sortedMods[number]) => {
    if (mod.cover_url) return mod.cover_url;
    if (mod.cover_path) return convertFileSrc(mod.cover_path);
    return null;
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-destructive p-8">
        <Package className="w-12 h-12 mb-4 opacity-50" />
        <h3 className="text-lg font-medium">Failed to load mods</h3>
        <p className="text-sm opacity-80 mt-1 max-w-sm text-center">{String(error)}</p>
        <button 
            onClick={() => window.location.reload()} 
            className="mt-4 px-4 py-2 bg-secondary/50 hover:bg-secondary rounded-lg text-sm transition-colors"
        >
            Retry
        </button>
      </div>
    );
  }

  // Empty State with specific guidance based on filter
  if (sortedMods.length === 0) {
     return (
        <div className="flex-1 flex flex-col items-center justify-center h-full text-muted-foreground py-12">
            <div className="w-16 h-16 bg-secondary/30 rounded-full flex items-center justify-center mb-4">
                <Package className="w-8 h-8 opacity-50" />
            </div>
            
            {filterEnabled === 'all' && searchQuery === '' ? (
                <>
                    <h3 className="text-lg font-medium text-foreground mb-2">No mods installed</h3>
                    <p className="max-w-xs text-center mb-6 text-sm">
                        This instance is empty. Add your first mod to get started.
                    </p>
                    <button 
                        onClick={handleInstallMod}
                        className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium flex items-center gap-2 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Install Mod
                    </button>
                </>
            ) : (
                <>
                    <h3 className="text-lg font-medium text-foreground mb-2">No mods found</h3>
                    <p className="max-w-xs text-center text-sm">
                        No mods match your current filter or search query.
                    </p>
                    <button 
                        onClick={() => { setSearchQuery(''); setFilterEnabled('all'); }}
                        className="mt-4 px-4 py-2 bg-secondary/50 hover:bg-secondary rounded-lg text-sm transition-colors text-foreground"
                    >
                        Clear Filters
                    </button>
                </>
            )}
        </div>
     );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ConfirmActionDialog
        open={!!modToDelete}
        onOpenChange={(open) => {
          if (!open && !deleteMod.isPending) setModToDelete(null);
        }}
        title="Delete mod"
        description={describeModDeletion(modToDelete)}
        confirmLabel="Delete mod"
        destructive
        busy={deleteMod.isPending}
        onConfirm={() => {
          if (!modToDelete) return;
          deleteMod.mutate(
            { instanceId, modId: modToDelete.id },
            { onSuccess: () => setModToDelete(null) },
          );
        }}
      />
      {/* Automatic compatibility report (no launch, no Sync needed) */}
      {compat && (
        compatProblems.length === 0 ? (
          <div className="mx-4 mt-4 flex items-center gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-300" />
            <span className="text-sm text-emerald-200">
              All {compat.mods.length} mods are compatible with Minecraft {compat.mc_version}.
            </span>
          </div>
        ) : (
          <div className="mx-4 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
              <span className="text-sm font-medium text-amber-200">
                {compat.errors > 0
                  ? `${compat.errors} compatibility problem${compat.errors > 1 ? "s" : ""} detected`
                  : `${compat.warnings} warning${compat.warnings > 1 ? "s" : ""}`}
                {" "}for Minecraft {compat.mc_version}
              </span>
            </div>
            <ul className="mt-2 space-y-1 pl-6">
              {compatProblems.slice(0, 6).map((entry) => (
                <li key={entry.file_name} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{entry.name ?? entry.file_name}</span>
                  {entry.version ? ` ${entry.version}` : ""} — {entry.issues.map((issue) => issue.message).join(" ")}
                </li>
              ))}
              {compatProblems.length > 6 && (
                <li className="text-xs text-muted-foreground">…and {compatProblems.length - 6} more.</li>
              )}
            </ul>
          </div>
        )
      )}

      {/* Toolbar */}
      <div className="p-4 border-b border-border/50 flex items-center gap-4 bg-card/30">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Search mods..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-4 bg-secondary/50 border border-transparent focus:border-primary/50 focus:bg-background rounded-lg text-sm transition-all outline-none"
          />
        </div>

        <div className="flex items-center bg-secondary/50 rounded-lg p-1">
          <button 
            onClick={() => setFilterEnabled('all')}
            className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all", filterEnabled === 'all' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            All
          </button>
          <button 
            onClick={() => setFilterEnabled('enabled')}
            className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all", filterEnabled === 'enabled' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            Enabled
          </button>
          <button 
            onClick={() => setFilterEnabled('disabled')}
            className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all", filterEnabled === 'disabled' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            Disabled
          </button>
        </div>

        {instanceIsRunning && (
          <span className="hidden items-center gap-1.5 text-xs text-amber-300 xl:inline-flex">
            <AlertTriangle className="h-3.5 w-3.5" />
            Stop Minecraft to delete mods
          </span>
        )}

        <button 
          onClick={handleInstallMod}
          disabled={installMod.isPending || deleteMod.isPending}
          className="ml-auto h-9 px-4 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg font-medium flex items-center gap-2 text-sm transition-colors"
        >
          {installMod.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add Mod
        </button>
      </div>

      {/* Mods List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <button onClick={() => toggleSort('enabled')} className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/20 px-2 py-1 hover:bg-secondary">
            State {sortConfig.key === 'enabled' && <ArrowUpDown className="h-3 w-3" />}
          </button>
          <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/20 px-2 py-1 hover:bg-secondary">
            Name {sortConfig.key === 'name' && <ArrowUpDown className="h-3 w-3" />}
          </button>
          <button onClick={() => toggleSort('load_order')} className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/20 px-2 py-1 hover:bg-secondary">
            Load order {sortConfig.key === 'load_order' && <ArrowUpDown className="h-3 w-3" />}
          </button>
        </div>

        <div className="grid gap-3">
          {sortedMods.map((mod) => (
            <article key={mod.id} className="group grid gap-4 rounded-lg border border-border/70 bg-card/40 p-3 transition hover:bg-secondary/15 md:grid-cols-[72px_minmax(0,1fr)_auto]">
              <div className="h-[72px] w-[72px] overflow-hidden rounded-md border border-border bg-secondary/40">
                {coverSrc(mod) ? (
                  <img src={coverSrc(mod) ?? ""} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-primary/10">
                    <Package className="h-6 w-6 text-primary/70" />
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-foreground">{mod.name}</h3>
                  <span className={cn("rounded border px-2 py-0.5 text-[11px]", mod.enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-zinc-500/30 bg-zinc-500/10 text-zinc-300")}>
                    {mod.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <span className={cn(
                    "rounded border px-2 py-0.5 text-[11px]",
                    mod.deployed_file_count > 0
                      ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
                      : "border-border bg-secondary/20 text-muted-foreground",
                  )}>
                    {mod.deployed_file_count > 0
                      ? `Deployed (${mod.deployed_file_count})`
                      : "Not deployed"}
                  </span>
                  <span className="rounded border border-border bg-secondary/20 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">#{mod.load_order}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">{mod.description || "No description"}</p>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                  <span className="rounded border border-border bg-secondary/20 px-2 py-0.5">{mod.version}</span>
                  {mod.source && <span className="rounded border border-border bg-secondary/20 px-2 py-0.5">{mod.source}</span>}
                  {mod.loaders.slice(0, 2).map(loader => <span key={loader} className="rounded border border-border bg-secondary/20 px-2 py-0.5">{loader}</span>)}
                  {mod.game_versions.slice(0, 2).map(version => <span key={version} className="rounded border border-border bg-secondary/20 px-2 py-0.5">MC {version}</span>)}
                  {mod.file_size && <span className="rounded border border-border bg-secondary/20 px-2 py-0.5">{formatBytes(mod.file_size, 1)}</span>}
                  {mod.updated_at && <span className="rounded border border-border bg-secondary/20 px-2 py-0.5">{new Date(mod.updated_at).toLocaleDateString()}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 md:justify-end">
                <label className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/20 px-3 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={mod.enabled}
                    disabled={toggleMod.isPending || deleteMod.isPending}
                    onChange={() => toggleMod.mutate({
                      instanceId,
                      modId: mod.id,
                      enabled: !mod.enabled,
                    })}
                    className="h-4 w-4 rounded border-muted-foreground/30 bg-transparent text-primary focus:ring-primary/20"
                  />
                  Active
                </label>
                <button
                  onClick={() => openModFolder.mutate({ instanceId, modId: mod.id })}
                  disabled={deleteMod.isPending}
                  className="h-10 w-10 rounded-md border border-border bg-secondary/20 text-muted-foreground transition-[color,background-color,border-color,opacity,transform] hover:bg-secondary hover:text-foreground active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100"
                  title="Open Mod Folder"
                  aria-label={`Open ${mod.name} folder`}
                >
                  <FolderOpen className="mx-auto h-4 w-4" />
                </button>
                <button
                  onClick={() => setModToDelete({
                    id: mod.id,
                    name: mod.name,
                    enabled: mod.enabled,
                    deployedFileCount: mod.deployed_file_count,
                  })}
                  disabled={instanceIsRunning || deleteMod.isPending || toggleMod.isPending || installMod.isPending}
                  className="h-10 w-10 rounded-md border border-red-500/25 bg-red-500/10 text-red-200 transition-[color,background-color,border-color,opacity,transform] hover:bg-red-500/15 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100"
                  title={instanceIsRunning ? "Stop Minecraft before deleting mods" : `Delete ${mod.name}`}
                  aria-label={`Delete ${mod.name}`}
                >
                  {deleteMod.isPending && deleteMod.variables?.modId === mod.id
                    ? <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    : <Trash2 className="mx-auto h-4 w-4" />}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
