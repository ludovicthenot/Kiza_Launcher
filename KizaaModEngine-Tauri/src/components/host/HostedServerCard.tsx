import { useState } from "react";
import { FolderOpen, Loader2, Server, Trash2 } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { MINECRAFT_LOADER_LABELS } from "../../lib/minecraftLoaders";
import { presetById } from "../../lib/serverPresets";
import {
  useDeleteHostedServer,
  useOpenHostedServerFolder,
  type HostedServer,
} from "../../lib/queries";
import { Button } from "../ui/primitives";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

/**
 * One row of "Your servers".
 *
 * A server that has been created but not fetched says so: "Not installed"
 * rather than "Stopped", because nothing has been stopped yet.
 */
export function HostedServerCard({ server }: { server: HostedServer }) {
  const { t } = useI18n();
  const openFolder = useOpenHostedServerFolder();
  const remove = useDeleteHostedServer();
  const [confirming, setConfirming] = useState(false);
  const preset = presetById(server.preset);
  const [, sky, light] = preset?.scene ?? ["#111", "#3b2a66", "#a78bfa"];

  const loader = server.loader === "vanilla"
    ? "Vanilla"
    : `${MINECRAFT_LOADER_LABELS[server.loader]} ${server.loader_version ?? ""}`.trim();

  return (
    <div
      {...editable("panel")}
      className="kiza-panel flex items-center gap-4 border px-4 py-3"
    >
      <span
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
        style={{ backgroundImage: `linear-gradient(135deg, ${sky}, ${light})` }}
      >
        <Server className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold">{server.name}</p>
        <p className="truncate text-sm text-muted-foreground">
          {server.mc_version} · {loader}
          {preset ? ` · ${t(preset.name)}` : ""}
          {" · "}
          {t("Port")} {server.port}
        </p>
      </div>
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
          server.installed
            ? "border-border/70 text-muted-foreground"
            : "border-amber-400/40 bg-amber-400/10 text-amber-300",
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", server.installed ? "bg-muted-foreground" : "bg-amber-400")} />
        {server.installed ? t("Stopped") : t("Not installed")}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => openFolder.mutate(server.id)}
          title={t("Open the server folder")}
          aria-label={t("Open the server folder")}
          {...editable("secondary")}
          className="kiza-secondary flex h-10 w-11 items-center justify-center border text-muted-foreground transition-colors hover:text-foreground"
        >
          <FolderOpen className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          title={t("Delete this server")}
          aria-label={t("Delete this server")}
          {...editable("secondary")}
          className="kiza-secondary flex h-10 w-11 items-center justify-center border text-muted-foreground transition-colors hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Delete this server?")}</DialogTitle>
            <DialogDescription>
              {t("Its folder is removed too, world included. This cannot be undone.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirming(false)}>{t("Cancel")}</Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(server.id, { onSuccess: () => setConfirming(false) })}
            >
              {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t("Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
