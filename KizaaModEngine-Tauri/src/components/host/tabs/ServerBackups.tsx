import { useState } from "react";
import { Archive, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import { editable } from "../../../lib/maker/editable";
import { formatBytes } from "../../../lib/units";
import { formatDateTime } from "../../../lib/datetime";
import {
  isUp,
  useCreateBackup,
  useDeleteBackup,
  useRestoreBackup,
  useServerBackups,
  type HostedServer,
} from "../../../lib/hostQueries";
import { Input } from "../../ui/primitives";
import { ConfirmActionDialog } from "../../ui/confirm-action-dialog";

/**
 * Backups: make one, put one back, throw one away.
 *
 * Making one is safe at any time — the server is told to save first when it
 * is running. Putting one back needs the server stopped, keeps a copy of
 * what it replaces, and either finishes or leaves things as they were.
 */
export function ServerBackups({ server }: { server: HostedServer }) {
  const { t } = useI18n();
  const { data: backups, isLoading } = useServerBackups(server.id);
  const create = useCreateBackup();
  const restore = useRestoreBackup();
  const remove = useDeleteBackup();
  const [label, setLabel] = useState("");
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const up = isUp(server.status.state);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section {...editable("panel")} className="kiza-panel border p-5">
        <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Archive className="h-4 w-4" />
          {t("New backup")}
        </h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ serverId: server.id, label: label.trim() || "manual" }, { onSuccess: () => setLabel("") });
          }}
          className="flex flex-col gap-3"
        >
          <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("What for? e.g. before the update")} />
          <button type="submit" disabled={create.isPending} className="kiza-action inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            {t("Create a backup")}
          </button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          {up ? t("The server is told to save first; the world on disk is the one in play.") : t("World, mods, config and settings. Logs and the loader's libraries are left out.")}
        </p>
      </section>

      <section {...editable("panel")} className="kiza-panel border p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("Backups")} · {backups?.length ?? 0}
        </h3>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (backups?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{t("No backup yet.")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {backups!.map((backup) => (
              <li key={backup.file} className="flex items-center gap-3 rounded-md border border-border/50 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{backup.label || backup.file}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatDateTime(backup.created_at)} · {formatBytes(backup.bytes)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={up}
                  title={up ? t("Stop the server first") : t("Restore")}
                  onClick={() => setRestoring(backup.file)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("Restore")}
                </button>
                <button
                  type="button"
                  title={t("Delete")}
                  onClick={() => setDeleting(backup.file)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:border-red-400/50 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmActionDialog
        open={restoring != null}
        title={t("Restore this backup?")}
        description={t("The server's current files are backed up first as \"before restore\", then replaced by this backup. If anything fails midway, the current files are put back.")}
        confirmLabel={t("Restore")}
        cancelLabel={t("Cancel")}
        busy={restore.isPending}
        onOpenChange={(open) => !open && setRestoring(null)}
        onConfirm={() => restoring && restore.mutate({ serverId: server.id, file: restoring }, { onSuccess: () => setRestoring(null) })}
      />
      <ConfirmActionDialog
        open={deleting != null}
        title={t("Delete this backup?")}
        description={t("The zip is removed. The server itself is not touched.")}
        confirmLabel={t("Delete")}
        cancelLabel={t("Cancel")}
        destructive
        busy={remove.isPending}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={() => deleting && remove.mutate({ serverId: server.id, file: deleting }, { onSuccess: () => setDeleting(null) })}
      />
    </div>
  );
}
