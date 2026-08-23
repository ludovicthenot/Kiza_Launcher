import { useState } from "react";
import { formatDate, formatDateTime } from "../../lib/datetime";
import { useRegionFormats } from "../../lib/useRegionFormats";
import {
  Archive,
  Clock,
  Globe2,
  HardDrive,
  History,
  Loader2,
  RotateCcw,
  Save,
  Skull,
  Trash2,
} from "lucide-react";
import {
  useBackupWorld,
  useDeleteWorldCheckpoint,
  useRestoreWorld,
  useWorldCheckpoints,
  useWorlds,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { Button, EmptyState, Panel } from "../ui/primitives";
import { ConfirmActionDialog } from "../ui/confirm-action-dialog";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}


/**
 * Backups of the worlds of one instance.
 *
 * A world is the only thing in an instance that cannot be downloaded again, so
 * it gets its own store rather than riding along with restore points. Backups
 * are refused while the game is running — a world copied mid-save restores as a
 * damaged world — and the button says so rather than failing after the fact.
 */
export function WorldVaultPanel({
  instanceId,
  isRunning,
}: {
  instanceId: string;
  isRunning: boolean;
}) {
  const regionFormats = useRegionFormats();
  const { t } = useI18n();
  const { data: worlds, isLoading } = useWorlds(instanceId);
  const { data: checkpoints } = useWorldCheckpoints(instanceId);
  const backup = useBackupWorld();
  const restore = useRestoreWorld();
  const remove = useDeleteWorldCheckpoint();

  const [openWorld, setOpenWorld] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  if (isLoading) {
    return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
  }

  if ((worlds ?? []).length === 0) {
    return (
      <EmptyState
        icon={Globe2}
        title={t("No world yet")}
        description={t("Worlds appear here once you have played this instance at least once.")}
      />
    );
  }

  const backupsOf = (folder: string) =>
    (checkpoints ?? []).filter((checkpoint) => checkpoint.folder === folder);

  return (
    <div className="space-y-3">
      <ConfirmActionDialog
        open={confirmRestore !== null}
        onOpenChange={(open) => !open && setConfirmRestore(null)}
        title={t("Restore this backup")}
        // Restoring is the destructive direction: everything built since the
        // backup goes away, and saying so beforehand is the whole point.
        description={t(
          "The world goes back to how it was at this backup. Everything built, mined or explored since then is lost.",
        )}
        confirmLabel={t("Restore the world")}
        destructive
        busy={restore.isPending}
        onConfirm={() => {
          if (!confirmRestore) return;
          restore.mutate(
            { instanceId, checkpointId: confirmRestore },
            { onSettled: () => setConfirmRestore(null) },
          );
        }}
      />

      {isRunning && (
        <p className="text-xs text-amber-300">
          {t("Close Minecraft to back up or restore a world.")}
        </p>
      )}

      {(worlds ?? []).map((world) => {
        const backups = backupsOf(world.folder);
        const expanded = openWorld === world.folder;

        return (
          <Panel key={world.folder} className="p-4">
            <div className="flex flex-wrap items-start gap-4">
              {world.icon ? (
                <img
                  src={world.icon}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-md border border-border/70 object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border/70 bg-secondary/30">
                  <Globe2 className="h-6 w-6 text-muted-foreground" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{world.display_name}</span>
                  {world.hardcore && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                      <Skull className="h-3 w-3" />
                      {t("Hardcore")}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {world.version_name && <span>{world.version_name}</span>}
                  <span className="inline-flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    {formatBytes(world.size_bytes)}
                  </span>
                  {world.last_played_ms !== null && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(world.last_played_ms, regionFormats)}
                    </span>
                  )}
                  {/* The folder is only the name the world had the day it was
                      created, so it is worth showing when it differs. */}
                  {world.folder !== world.display_name && (
                    <span className="font-mono">{world.folder}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={() =>
                    backup.mutate({
                      instanceId,
                      folder: world.folder,
                      reason: t("Manual backup"),
                    })
                  }
                  disabled={isRunning || backup.isPending}
                  title={
                    isRunning
                      ? t("Close Minecraft first")
                      : t("Save the world as it is right now")
                  }
                  variant="primary"
                >
                  {backup.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t("Back up")}
                </Button>
                <Button
                  onClick={() => setOpenWorld(expanded ? null : world.folder)}
                  disabled={backups.length === 0}
                  title={t("Show the backups of this world")}
                >
                  <History className="h-4 w-4" />
                  {backups.length}
                </Button>
              </div>
            </div>

            {expanded && backups.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-border/50 pt-3">
                {backups.map((checkpoint) => (
                  <div
                    key={checkpoint.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-secondary/20 px-3 py-2"
                  >
                    <Archive className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">
                        {formatDateTime(checkpoint.created_at, regionFormats)}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {checkpoint.reason} · {checkpoint.entries.length} {t("files")} ·{" "}
                        {formatBytes(checkpoint.total_bytes)}
                      </div>
                    </div>
                    <Button
                      onClick={() => setConfirmRestore(checkpoint.id)}
                      disabled={isRunning || restore.isPending}
                      title={
                        isRunning ? t("Close Minecraft first") : t("Put the world back to this")
                      }
                    >
                      <RotateCcw className="h-4 w-4" />
                      {t("Restore")}
                    </Button>
                    <Button
                      onClick={() =>
                        remove.mutate({ instanceId, checkpointId: checkpoint.id })
                      }
                      disabled={remove.isPending}
                      variant="danger"
                      title={t("Delete this backup")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
