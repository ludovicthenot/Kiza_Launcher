import { useState } from "react";
import { AlertTriangle, Boxes, Download, FilePlus, Loader2, Power, Search, Trash2 } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { editable } from "../../../lib/maker/editable";
import { formatBytes } from "../../../lib/units";
import {
  useAddServerModFile,
  useInstallServerMod,
  useRemoveServerMod,
  useSearchModsForServer,
  useServerModCompat,
  useServerMods,
  useSetServerModEnabled,
  type HostedServer,
} from "../../../lib/hostQueries";
import { MINECRAFT_LOADER_LABELS } from "../../../lib/minecraftLoaders";
import { Input } from "../../ui/primitives";
import { ConfirmActionDialog } from "../../ui/confirm-action-dialog";

/**
 * The server's `mods/`, and a way to add to it.
 *
 * The list is the folder. The report under it is the same one the instance
 * runs — wrong loader, missing dependency, wrong Minecraft — on the server's
 * own files. Installing goes through Modrinth narrowed to this server's
 * Minecraft and loader; a project that says it runs on the client only is
 * refused when the install comes to it, with the reason.
 */
export function ServerMods({ server }: { server: HostedServer }) {
  const { t } = useI18n();
  const { data: mods, isLoading } = useServerMods(server.id);
  const { data: compat } = useServerModCompat(server.id, (mods?.length ?? 0) > 0);
  const remove = useRemoveServerMod();
  const setEnabled = useSetServerModEnabled();
  const addFile = useAddServerModFile();
  const install = useInstallServerMod();
  const search = useSearchModsForServer();
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const running = server.status.state !== "offline" && server.status.state !== "crashed";

  if (server.loader === "vanilla") {
    return (
      <p className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3 text-sm text-muted-foreground">
        {t("A vanilla server loads no mods. Clone it onto Fabric, Forge or NeoForge to add some.")}
      </p>
    );
  }

  const issuesFor = (file: string) => compat?.mods.find((m) => m.file_name === file)?.issues ?? [];

  const pickFile = async () => {
    const selected = await openFileDialog({ multiple: false, filters: [{ name: "Mod", extensions: ["jar"] }] });
    if (typeof selected === "string") addFile.mutate({ serverId: server.id, sourcePath: selected });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section {...editable("panel")} className="kiza-panel border p-5">
        <div className="mb-3 flex items-center gap-3">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Boxes className="h-4 w-4" />
            {t("Installed")} · {mods?.length ?? 0}
          </h3>
          {compat && (compat.errors > 0 || compat.warnings > 0) && (
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", compat.errors ? "border-red-400/40 text-red-300" : "border-amber-400/40 text-amber-300")}>
              <AlertTriangle className="h-3 w-3" />
              {compat.errors} {t("errors")} · {compat.warnings} {t("warnings")}
            </span>
          )}
          <button type="button" onClick={pickFile} disabled={addFile.isPending} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-border/70 px-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
            {addFile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus className="h-4 w-4" />}
            {t("Add a .jar")}
          </button>
        </div>
        {running && (
          <p className="mb-3 text-xs text-amber-300">{t("Changes here take effect on the next restart.")}</p>
        )}
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (mods?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{t("No mod in the folder yet.")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {mods!.map((mod) => {
              const issues = issuesFor(mod.file);
              const worst = issues.some((i) => i.severity === "error") ? "error" : issues.length ? "warning" : null;
              return (
                <li key={mod.file} className={cn("rounded-md border border-border/50 px-3 py-2", !mod.enabled && "opacity-60")}>
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{mod.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {mod.version ?? "—"} · {formatBytes(mod.bytes)} · {mod.file}
                      </span>
                    </span>
                    {worst && (
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", worst === "error" ? "bg-red-400" : "bg-amber-400")} />
                    )}
                    <button
                      type="button"
                      onClick={() => setEnabled.mutate({ serverId: server.id, file: mod.file, enabled: !mod.enabled })}
                      title={mod.enabled ? t("Disable") : t("Enable")}
                      className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60", mod.enabled ? "text-emerald-300" : "text-muted-foreground")}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(mod.file)}
                      title={t("Remove")}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:border-red-400/50 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {issues.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-xs">
                      {issues.map((issue, index) => (
                        <li key={index} className={issue.severity === "error" ? "text-red-300" : "text-amber-300"}>
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section {...editable("panel")} className="kiza-panel border p-5">
        <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Search className="h-4 w-4" />
          {t("Find on Modrinth")}
        </h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) search.mutate({ serverId: server.id, query: query.trim() });
          }}
          className="mb-3 flex gap-2"
        >
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`${t("Mods for")} ${server.mc_version} · ${MINECRAFT_LOADER_LABELS[server.loader]}`} />
          <button type="submit" disabled={search.isPending || !query.trim()} className="kiza-action inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {search.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </button>
        </form>
        {search.data && (
          <ul className="flex flex-col gap-1.5">
            {search.data.hits.length === 0 && <li className="text-sm text-muted-foreground">{t("Nothing for that on this Minecraft and loader.")}</li>}
            {search.data.hits.map((hit) => {
              return (
                <li key={hit.project_id} className="flex items-center gap-3 rounded-md border border-border/50 px-3 py-2">
                  {hit.icon_url ? (
                    <img src={hit.icon_url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary/40"><Boxes className="h-4 w-4 text-muted-foreground" /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{hit.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{hit.description}</span>
                  </span>
                  <button
                    type="button"
                    disabled={install.isPending}
                    onClick={() => install.mutate({ serverId: server.id, source: "modrinth", projectId: hit.project_id })}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-primary/50 px-2.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                  >
                    {install.isPending && install.variables?.projectId === hit.project_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    {t("Install")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t("Only releases for this Minecraft and loader are offered; a mod that runs on the client only is refused with the reason.")}
        </p>
      </section>

      <ConfirmActionDialog
        open={removing != null}
        title={t("Remove this mod?")}
        description={`${removing ?? ""} ${t("is deleted from the server's mods folder.")}`}
        confirmLabel={t("Remove")}
        cancelLabel={t("Cancel")}
        destructive
        busy={remove.isPending}
        onOpenChange={(open) => !open && setRemoving(null)}
        onConfirm={() => removing && remove.mutate({ serverId: server.id, file: removing }, { onSuccess: () => setRemoving(null) })}
      />
    </div>
  );
}
