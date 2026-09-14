import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Database, FolderOpen, Image, Loader2, Upload } from "lucide-react";
import type { GameInstanceSummary } from "../../../lib/types";
import {
  useDeleteMinecraftContent,
  useImportMinecraftContent,
  useContentIdentities,
  useMinecraftContent,
  type ContentIdentity,
  useMinecraftWorlds,
  useOpenMinecraftContentFolder,
  type MinecraftContentType,
} from "../../../lib/queries";
import { Button, EmptyState } from "../../ui/primitives";
import { ConfirmActionDialog } from "../../ui/confirm-action-dialog";
import { LauncherOptionPicker } from "../../ui/launcher-option-picker";
import { ContentRow, placeholderIdentity } from "./ContentRow";
import { ContentInfoDialog } from "./ContentInfoDialog";

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
  const [infoItem, setInfoItem] = useState<ContentIdentity | null>(null);
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
  // Who each file is: from the file itself and from Modrinth, by hash.
  const identities = useContentIdentities(instance.id, contentType, isDataPack ? selectedWorld : null);
  const identityOf = new Map((identities.data ?? []).map((item) => [item.file_name, item]));
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
      <ContentInfoDialog item={infoItem} kind={contentType} onClose={() => setInfoItem(null)} />
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
          {content.data.map((pack) => {
            const item = identityOf.get(pack.file_name) ?? placeholderIdentity(pack.file_name, pack.size);
            return (
              <ContentRow
                key={`${pack.world_name ?? "instance"}:${pack.file_name}`}
                item={item}
                kind={contentType}
                identifying={identities.isLoading}
                subtitle={pack.world_name ?? undefined}
                onInfo={() => setInfoItem(item)}
                onDelete={() => setFileToDelete(pack.file_name)}
                deleting={deleteContent.isPending}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
