import { useEffect, useState } from "react";
import { FolderOpen, Loader2, Save, Trash2 } from "lucide-react";
import { GameInstanceSummary } from "../../lib/types";
import {
  useDeleteInstance,
  useAppConfig,
  useMinecraftVersions,
  useOpenInstanceFolder,
  useRenameInstance,
  useSetInstanceVersion,
} from "../../lib/queries";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { ConfirmActionDialog } from "../ui/confirm-action-dialog";
import { Button, Input } from "../ui/primitives";
import { MinecraftVersionPicker } from "../common/MinecraftVersionPicker";

interface InstanceSettingsDialogProps {
  instance: GameInstanceSummary;
  isRunning: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function InstanceSettingsDialog({
  instance,
  isRunning,
  open,
  onOpenChange,
  onDeleted,
}: InstanceSettingsDialogProps) {
  const { data: versions } = useMinecraftVersions();
  const { data: config } = useAppConfig();
  const renameInstance = useRenameInstance();
  const setVersion = useSetInstanceVersion();
  const deleteInstance = useDeleteInstance();
  const openFolder = useOpenInstanceFolder();

  const [name, setName] = useState(instance.display_name);
  const [mcVersion, setMcVersion] = useState(instance.minecraft?.mc_version ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(instance.display_name);
    setMcVersion(instance.minecraft?.mc_version ?? "");
  }, [open, instance.display_name, instance.minecraft?.mc_version]);

  const nameChanged = name.trim() !== instance.display_name && !!name.trim();
  const versionChanged = mcVersion !== instance.minecraft?.mc_version && !!mcVersion;
  const busy = renameInstance.isPending || setVersion.isPending;

  const handleSave = async () => {
    if (nameChanged) {
      await renameInstance.mutateAsync({ instanceId: instance.id, displayName: name.trim() });
    }
    if (versionChanged) {
      await setVersion.mutateAsync({ instanceId: instance.id, mcVersion });
    }
    onOpenChange(false);
  };

  return (
    <>
      <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
        {open && (
          <div
            aria-hidden="true"
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            onPointerDown={() => onOpenChange(false)}
          />
        )}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Instance settings</DialogTitle>
            <DialogDescription>
              Rename this instance, switch its Minecraft version, or remove it entirely.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium">Instance name</label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Minecraft version</label>
            <MinecraftVersionPicker
              versions={versions?.versions ?? []}
              value={mcVersion}
              onValueChange={setMcVersion}
              releasesOnly={config?.minecraft_releases_only ?? true}
              disabled={isRunning}
            />
            {versionChanged && (
              <p className="text-xs text-amber-300">
                Changing the version updates the game files. Check your mods for compatibility before the next launch.
              </p>
            )}
            {isRunning && <p className="text-xs text-muted-foreground">Stop the game to change the version.</p>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-4">
            <div className="flex gap-2">
              <Button onClick={() => openFolder.mutate(instance.id)}>
                <FolderOpen className="h-4 w-4" />
                Open folder
              </Button>
              <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={isRunning}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={busy || (!nameChanged && !versionChanged)}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${instance.display_name}`}
        description="This permanently removes the instance folder, its mods, worlds and settings. This cannot be undone."
        confirmLabel="Delete instance"
        destructive
        busy={deleteInstance.isPending}
        onConfirm={() => {
          deleteInstance.mutate(instance.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              onOpenChange(false);
              onDeleted();
            },
            onSettled: () => setConfirmDelete(false),
          });
        }}
      />
    </>
  );
}
