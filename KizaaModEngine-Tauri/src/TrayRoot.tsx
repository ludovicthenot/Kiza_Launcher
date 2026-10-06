import { useEffect, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useState } from "react";
import {
  ExternalLink,
  Loader2,
  LogOut,
  Play,
  RefreshCw,
  Server,
  Settings,
  Square,
  User,
} from "lucide-react";
import { SkinHead } from "./components/common/SkinHead";
import { useHostedServers } from "./lib/hostQueries";
import {
  useInstances,
  useLaunchMinecraft,
  useMinecraftAccount,
  usePlayHistory,
  useRunningInstances,
  useStopInstance,
} from "./lib/queries";
import { useI18n } from "./lib/i18n";
import { cn } from "./lib/utils";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 0, staleTime: 5_000 } },
});

/**
 * The tray menu, drawn by the launcher's own page.
 *
 * A window of 300 by 420 with no frame and a transparent backdrop, shown
 * by the tray icon and closed by the loss of focus. Everything it offers
 * is one click: bring the launcher back, play the last instance, look at
 * the servers, open Settings, quit. It never navigates and never grows a
 * second page — a menu that needs scrolling is a window, and the launcher
 * already is one.
 */
export function TrayRoot() {
  return (
    <QueryClientProvider client={queryClient}>
      <TrayMenu />
    </QueryClientProvider>
  );
}

function act(action: string, id?: string) {
  void invoke("tray_action", { action, id: id ?? null });
}

function TrayMenu() {
  const { t } = useI18n();
  const [version, setVersion] = useState("");
  const { data: account } = useMinecraftAccount();
  const { data: instances } = useInstances();
  const { data: history } = usePlayHistory();
  const { data: running } = useRunningInstances();
  const { data: servers } = useHostedServers(true);
  const launch = useLaunchMinecraft();
  const stop = useStopInstance();

  useEffect(() => {
    getVersion().then((found) => setVersion(`v${found}`)).catch(() => undefined);
  }, []);

  // Escape closes, as it does a menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") act("close");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The instance to offer: the one running, else the one played last.
  const featured = useMemo(() => {
    const list = (instances ?? []).filter((instance) => instance.game_id === "minecraft");
    const runningId = Object.keys(running ?? {})[0];
    if (runningId) return list.find((instance) => instance.id === runningId) ?? null;
    const byPlayed = [...list].sort((left, right) =>
      (history?.[right.id] ?? "").localeCompare(history?.[left.id] ?? ""),
    );
    return byPlayed[0] ?? null;
  }, [instances, running, history]);
  const featuredRunning = !!featured && !!running?.[featured.id];

  const online = (servers ?? []).filter((server) => server.status.state === "online");
  const busy = launch.isPending || stop.isPending;

  const play = () => {
    if (!featured) return;
    if (featuredRunning) {
      stop.mutate(featured.id);
      return;
    }
    if (!account) {
      act("instance", featured.id);
      return;
    }
    launch.mutate(
      { instanceId: featured.id, username: account.username, offline: false },
      { onSettled: () => act("close") },
    );
  };

  return (
    <div className="dark flex h-[100dvh] w-full select-none items-end p-2 text-foreground">
      <div className="kiza-elevated flex w-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/[0.97]">
        {/* Who this is */}
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <img src="/favicon.png" alt="" className="h-8 w-8 rounded-lg" draggable={false} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-primary">Kiza Launcher</div>
            <div className="truncate text-xs text-muted-foreground">
              {account ? (
                <span className="inline-flex items-center gap-1.5">
                  <SkinHead url={account.skin_head_url} className="h-3.5 w-3.5 rounded-sm" />
                  {account.username}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  {t("Not signed in")}
                </span>
              )}
            </div>
          </div>
          {version && (
            <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[0.625rem] font-medium text-primary">
              {version}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 p-2">
          <Row icon={ExternalLink} label={t("Open Kiza Launcher")} onClick={() => act("open")} primary />

          {featured && (
            <div className="mt-1 rounded-xl border border-border/60 bg-background/40 p-2.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                    {featuredRunning ? t("Running") : t("Last played")}
                  </div>
                  <div className="truncate text-sm font-semibold">{featured.display_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {featured.minecraft?.mc_version}
                    {featured.minecraft && " • "}
                    {featured.mod_count} {featured.mod_count === 1 ? t("mod") : t("mods")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={play}
                  disabled={busy}
                  className={cn(
                    "inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition disabled:opacity-60",
                    featuredRunning
                      ? "border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20"
                      : "kiza-action text-primary-foreground hover:brightness-110",
                  )}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : featuredRunning ? (
                    <Square className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {featuredRunning ? t("Stop") : t("Play")}
                </button>
              </div>
            </div>
          )}

          <Row
            icon={Server}
            label={
              online.length === 0
                ? t("Servers")
                : online.length === 1
                  ? t("1 server online")
                  : t("{count} servers online").replace("{count}", String(online.length))
            }
            hint={online.length > 0 ? online.map((server) => server.name).join(", ") : undefined}
            dot={online.length > 0}
            onClick={() => act("host")}
          />
          <Row icon={RefreshCw} label={t("Check for updates")} onClick={() => act("updates")} />
          <Row icon={Settings} label={t("Settings")} onClick={() => act("settings")} />
        </div>

        <div className="border-t border-border/60 p-2">
          <Row icon={LogOut} label={t("Quit Kiza Launcher")} onClick={() => act("quit")} destructive />
        </div>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  hint,
  dot,
  onClick,
  primary,
  destructive,
}: {
  icon: typeof Play;
  label: string;
  hint?: string;
  dot?: boolean;
  onClick: () => void;
  primary?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition",
        primary
          ? "bg-primary/10 font-semibold text-foreground hover:bg-primary/20"
          : destructive
            ? "text-destructive hover:bg-destructive/10"
            : "text-foreground hover:bg-secondary/60",
      )}
    >
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon className={cn("h-4 w-4", primary ? "text-primary" : destructive ? "" : "text-muted-foreground")} />
        {dot && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}
