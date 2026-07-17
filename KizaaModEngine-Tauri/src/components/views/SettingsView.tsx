import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { SkinHead } from "../common/SkinHead";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircle2,
  Download,
  Gamepad2,
  HardDrive,
  Loader2,
  PlugZap,
  Save,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "../../lib/store";
import {
  ApiConnectionStatus,
  useApiConnections,
  useAppConfig,
  useDetectMinecraftRuntime,
  useInstallMinecraftRuntime,
  useRemoveApiConnection,
  useRemoveMinecraftAccount,
  useMinecraftAccount,
  useMinecraftAccounts,
  useMinecraftAuthPoll,
  useMinecraftAuthStart,
  useMinecraftLogout,
  usePerformanceProfiles,
  useSaveApiConnection,
  useSaveAppConfig,
  useSetActiveMinecraftAccount,
  useValidateApiConnection,
} from "../../lib/queries";
import { cn } from "../../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { UpdaterPanel } from "../settings/UpdaterPanel";

type SettingsTab = "system" | "apis" | "minecraft";

const tabs: Array<{ id: SettingsTab; label: string; icon: typeof ShieldCheck }> = [
  { id: "system", label: "System", icon: ShieldCheck },
  { id: "apis", label: "APIs", icon: PlugZap },
  { id: "minecraft", label: "Minecraft", icon: Gamepad2 },
];

function statusTone(status: string) {
  if (status === "connected" || status === "available") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "configured") return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  if (status === "offline_ready") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (status === "disabled") return "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";
  return "border-red-500/30 bg-red-500/10 text-red-300";
}

function fieldClass() {
  return "h-10 w-full rounded-md border border-border bg-secondary/35 px-3 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20";
}

function ApiConnectionRow({
  connection,
  secret,
  onSecretChange,
  onSave,
  onValidate,
  onRemove,
  busy,
}: {
  connection: ApiConnectionStatus;
  secret: string;
  onSecretChange: (value: string) => void;
  onSave: () => void;
  onValidate: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const acceptsSecret = connection.id === "curseforge" || connection.id === "microsoft";
  const inputLabel = connection.id === "microsoft" ? "Microsoft Client ID" : "API key";
  const secretPlaceholder = connection.configured
    ? connection.id === "microsoft"
      ? "Bundled default or approved Azure App ID"
      : connection.id === "curseforge"
      ? "Provided by Kiza Launcher Alpha or OS keyring"
      : "Stored in OS keyring"
    : connection.id === "microsoft"
      ? "Application (client) ID"
      : inputLabel;

  return (
    <div className="grid gap-4 border-b border-border/70 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-sm font-semibold">{connection.label}</div>
          <div className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-normal", statusTone(connection.status))}>
            {connection.status.replace("_", " ")}
          </div>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">{connection.detail}</p>
        {connection.action_hint && <p className="text-xs leading-5 text-muted-foreground/80">{connection.action_hint}</p>}
      </div>

      <div className="min-w-0 space-y-2">
        {acceptsSecret ? (
          <>
            <label className="text-xs font-medium text-muted-foreground">{inputLabel}</label>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <input
                type={connection.id === "microsoft" ? "text" : "password"}
                value={secret}
                onChange={(event) => onSecretChange(event.target.value)}
                placeholder={secretPlaceholder}
                className={fieldClass()}
              />
              <button
                onClick={onSave}
                disabled={busy || !secret.trim()}
                className="h-10 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-md border border-border/70 bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
            Public API. No secret required.
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={onValidate}
            disabled={busy}
            className="h-9 rounded-md border border-border bg-secondary/30 px-3 text-sm transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
          >
            Validate
          </button>
          {acceptsSecret && connection.configured && (
            <button
              onClick={onRemove}
              disabled={busy}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 text-sm text-red-200 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {connection.id === "microsoft" ? "Reset" : "Remove"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function parseMemoryMb(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

export function SettingsView() {
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const { data: config } = useAppConfig();
  const { data: runtime, refetch: refetchRuntime } = useDetectMinecraftRuntime("1.20.5");
  const { data: performanceProfiles } = usePerformanceProfiles();
  const { data: connections, isLoading: loadingConnections } = useApiConnections();
  const saveConfig = useSaveAppConfig();
  const installRuntime = useInstallMinecraftRuntime();
  const saveApiConnection = useSaveApiConnection();
  const validateApiConnection = useValidateApiConnection();
  const removeApiConnection = useRemoveApiConnection();
  const { data: minecraftAccount } = useMinecraftAccount();
  const { data: minecraftAccounts } = useMinecraftAccounts();
  const minecraftAuthStart = useMinecraftAuthStart();
  const minecraftAuthPoll = useMinecraftAuthPoll();
  const minecraftLogout = useMinecraftLogout();
  const setActiveMinecraftAccount = useSetActiveMinecraftAccount();
  const removeMinecraftAccount = useRemoveMinecraftAccount();

  const [activeTab, setActiveTab] = useState<SettingsTab>("system");
  const [enableDiscord, setEnableDiscord] = useState(true);
  const [discordShowVersion, setDiscordShowVersion] = useState(true);
  const [discordShowInstance, setDiscordShowInstance] = useState(true);
  const [closeToTray, setCloseToTray] = useState(false);
  const [openLogWindow, setOpenLogWindow] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [minecraftJavaPath, setMinecraftJavaPath] = useState("");
  const [minecraftMinMem, setMinecraftMinMem] = useState("");
  const [minecraftMaxMem, setMinecraftMaxMem] = useState("");
  const [minecraftExtraArgs, setMinecraftExtraArgs] = useState("");
  const [minecraftLogin, setMinecraftLogin] = useState<{
    loginId: string;
    userCode: string;
    verificationUri: string;
    interval: number;
  } | null>(null);

  useEffect(() => {
    if (!config) return;
    setEnableDiscord(config.enable_discord_rpc ?? true);
    setDiscordShowVersion(config.discord_show_mc_version ?? true);
    setDiscordShowInstance(config.discord_show_instance_name ?? true);
    setCloseToTray(config.close_to_tray_on_launch ?? false);
    setOpenLogWindow(config.open_log_window_on_launch ?? true);
    setMinecraftJavaPath(config.minecraft_java_path ?? "");
    setMinecraftMinMem(config.minecraft_min_memory_mb != null ? String(config.minecraft_min_memory_mb) : "");
    setMinecraftMaxMem(config.minecraft_max_memory_mb != null ? String(config.minecraft_max_memory_mb) : "");
    setMinecraftExtraArgs(config.minecraft_extra_args ?? "");
  }, [config]);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  useEffect(() => {
    if (!minecraftLogin) return;

    const timer = window.setInterval(async () => {
      if (minecraftAuthPoll.isPending) return;
      const status = await minecraftAuthPoll.mutateAsync(minecraftLogin.loginId);
      if (typeof status === "object" && "success" in status) {
        setMinecraftLogin(null);
      }
      if (typeof status === "object" && "error" in status) {
        toast.error(status.error);
        setMinecraftLogin(null);
      }
    }, Math.max(minecraftLogin.interval, 3) * 1000);

    return () => window.clearInterval(timer);
  }, [minecraftAuthPoll, minecraftLogin]);

  const connectionSummary = useMemo(() => {
    const list = connections ?? [];
    const connected = list.filter((item) => item.status === "connected" || item.status === "available" || item.status === "configured").length;
    return { connected, total: list.length };
  }, [connections]);

  const handleSaveSystem = () => {
    saveConfig.mutate({
      enable_discord_rpc: enableDiscord,
      discord_show_mc_version: discordShowVersion,
      discord_show_instance_name: discordShowInstance,
      close_to_tray_on_launch: closeToTray,
      open_log_window_on_launch: openLogWindow,
      minecraft_java_path: minecraftJavaPath.trim() || null,
      minecraft_min_memory_mb: parseMemoryMb(minecraftMinMem),
      minecraft_max_memory_mb: parseMemoryMb(minecraftMaxMem),
      minecraft_extra_args: minecraftExtraArgs.trim() || null,
    });
  };

  const updateSecret = (id: string, value: string) => {
    setSecrets((current) => ({ ...current, [id]: value }));
  };

  const startMicrosoftLogin = async () => {
    const result = await minecraftAuthStart.mutateAsync();
    setMinecraftLogin({
      loginId: result.login_id,
      userCode: result.user_code,
      verificationUri: result.verification_uri,
      interval: result.interval,
    });
    await openUrl(result.verification_uri);
  };

  const apiBusy = saveApiConnection.isPending || validateApiConnection.isPending || removeApiConnection.isPending;

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && setShowSettings(false)}>
        <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[820px] w-[min(1120px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden rounded-lg border-border/80 bg-background p-0 shadow-2xl">
          <DialogHeader className="border-b border-border/70 px-6 py-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-xl">System & APIs</DialogTitle>
                <DialogDescription className="truncate">
                  Core status, OS integrations, external API credentials, updater, and Minecraft runtime.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="border-b border-border/70 bg-secondary/10 p-3 md:border-b-0 md:border-r">
              <div className="grid grid-cols-3 gap-2 md:grid-cols-1">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition md:justify-start",
                        activeTab === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 hidden rounded-md border border-border/70 bg-background/40 p-3 text-xs leading-5 text-muted-foreground md:block">
                <div className="mb-1 font-medium text-foreground">Connection health</div>
                {loadingConnections ? "Loading..." : `${connectionSummary.connected}/${connectionSummary.total} services ready`}
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto p-4 pb-10 sm:p-6">
              {activeTab === "system" && (
                <div className="space-y-6">
                  <section className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <HardDrive className="h-4 w-4" />
                        App version
                      </div>
                      <div className="truncate text-2xl font-semibold">v{appVersion}</div>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <PlugZap className="h-4 w-4" />
                        APIs ready
                      </div>
                      <div className="text-2xl font-semibold">{connectionSummary.connected}/{connectionSummary.total}</div>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        {enableDiscord ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        Discord RPC
                      </div>
                      <div className="text-2xl font-semibold">{enableDiscord ? "Enabled" : "Disabled"}</div>
                    </div>
                  </section>

                  <section className="space-y-4 border-t border-border/70 pt-5">
                    <div>
                      <h3 className="text-sm font-semibold">System integrations</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Tray, updater, Discord presence, and diagnostics stay owned by the Rust core.</p>
                    </div>

                    <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium">Discord Rich Presence</div>
                          <div className="truncate text-sm text-muted-foreground">Show current Minecraft launcher activity to Discord.</div>
                        </div>
                        <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center">
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={enableDiscord}
                            onChange={(event) => setEnableDiscord(event.target.checked)}
                          />
                          <span className="absolute inset-0 rounded-full bg-muted transition peer-checked:bg-primary" />
                          <span className="absolute left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
                        </label>
                      </div>

                      {enableDiscord && (
                        <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
                          <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
                            <span className="text-muted-foreground">Show the Minecraft version while in game</span>
                            <input
                              type="checkbox"
                              checked={discordShowVersion}
                              onChange={(event) => setDiscordShowVersion(event.target.checked)}
                              className="h-4 w-4 accent-[var(--primary,#6d5df6)]"
                            />
                          </label>
                          <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
                            <span className="text-muted-foreground">Show the instance name while in game</span>
                            <input
                              type="checkbox"
                              checked={discordShowInstance}
                              onChange={(event) => setDiscordShowInstance(event.target.checked)}
                              className="h-4 w-4 accent-[var(--primary,#6d5df6)]"
                            />
                          </label>
                          <p className="text-xs text-muted-foreground">Privacy: server addresses are never shared; disable these to hide the version and instance name too.</p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-secondary/10 p-4">
                      <div className="min-w-0">
                        <div className="font-medium">Close to tray while playing</div>
                        <div className="truncate text-sm text-muted-foreground">Hide the launcher when the game starts; it comes back when the game ends.</div>
                      </div>
                      <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={closeToTray}
                          onChange={(event) => setCloseToTray(event.target.checked)}
                        />
                        <span className="absolute inset-0 rounded-full bg-muted transition peer-checked:bg-primary" />
                        <span className="absolute left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
                      </label>
                    </div>

                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-secondary/10 p-4">
                      <div className="min-w-0">
                        <div className="font-medium">Open the Kiza Manager log window on launch</div>
                        <div className="truncate text-sm text-muted-foreground">Show the separate console window with live game activity and logs when a game starts.</div>
                      </div>
                      <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={openLogWindow}
                          onChange={(event) => setOpenLogWindow(event.target.checked)}
                        />
                        <span className="absolute inset-0 rounded-full bg-muted transition peer-checked:bg-primary" />
                        <span className="absolute left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
                      </label>
                    </div>

                    <UpdaterPanel />
                  </section>

                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveSystem}
                      disabled={saveConfig.isPending}
                      className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saveConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save system settings
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "apis" && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold">API connections</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Secrets are stored in the OS credential vault; JSON config only keeps non-sensitive preferences.</p>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-secondary/10 px-4">
                    {loadingConnections && (
                      <div className="space-y-3 py-5">
                        <div className="h-12 animate-pulse rounded-md bg-secondary/50" />
                        <div className="h-12 animate-pulse rounded-md bg-secondary/40" />
                        <div className="h-12 animate-pulse rounded-md bg-secondary/30" />
                      </div>
                    )}

                    {connections?.map((connection) => (
                      <ApiConnectionRow
                        key={connection.id}
                        connection={connection}
                        secret={secrets[connection.id] ?? ""}
                        onSecretChange={(value) => updateSecret(connection.id, value)}
                        onSave={() => saveApiConnection.mutate({ provider: connection.id, secret: secrets[connection.id] ?? "" })}
                        onValidate={() => validateApiConnection.mutate({ provider: connection.id, secret: secrets[connection.id] || null })}
                        onRemove={() => removeApiConnection.mutate(connection.id)}
                        busy={apiBusy}
                      />
                    ))}
                  </div>

                  <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">Minecraft accounts</div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {minecraftAccount
                            ? `Active account: ${minecraftAccount.username}. Tokens are stored in the OS credential vault.`
                            : "Add a Microsoft account with device-code auth. Kiza Launcher Alpha never sees your password."}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {minecraftAccount && (
                          <button
                            onClick={() => minecraftLogout.mutate()}
                            disabled={minecraftLogout.isPending}
                            className="inline-flex h-10 items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 text-sm font-medium text-red-200 transition hover:bg-red-500/15 disabled:opacity-50"
                          >
                            {minecraftLogout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            Disconnect all
                          </button>
                        )}
                        <button
                          onClick={startMicrosoftLogin}
                          disabled={minecraftAuthStart.isPending || !!minecraftLogin}
                          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                        >
                          {minecraftAuthStart.isPending || minecraftLogin ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                          Add account
                        </button>
                      </div>
                    </div>

                    {(minecraftAccounts ?? []).length > 0 && (
                      <div className="mt-4 grid gap-2">
                        {(minecraftAccounts ?? []).map((account) => {
                          const active = minecraftAccount?.uuid === account.uuid;
                          return (
                            <div key={account.uuid} className="grid gap-3 rounded-md border border-border/70 bg-background/45 p-3 md:grid-cols-[auto_minmax(0,1fr)_auto]">
                              <div className="h-12 w-12 overflow-hidden rounded-md border border-border bg-secondary/40">
                                {account.skin_head_url ? (
                                  <SkinHead url={account.skin_head_url} className="h-full w-full" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-sm font-semibold">{account.username.slice(0, 2).toUpperCase()}</div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="truncate text-sm font-semibold">{account.username}</span>
                                  {active && <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">Active</span>}
                                </div>
                                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{account.uuid}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {!active && (
                                  <button
                                    onClick={() => setActiveMinecraftAccount.mutate(account.uuid)}
                                    disabled={setActiveMinecraftAccount.isPending}
                                    className="h-9 rounded-md border border-border bg-secondary/30 px-3 text-sm transition hover:bg-secondary disabled:opacity-50"
                                  >
                                    Use
                                  </button>
                                )}
                                <button
                                  onClick={() => removeMinecraftAccount.mutate(account.uuid)}
                                  disabled={removeMinecraftAccount.isPending}
                                  className="h-9 rounded-md border border-red-500/30 bg-red-500/10 px-3 text-sm text-red-200 transition hover:bg-red-500/15 disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {minecraftLogin && (
                      <div className="mt-4 grid gap-3 rounded-md border border-border/70 bg-background/50 p-3 md:grid-cols-[1fr_auto]">
                        <div>
                          <div className="text-xs font-medium uppercase text-muted-foreground">
                            {minecraftLogin.userCode ? "Microsoft code" : "Browser login"}
                          </div>
                          {minecraftLogin.userCode && <div className="mt-1 font-mono text-2xl font-semibold tracking-normal">{minecraftLogin.userCode}</div>}
                          <p className="mt-1 text-xs text-muted-foreground">
                            Finish Microsoft login in your browser. Kiza Launcher Alpha will detect the local callback automatically.
                          </p>
                        </div>
                        <button
                          onClick={() => openUrl(minecraftLogin.verificationUri)}
                          className="h-10 self-center rounded-md border border-border bg-secondary/30 px-3 text-sm font-medium transition hover:bg-secondary"
                        >
                          Open again
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "minecraft" && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold">Minecraft runtime</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Kiza installs the exact Java version each instance needs automatically at launch. You can pre-install the common runtimes here so the first launch is faster.</p>
                  </div>

                  <div className="grid gap-4 rounded-lg border border-border/70 bg-secondary/10 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border/70 bg-background/40 p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{runtime?.valid ? "Java 21 runtime ready" : "Java 21 runtime not installed"}</div>
                        <p className="mt-1 text-sm text-muted-foreground">{runtime?.message ?? "Checking Java runtime..."}</p>
                        {runtime?.java_path && <p className="mt-2 truncate font-mono text-xs text-muted-foreground">{runtime.java_path}</p>}
                      </div>
                      <button
                        onClick={() => refetchRuntime()}
                        className="h-10 rounded-md border border-border bg-secondary/30 px-3 text-sm font-medium transition hover:bg-secondary active:scale-[0.96]"
                      >
                        Refresh
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Pre-install runtimes</div>
                      <div className="flex flex-wrap gap-2">
                        {[17, 21, 25].map((major) => (
                          <button
                            key={major}
                            onClick={() => installRuntime.mutate({ mcVersion: null, javaMajor: major }, { onSuccess: () => refetchRuntime() })}
                            disabled={installRuntime.isPending}
                            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 text-sm font-medium transition hover:bg-secondary disabled:opacity-50 active:scale-[0.96]"
                          >
                            {installRuntime.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            Java {major}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">Java 17 (up to MC 1.20.4), Java 21 (1.20.5-1.21.x), Java 25 (recent snapshots and 26.x).</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Optional Java override</label>
                      <input
                        value={minecraftJavaPath}
                        onChange={(event) => setMinecraftJavaPath(event.target.value)}
                        placeholder="Managed runtime is preferred; override only for testing"
                        className={fieldClass()}
                      />
                      <p className="text-xs text-muted-foreground">Leave empty to use the managed runtime or Java found on PATH.</p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Minimum RAM (MB)</label>
                        <input
                          value={minecraftMinMem}
                          onChange={(event) => setMinecraftMinMem(event.target.value)}
                          placeholder="Auto"
                          inputMode="numeric"
                          className={fieldClass()}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Maximum RAM (MB)</label>
                        <input
                          value={minecraftMaxMem}
                          onChange={(event) => setMinecraftMaxMem(event.target.value)}
                          placeholder="Auto (sized from system RAM)"
                          inputMode="numeric"
                          className={fieldClass()}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Extra JVM arguments</label>
                      <input
                        value={minecraftExtraArgs}
                        onChange={(event) => setMinecraftExtraArgs(event.target.value)}
                        placeholder="-XX:MaxGCPauseMillis=40 (optional)"
                        className={fieldClass()}
                      />
                      <p className="text-xs text-muted-foreground">Appended after the performance profile arguments. Leave empty for auto mode.</p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      {(performanceProfiles ?? []).map((profile) => (
                        <div key={profile.id} className="rounded-md border border-border/70 bg-background/40 p-3">
                          <div className="text-sm font-semibold">{profile.label}</div>
                          <p className="mt-2 min-h-16 text-sm leading-5 text-muted-foreground">{profile.description}</p>
                          <div className="mt-3 font-mono text-xs text-muted-foreground">
                            {profile.min_memory_mb}M - {profile.max_memory_mb}M
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveSystem}
                      disabled={saveConfig.isPending}
                      className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saveConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save Minecraft settings
                    </button>
                  </div>
                </div>
              )}
            </main>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}
