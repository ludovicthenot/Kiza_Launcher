import { useRef, useState } from "react";
import {
  Archive,
  Boxes,
  Copy,
  FolderOpen,
  Gauge,
  Loader2,
  Play,
  RotateCcw,
  Server,
  Settings2,
  Skull,
  Square,
  Terminal,
  Trash2,
  Users,
} from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { useAppStore } from "../../lib/store";
import { MINECRAFT_LOADER_LABELS } from "../../lib/minecraftLoaders";
import {
  isBusy,
  isUp,
  useAcceptEula,
  useCloneHostedServer,
  useDeleteHostedServer,
  useKillServer,
  useOpenHostedServerFolder,
  useRestartServer,
  useServerIcon,
  useStartServer,
  useStopServer,
  type HostedServer,
} from "../../lib/hostQueries";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button, Input } from "../ui/primitives";
import { ConfirmActionDialog } from "../ui/confirm-action-dialog";
import { EulaDialog } from "./EulaDialog";
import { StatusPill } from "./StatusPill";
import { presetById } from "../../lib/serverPresets";
import { SlidingPill } from "../ui/sliding-pill";
import { useSwapIn } from "../../lib/animation";
import { ServerOverview } from "./tabs/ServerOverview";
import { ServerConsole } from "./tabs/ServerConsole";
import { ServerPlayers } from "./tabs/ServerPlayers";
import { ServerMods } from "./tabs/ServerMods";
import { ServerFiles } from "./tabs/ServerFiles";
import { ServerBackups } from "./tabs/ServerBackups";
import { ServerSettings } from "./tabs/ServerSettings";

type DetailTab = "overview" | "console" | "players" | "mods" | "files" | "backups" | "settings";

/**
 * The selected server: name and state, the controls, and the tabs.
 *
 * Start is the one button with a condition: the first time, it opens the
 * EULA, and only "Agree and start" writes the file and goes on.
 */
export function ServerDetail({ server }: { server: HostedServer }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [eulaOpen, setEulaOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [cloneName, setCloneName] = useState<string | null>(null);
  const setSelectedServerId = useAppStore((state) => state.setSelectedServerId);

  const start = useStartServer();
  const stop = useStopServer();
  const kill = useKillServer();
  const restart = useRestartServer();
  const acceptEula = useAcceptEula();
  const remove = useDeleteHostedServer();
  const clone = useCloneHostedServer();
  const openFolder = useOpenHostedServerFolder();
  const { data: icon } = useServerIcon(server.id, server.has_icon);

  const state = server.status.state;
  const tabRef = useRef<HTMLDivElement>(null);
  // The tab's content rises in when another tab is chosen (the page around
  // it does when another server is: HostView).
  useSwapIn(tabRef, tab);
  const preset = presetById(server.preset);
  const [ground, sky, light] = preset?.scene ?? ["#120a24", "#4c1d95", "#a78bfa"];
  const up = isUp(state);
  const busy = isBusy(state) || start.isPending || restart.isPending;

  const doStart = () => {
    if (!server.eula_accepted) {
      setEulaOpen(true);
      return;
    }
    start.mutate(server.id, { onError: (error) => String(error) === "eula" && setEulaOpen(true) });
  };

  const tabs: Array<{ id: DetailTab; label: string; icon: typeof Gauge }> = [
    { id: "overview", label: t("Overview"), icon: Gauge },
    { id: "console", label: t("Console"), icon: Terminal },
    { id: "players", label: t("Players"), icon: Users },
    { id: "mods", label: t("Mods"), icon: Boxes },
    { id: "files", label: t("Files"), icon: FolderOpen },
    { id: "backups", label: t("Backups"), icon: Archive },
    { id: "settings", label: t("Settings"), icon: Settings2 },
  ];

  return (
    <section data-anim="detail" {...editable("panel")} className="kiza-panel overflow-hidden border">
      {/* The banner: the preset's scene, the server on it, and its controls.
          A stopped server's scene rests dimmer, as its card did. */}
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: [
              `radial-gradient(ellipse at 82% 0%, ${light}99 0%, transparent 52%)`,
              `linear-gradient(180deg, ${sky} 0%, ${ground} 100%)`,
            ].join(","),
          }}
        />
        <div
          aria-hidden
          className={cn("absolute inset-0 bg-background transition-opacity duration-500 ease-drawer", state === "offline" ? "opacity-[0.45]" : "opacity-[0.15]")}
        />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-card to-transparent" />

        <div className="relative flex flex-wrap items-end gap-4 px-6 pb-5 pt-14">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-background/55 text-primary shadow-[0_12px_28px_-12px_hsl(0_0%_0%/0.8)] ring-1 ring-white/10 backdrop-blur-md">
            {icon ? <img src={icon} alt="" className="h-full w-full object-cover [image-rendering:pixelated]" /> : <Server className="h-7 w-7" />}
          </span>
          <div className="min-w-0 flex-1 pb-0.5">
            <StatusPill state={state} className="mb-1.5 bg-background/40 backdrop-blur-md" />
            <h2 className="truncate text-[1.75rem] font-semibold leading-tight tracking-[-0.025em]">{server.name}</h2>
            <p className="mt-0.5 truncate text-sm tabular-nums text-muted-foreground">
              Minecraft {server.mc_version} · {server.loader === "vanilla" ? "Vanilla" : `${MINECRAFT_LOADER_LABELS[server.loader]} ${server.loader_version ?? ""}`} · {t("Port")} {server.port} · {server.max_memory_mb} MB
              {server.description ? ` · ${server.description}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {state === "detached" ? (
              <Control icon={Skull} label={t("Kill")} tone="danger" onClick={() => setConfirmKill(true)} />
            ) : up ? (
              <>
                <Control icon={Square} label={t("Stop")} onClick={() => stop.mutate(server.id)} disabled={state === "stopping" || stop.isPending} />
                <Control icon={RotateCcw} label={t("Restart")} onClick={() => restart.mutate(server.id)} disabled={busy} />
                <Control icon={Skull} label={t("Kill")} tone="danger" onClick={() => setConfirmKill(true)} />
              </>
            ) : (
              <button
                type="button"
                onClick={doStart}
                disabled={busy}
                {...editable("action")}
                className="kiza-action inline-flex h-11 items-center gap-2 rounded-xl px-6 text-[0.9375rem] font-semibold text-primary-foreground shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.85)] transition-[filter,transform,opacity] duration-150 hover:brightness-110 active:scale-[0.97] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
                {state === "installing" ? t("Installing…") : server.installed ? t("Start the server") : t("Install and start")}
              </button>
            )}
            {/* The everyday action keeps its words; the rest are icons in one
                quiet group, named on hover. */}
            <div className="flex items-center gap-1 rounded-xl bg-secondary/35 p-1">
              <Control iconOnly icon={FolderOpen} label={t("Open folder")} onClick={() => openFolder.mutate({ serverId: server.id })} />
              <Control iconOnly icon={Copy} label={t("Clone")} onClick={() => setCloneName(`${server.name} (copy)`)} disabled={up} />
              <Control iconOnly icon={Trash2} label={t("Delete")} tone="danger" onClick={() => setConfirmDelete(true)} disabled={up} />
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 pt-1">
        <div role="tablist" aria-label={server.name} className="relative flex w-fit max-w-full flex-wrap items-center rounded-xl bg-secondary/45 p-1">
          <SlidingPill value={tab} className="rounded-[9px]" />
          {tabs.map((entry) => {
            const Icon = entry.icon;
            const active = entry.id === tab;
            if (entry.id === "mods" && server.loader === "vanilla") return null;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-active={active}
                onClick={() => setTab(entry.id)}
                className={cn(
                  "relative z-[1] inline-flex h-9 items-center gap-2 rounded-[9px] px-3.5 text-[0.8125rem] font-medium transition-colors duration-200",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={tabRef} className="p-6">
        {tab === "overview" && <ServerOverview server={server} />}
        {tab === "console" && <ServerConsole server={server} active />}
        {tab === "players" && <ServerPlayers server={server} />}
        {tab === "mods" && <ServerMods server={server} />}
        {tab === "files" && <ServerFiles server={server} active />}
        {tab === "backups" && <ServerBackups server={server} />}
        {tab === "settings" && <ServerSettings server={server} />}
      </div>

      <EulaDialog
        open={eulaOpen}
        serverName={server.name}
        busy={acceptEula.isPending || start.isPending}
        onOpenChange={setEulaOpen}
        onAccept={() =>
          acceptEula.mutate(server.id, {
            onSuccess: () => {
              setEulaOpen(false);
              start.mutate(server.id);
            },
          })
        }
      />
      <ConfirmActionDialog
        open={confirmKill}
        title={t("Kill the server process?")}
        description={t("The process is ended without saving. The last few minutes of the world may be lost. Prefer Stop when the server still answers.")}
        confirmLabel={t("Kill")}
        cancelLabel={t("Cancel")}
        destructive
        busy={kill.isPending}
        onOpenChange={setConfirmKill}
        onConfirm={() => kill.mutate(server.id, { onSuccess: () => setConfirmKill(false) })}
      />
      <ConfirmActionDialog
        open={confirmDelete}
        title={t("Delete this server?")}
        description={t("Its folder is removed too, world and backups included. This cannot be undone.")}
        confirmLabel={t("Delete")}
        cancelLabel={t("Cancel")}
        destructive
        busy={remove.isPending}
        onOpenChange={setConfirmDelete}
        onConfirm={() =>
          remove.mutate(server.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              setSelectedServerId(null);
            },
          })
        }
      />
      <Dialog open={cloneName != null} onOpenChange={(open) => !open && setCloneName(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Clone this server")}</DialogTitle>
            <DialogDescription>{t("A second server with the same world, mods and settings. Backups and logs stay with the original.")}</DialogDescription>
          </DialogHeader>
          <Input value={cloneName ?? ""} onChange={(event) => setCloneName(event.target.value)} autoFocus />
          <DialogFooter>
            <Button onClick={() => setCloneName(null)}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              disabled={!cloneName?.trim() || clone.isPending}
              onClick={() =>
                clone.mutate(
                  { serverId: server.id, name: cloneName!.trim() },
                  {
                    onSuccess: (created) => {
                      setCloneName(null);
                      setSelectedServerId(created.id);
                    },
                  },
                )
              }
            >
              {clone.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              {t("Clone")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Control({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone,
  iconOnly,
}: {
  icon: typeof Play;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
  /** A square icon in a group; the label stays for the tooltip and screen readers. */
  iconOnly?: boolean;
}) {
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-[9px] text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-white/[0.08] hover:text-foreground active:scale-[0.92] disabled:pointer-events-none disabled:opacity-35",
          tone === "danger" && "hover:bg-red-400/10 hover:text-red-300",
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      {...editable("secondary")}
      className={cn(
        "kiza-secondary inline-flex h-11 items-center gap-2 border px-4 text-sm font-medium text-muted-foreground transition-[color,border-color,transform] duration-150 hover:text-foreground active:scale-[0.97] disabled:opacity-40",
        tone === "danger" && "hover:border-red-400/50 hover:text-red-300",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
