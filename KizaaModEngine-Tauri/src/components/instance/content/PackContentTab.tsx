import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Database, FolderOpen, Image, Loader2, Trash2, Upload } from "lucide-react";
import type { GameInstanceSummary } from "../../../lib/types";
import {
  useDeleteMinecraftContent,
  useImportMinecraftContent,
  useMinecraftContent,
  useMinecraftWorlds,
  useOpenMinecraftContentFolder,
  type MinecraftContentType,
} from "../../../lib/queries";
import { formatBytes } from "../../../lib/utils";
import { Button, EmptyState } from "../../ui/primitives";
import { ConfirmActionDialog } from "../../ui/confirm-action-dialog";
import { LauncherOptionPicker } from "../../ui/launcher-option-picker";

type PackContentType = Extract<MinecraftContentType, "resourcepack" | "datapack">;

export function PackContentTab({
  instance,
  contentType,
}: {
  instance: GameInstanceSummary;
  contentType: PackContentType;
}) {
  const isDataPack = contentType === "datapack";
  const title = isDataPack ? "Data packs" : "Resource packs";
  const Icon = isDataPack ? Database : Image;
  const [selectedWorld, setSelectedWorld] = useState("");
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const worlds = useMinecraftWorlds(isDataPack ? instance.id : null);

  useEffect(() => {
    if (!isDataPack) {
      setSelectedWorld("");
      return;
    }
    const available = worlds.data ?? [];
    if (!available.some((world) => world.name === selectedWorld)) {
      setSelectedWorld(available[0]?.name ?? "");
    }
  }, [isDataPack, selectedWorld, worlds.data]);

  const worldOptions = useMemo(
    () =>
      (worlds.data ?? []).map((world) => ({
        value: world.name,
        label: world.name,
        description: `${world.data_pack_count} installed data pack${world.data_pack_count === 1 ? "" : "s"}`,
      })),
    [worlds.data],
  );

  const content = useMinecraftContent(
    instance.id,
    contentType,
    isDataPack ? selectedWorld : null,
  );
  const deleteContent = useDeleteMinecraftContent();
  const importContent = useImportMinecraftContent();
  const openFolder = useOpenMinecraftContentFolder();
  const worldReady = !isDataPack || !!selectedWorld;

  const handleImport = async () => {
    if (!worldReady) return;
    const selected = await open({
      multiple: false,
      filters: [{ name: title, extensions: ["zip"] }],
      title: `Select ${isDataPack ? "a data pack" : "a resource pack"} (.zip)`,
    });
    if (selected && typeof selected === "string") {
      importContent.mutate({
        instanceId: instance.id,
        contentType,
        sourcePath: selected,
        worldName: isDataPack ? selectedWorld : null,
      });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <ConfirmActionDialog
        open={!!fileToDelete}
        onOpenChange={(openState) => !openState && setFileToDelete(null)}
        title={`Delete ${isDataPack ? "data pack" : "resource pack"}`}
        description={`Remove ${fileToDelete ?? ""}${isDataPack ? ` from ${selectedWorld}` : ""}?`}
        confirmLabel="Delete"
        destructive
        busy={deleteContent.isPending}
        onConfirm={() => {
          if (!fileToDelete) return;
          deleteContent.mutate(
            {
              instanceId: instance.id,
              contentType,
              fileName: fileToDelete,
              worldName: isDataPack ? selectedWorld : null,
            },
            { onSettled: () => setFileToDelete(null) },
          );
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isDataPack
              ? "Data packs are isolated per world. Choose the save you want to manage."
              : "Resource packs installed for this Minecraft instance."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() =>
              openFolder.mutate({
                instanceId: instance.id,
                contentType,
                worldName: isDataPack ? selectedWorld : null,
              })
            }
            disabled={!worldReady}
          >
            <FolderOpen className="h-4 w-4" />
            Open folder
          </Button>
          <Button
            onClick={handleImport}
            disabled={!worldReady || importContent.isPending}
            variant="primary"
          >
            {importContent.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Import .zip
          </Button>
        </div>
      </div>

      {isDataPack && (
        <div className="w-full max-w-sm">
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

      {isDataPack && !worlds.isLoading && worldOptions.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No Minecraft world found"
          description="Launch this instance and create or open a world once. Kiza will then let you install data packs into that save."
        />
      ) : content.isLoading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : !content.data?.length ? (
        <EmptyState
          icon={Icon}
          title={`No ${isDataPack ? "data pack" : "resource pack"} installed`}
          description="Use Search content to install a compatible pack, or import a local .zip."
        />
      ) : (
        <div className="space-y-2">
          {content.data.map((pack) => (
            <div
              key={`${pack.world_name ?? "instance"}:${pack.file_name}`}
              className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{pack.file_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {pack.world_name ? `${pack.world_name} · ` : ""}
                    {formatBytes(pack.size)}
                  </div>
                </div>
              </div>
              <Button
                onClick={() => setFileToDelete(pack.file_name)}
                variant="danger"
                className="h-9 w-9 shrink-0 px-0"
                title="Delete content"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
