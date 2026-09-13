/**
 * Everything the Host page asks the backend, in one place.
 *
 * Polling is deliberate and narrow: the server list refreshes every few
 * seconds while the page is open, a selected server's status a little
 * faster, the console only while its tab is showing and only for the lines
 * it has not seen. Nothing here polls with the page closed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MinecraftLoader } from "./types";
import { formatError, type ModrinthSearchResponse } from "./queries";
import { useConsoleTicks } from "../components/common/HostEventsBridge";

// --- Types -----------------------------------------------------------------

export type ServerState =
  | "offline"
  | "installing"
  | "starting"
  | "online"
  | "stopping"
  | "crashed"
  | "detached";

export interface InstallProgress {
  phase: string;
  message: string;
  done: number;
  total: number | null;
  finished: boolean;
  error: string | null;
  cancelled: boolean;
}

export interface ServerStatus {
  state: ServerState;
  pid: number | null;
  exit_code: number | null;
  started_at_ms: number | null;
  players: string[];
  last_error: string | null;
  install: InstallProgress | null;
}

/** A server this launcher hosts, as the Host page lists it. */
export interface HostedServer {
  id: string;
  name: string;
  description: string;
  mc_version: string;
  loader: MinecraftLoader;
  loader_version: string | null;
  preset: string | null;
  port: number;
  java_major: number | null;
  min_memory_mb: number;
  max_memory_mb: number;
  jvm_args: string[];
  linked_instance_id: string | null;
  created_from: string | null;
  created_at: string;
  updated_at: string | null;
  auto_backup: AutoBackup;
  kiza_address: KizaAddress | null;
  installed: boolean;
  eula_accepted: boolean;
  has_icon: boolean;
  mod_count: number;
  folder: string;
  status: ServerStatus;
}

export type HostedServerSummary = Omit<HostedServer, "status">;

export interface NewHostedServer {
  name: string;
  description?: string;
  mc_version: string;
  loader: MinecraftLoader;
  loader_version?: string | null;
  preset?: string | null;
  port?: number | null;
  java_major?: number | null;
  min_memory_mb?: number | null;
  max_memory_mb?: number | null;
  jvm_args?: string[];
  properties?: Record<string, string>;
  icon_path?: string | null;
  linked_instance_id?: string | null;
  created_from?: string | null;
}

export interface ServerPatch {
  name?: string;
  description?: string;
  java_major?: number | null;
  min_memory_mb?: number;
  max_memory_mb?: number;
  jvm_args?: string[];
  linked_instance_id?: string | null;
  port?: number;
  auto_backup?: AutoBackup;
}

export interface ConsoleLine {
  seq: number;
  at_ms: number;
  stream: "out" | "err" | "in";
  text: string;
}

export interface ServerMetrics {
  uptime_s: number | null;
  memory_bytes: number | null;
  cpu_percent: number | null;
  world_bytes: number;
  port_open: boolean;
}

export interface Reachability {
  port: number;
  local_address: string;
  lan_address: string | null;
  public_address: string | null;
  upnp_available: boolean;
  forwarded: boolean;
  opened_by_kiza: boolean;
  router_external_ip: string | null;
  error: string | null;
}

export interface KizaAddress {
  name: string;
  address: string;
  ip: string;
  port: number;
}

export interface AutoBackup {
  before_start: boolean;
  every_minutes: number;
  keep: number;
}

export interface ServerModUpdate {
  file: string;
  name: string;
  current_version: string;
  new_version: string;
  source: "modrinth" | "curseforge";
  project_id: string;
  version_id: string;
  published: string;
}

export interface KnownProperty {
  key: string;
  label: string;
  kind: "text" | "bool" | "int" | "choice";
  default: string;
  choices: string[];
}

export interface ServerPropertiesView {
  entries: Array<[string, string]>;
  known: KnownProperty[];
}

export interface ListedPlayer {
  uuid: string;
  name: string;
  level?: number | null;
  reason?: string | null;
}

export interface PlayerLists {
  ops: ListedPlayer[];
  whitelist: ListedPlayer[];
  banned: ListedPlayer[];
  whitelist_enabled: boolean;
}

export type PlayerAction = "kick" | "ban" | "pardon" | "op" | "deop" | "whitelist_add" | "whitelist_remove";

export interface ServerMod {
  file: string;
  mod_id: string | null;
  name: string;
  version: string | null;
  bytes: number;
  enabled: boolean;
}

export interface Backup {
  file: string;
  label: string;
  created_at: string;
  bytes: number;
}

export type ModVerdictKind = "server" | "excluded" | "unknown" | "disabled";

export interface ModVerdict {
  id: string;
  name: string;
  version: string;
  files: string[];
  side: "client" | "server" | "both" | null;
  verdict: ModVerdictKind;
  basis: "jar" | "modrinth" | "curseforge" | "none";
  source: string | null;
  project_id: string | null;
}

export interface InstanceAnalysis {
  instance_id: string;
  display_name: string;
  mc_version: string;
  loader: MinecraftLoader;
  loader_version: string | null;
  java_major: number;
  mods: ModVerdict[];
  total: number;
  server_mods: number;
  client_only: number;
  unknown: number;
  disabled: number;
  issues: string[];
  has_config: boolean;
  worlds: Array<{ folder: string; display_name: string; size_bytes: number }>;
}

export interface BuildRequest {
  instance_id: string;
  name: string;
  description?: string;
  mod_ids: string[];
  copy_config: boolean;
  world_folder?: string | null;
  port?: number | null;
  min_memory_mb?: number | null;
  max_memory_mb?: number | null;
  properties?: Record<string, string>;
}

export interface BuildOutcome {
  server: HostedServerSummary;
  mods_copied: number;
  config_copied: boolean;
  world_copied: boolean;
}

export interface SyncDifference {
  mod_id: string;
  name: string;
  kind: "missing_on_server" | "missing_on_client" | "version_mismatch";
  client_version: string | null;
  server_version: string | null;
}

export interface SyncReport {
  instance_id: string;
  differences: SyncDifference[];
  in_step: number;
}

export interface Detection {
  mc_version: string | null;
  loader: MinecraftLoader | null;
  loader_version: string | null;
  mod_count: number;
  level_name: string;
  has_world: boolean;
  has_properties: boolean;
  port: number | null;
  eula_accepted: boolean;
  missing: Array<"mc_version" | "loader" | "loader_version">;
  notes: string[];
}

export interface ImportRequest {
  folder: string;
  name: string;
  mc_version?: string | null;
  loader?: MinecraftLoader | null;
  loader_version?: string | null;
  max_memory_mb?: number | null;
}

export interface CrashFinding {
  title: string;
  detail?: string | null;
  advice?: string | null;
  [key: string]: unknown;
}

export interface CompatIssue {
  severity: string;
  message: string;
}

export interface CompatReport {
  errors: number;
  warnings: number;
  mods: Array<{ file_name: string; name: string | null; issues: CompatIssue[] }>;
}

// --- Keys ------------------------------------------------------------------

export const hostKeys = {
  servers: ["hostedServers"] as const,
  server: (id: string) => ["hostedServer", id] as const,
  status: (id: string) => ["hostedServerStatus", id] as const,
  metrics: (id: string) => ["hostedServerMetrics", id] as const,
  network: (id: string) => ["hostedServerNetwork", id] as const,
  properties: (id: string) => ["hostedServerProperties", id] as const,
  players: (id: string) => ["hostedServerPlayers", id] as const,
  mods: (id: string) => ["hostedServerMods", id] as const,
  compat: (id: string) => ["hostedServerCompat", id] as const,
  backups: (id: string) => ["hostedServerBackups", id] as const,
  icon: (id: string) => ["hostedServerIcon", id] as const,
  crash: (id: string) => ["hostedServerCrash", id] as const,
  sync: (id: string) => ["hostedServerSync", id] as const,
  analysis: (id: string) => ["instanceServerAnalysis", id] as const,
};

/** True while a state is one the page should keep watching. */
export function isBusy(state: ServerState): boolean {
  return state === "installing" || state === "starting" || state === "stopping";
}

export function isUp(state: ServerState): boolean {
  return state === "online" || state === "starting" || state === "stopping" || state === "detached";
}

// --- Registry --------------------------------------------------------------

export function useHostedServers(polling = true) {
  return useQuery({
    queryKey: hostKeys.servers,
    queryFn: async () => await invoke<HostedServer[]>("list_hosted_servers"),
    // Events carry state changes; this catches what an event missed.
    refetchInterval: polling ? 3000 : false,
  });
}

export function useHostedServer(id: string | null) {
  return useQuery({
    queryKey: hostKeys.server(id ?? ""),
    queryFn: async () => await invoke<HostedServer>("get_hosted_server", { serverId: id }),
    enabled: !!id,
    refetchInterval: 2000,
  });
}

function useInvalidateServers() {
  const queryClient = useQueryClient();
  return useCallback(
    (id?: string) => {
      void queryClient.invalidateQueries({ queryKey: hostKeys.servers });
      if (id) void queryClient.invalidateQueries({ queryKey: hostKeys.server(id) });
    },
    [queryClient],
  );
}

export function useCreateHostedServer() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async (server: NewHostedServer) =>
      await invoke<HostedServerSummary>("create_hosted_server", { server }),
    onSuccess: () => {
      invalidate();
      toast.success("Server created");
    },
    onError: (error) => toast.error(`Failed to create the server: ${formatError(error)}`),
  });
}

export function useUpdateHostedServer() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async ({ serverId, patch }: { serverId: string; patch: ServerPatch }) =>
      await invoke<HostedServerSummary>("update_hosted_server", { serverId, patch }),
    onSuccess: (_, { serverId }) => {
      invalidate(serverId);
      toast.success("Server settings saved");
    },
    onError: (error) => toast.error(`Failed to save: ${formatError(error)}`),
  });
}

export function useDeleteHostedServer() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async (serverId: string) => await invoke<void>("delete_hosted_server", { serverId }),
    onSuccess: () => {
      invalidate();
      toast.success("Server deleted");
    },
    onError: (error) => toast.error(`Failed to delete the server: ${formatError(error)}`),
  });
}

export function useCloneHostedServer() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async ({ serverId, name }: { serverId: string; name: string }) =>
      await invoke<HostedServerSummary>("clone_hosted_server", { serverId, name }),
    onSuccess: () => {
      invalidate();
      toast.success("Server cloned");
    },
    onError: (error) => toast.error(`Failed to clone: ${formatError(error)}`),
  });
}

export function useOpenHostedServerFolder() {
  return useMutation({
    mutationFn: async ({ serverId, subfolder }: { serverId: string; subfolder?: string }) =>
      await invoke<void>("open_hosted_server_folder", { serverId, subfolder: subfolder ?? null }),
    onError: (error) => toast.error(`Failed to open folder: ${formatError(error)}`),
  });
}

export function useAcceptEula() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async (serverId: string) => await invoke<void>("accept_hosted_server_eula", { serverId }),
    onSuccess: (_, serverId) => invalidate(serverId),
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useSetServerIcon() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async ({ serverId, sourcePath }: { serverId: string; sourcePath: string }) =>
      await invoke<void>("set_hosted_server_icon", { serverId, sourcePath }),
    onSuccess: (_, { serverId }) => {
      invalidate(serverId);
      void queryClient.invalidateQueries({ queryKey: hostKeys.icon(serverId) });
    },
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useServerIcon(id: string | null, hasIcon: boolean) {
  return useQuery({
    queryKey: hostKeys.icon(id ?? ""),
    queryFn: async () => await invoke<string | null>("hosted_server_icon", { serverId: id }),
    enabled: !!id && hasIcon,
    staleTime: 60_000,
  });
}

// --- Process ---------------------------------------------------------------

export function useServerStatus(id: string | null, fast = false) {
  return useQuery({
    queryKey: hostKeys.status(id ?? ""),
    queryFn: async () => await invoke<ServerStatus>("hosted_server_status", { serverId: id }),
    enabled: !!id,
    refetchInterval: fast ? 1000 : 2500,
  });
}

/** Start; a rejection of "eula" means the dialog has to be shown first. */
export function useStartServer() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async (serverId: string) => await invoke<ServerStatus>("start_hosted_server", { serverId }),
    onSuccess: (_, serverId) => invalidate(serverId),
    onError: (error, serverId) => {
      if (String(error) === "eula") return;
      toast.error(`Could not start ${serverId}: ${formatError(error)}`);
    },
  });
}

export function useStopServer() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async (serverId: string) => await invoke<void>("stop_hosted_server", { serverId }),
    onSuccess: (_, serverId) => invalidate(serverId),
    onError: (error) => toast.error(`Could not stop: ${formatError(error)}`),
  });
}

export function useKillServer() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async (serverId: string) => await invoke<void>("kill_hosted_server", { serverId }),
    onSuccess: (_, serverId) => invalidate(serverId),
    onError: (error) => toast.error(`Could not kill: ${formatError(error)}`),
  });
}

export function useRestartServer() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async (serverId: string) => await invoke<ServerStatus>("restart_hosted_server", { serverId }),
    onSuccess: (_, serverId) => invalidate(serverId),
    onError: (error) => {
      if (String(error) === "eula") return;
      toast.error(`Could not restart: ${formatError(error)}`);
    },
  });
}

export function useInstallServer() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async (serverId: string) => await invoke<void>("install_hosted_server", { serverId }),
    onSuccess: (_, serverId) => invalidate(serverId),
    onError: (error) => toast.error(`Could not install: ${formatError(error)}`),
  });
}

export function useCancelInstall() {
  return useMutation({
    mutationFn: async (serverId: string) => await invoke<boolean>("cancel_hosted_server_install", { serverId }),
  });
}

/**
 * The console, accumulated: each poll asks for what came after the last
 * line seen, so a busy server costs one small request a second and the
 * page keeps at most as many lines as the backend does.
 */
export function useServerConsole(id: string | null, active: boolean) {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const lastSeq = useRef(0);
  const serverRef = useRef(id);

  useEffect(() => {
    if (serverRef.current !== id) {
      serverRef.current = id;
      lastSeq.current = 0;
      setLines([]);
    }
  }, [id]);

  const poll = useCallback(async () => {
    if (!id) return;
    const fresh = await invoke<ConsoleLine[]>("hosted_server_console", { serverId: id, after: lastSeq.current });
    if (fresh.length === 0) return;
    lastSeq.current = fresh[fresh.length - 1].seq;
    setLines((current) => {
      // A cleared console restarts its numbering below what we have.
      const base = fresh[0].seq <= (current[current.length - 1]?.seq ?? 0) ? [] : current;
      const merged = [...base, ...fresh];
      return merged.length > 2000 ? merged.slice(merged.length - 2000) : merged;
    });
  }, [id]);

  // Every second as the floor; the moment the runtime says there is news
  // as the usual case.
  const tick = useConsoleTicks((state) => (id ? state.ticks[id] ?? 0 : 0));
  useEffect(() => {
    if (!id || !active) return;
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => window.clearInterval(timer);
  }, [id, active, poll]);
  useEffect(() => {
    if (!id || !active || tick === 0) return;
    void poll();
  }, [tick, id, active, poll]);

  const clear = useCallback(async () => {
    if (!id) return;
    await invoke<void>("clear_hosted_server_console", { serverId: id });
    lastSeq.current = 0;
    setLines([]);
  }, [id]);

  return { lines, refresh: poll, clear };
}

export function useSendServerCommand() {
  return useMutation({
    mutationFn: async ({ serverId, command }: { serverId: string; command: string }) =>
      await invoke<void>("send_hosted_server_command", { serverId, command }),
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useServerMetrics(id: string | null, active: boolean) {
  return useQuery({
    queryKey: hostKeys.metrics(id ?? ""),
    queryFn: async () => await invoke<ServerMetrics>("hosted_server_metrics", { serverId: id }),
    enabled: !!id && active,
    refetchInterval: active ? 5000 : false,
  });
}

/** This machine and the LAN, cheaply; the internet and the router on request. */
export function useServerNetwork(id: string | null, withPublic: boolean) {
  return useQuery({
    queryKey: [...hostKeys.network(id ?? ""), withPublic],
    queryFn: async () => await invoke<Reachability>("hosted_server_network", { serverId: id, withPublic }),
    enabled: !!id,
    staleTime: withPublic ? 60_000 : 30_000,
  });
}

export function useOpenServerPort() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (serverId: string) => await invoke<Reachability>("open_hosted_server_port", { serverId }),
    onSuccess: (reach, serverId) => {
      queryClient.setQueryData([...hostKeys.network(serverId), true], reach);
      toast.success(`Port ${reach.port} forwarded`);
    },
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useClaimServerAddress() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async ({ serverId, name }: { serverId: string; name: string }) =>
      await invoke<KizaAddress>("claim_hosted_server_address", { serverId, name }),
    onSuccess: (address, { serverId }) => {
      invalidate(serverId);
      toast.success(address.address);
    },
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useReleaseServerAddress() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async (serverId: string) => await invoke<void>("release_hosted_server_address", { serverId }),
    onSuccess: (_, serverId) => invalidate(serverId),
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useCloseServerPort() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (serverId: string) => await invoke<Reachability>("close_hosted_server_port", { serverId }),
    onSuccess: (_, serverId) => void queryClient.invalidateQueries({ queryKey: hostKeys.network(serverId) }),
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useServerCrash(id: string | null, crashed: boolean) {
  return useQuery({
    queryKey: hostKeys.crash(id ?? ""),
    queryFn: async () => await invoke<CrashFinding[]>("diagnose_hosted_server_crash", { serverId: id }),
    enabled: !!id && crashed,
  });
}

export function useServerLog(id: string | null, active: boolean) {
  return useQuery({
    queryKey: ["hostedServerLog", id ?? ""],
    queryFn: async () => await invoke<string>("hosted_server_log", { serverId: id, lines: 400 }),
    enabled: !!id && active,
  });
}

// --- Properties ------------------------------------------------------------

export function useServerProperties(id: string | null) {
  return useQuery({
    queryKey: hostKeys.properties(id ?? ""),
    queryFn: async () => await invoke<ServerPropertiesView>("hosted_server_properties", { serverId: id }),
    enabled: !!id,
  });
}

export function useSaveServerProperties() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async ({ serverId, changes }: { serverId: string; changes: Record<string, string> }) =>
      await invoke<ServerPropertiesView>("save_hosted_server_properties", { serverId, changes }),
    onSuccess: (view, { serverId }) => {
      queryClient.setQueryData(hostKeys.properties(serverId), view);
      void queryClient.invalidateQueries({ queryKey: hostKeys.network(serverId) });
      invalidate(serverId);
      toast.success("server.properties saved");
    },
    onError: (error) => toast.error(`Failed to save: ${formatError(error)}`),
  });
}

// --- Players ---------------------------------------------------------------

export function useServerPlayers(id: string | null) {
  return useQuery({
    queryKey: hostKeys.players(id ?? ""),
    queryFn: async () => await invoke<PlayerLists>("hosted_server_players", { serverId: id }),
    enabled: !!id,
    refetchInterval: 6000,
  });
}

export function usePlayerAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ serverId, action, player, reason }: { serverId: string; action: PlayerAction; player: string; reason?: string }) =>
      await invoke<void>("hosted_server_player_action", { serverId, action, player, reason: reason ?? null }),
    onSuccess: (_, { serverId }) => {
      // The server writes its lists a moment after the command.
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: hostKeys.players(serverId) }), 800);
    },
    onError: (error) => toast.error(formatError(error)),
  });
}

// --- Mods ------------------------------------------------------------------

export function useServerMods(id: string | null) {
  return useQuery({
    queryKey: hostKeys.mods(id ?? ""),
    queryFn: async () => await invoke<ServerMod[]>("hosted_server_mods", { serverId: id }),
    enabled: !!id,
  });
}

export function useServerModCompat(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: hostKeys.compat(id ?? ""),
    queryFn: async () => await invoke<CompatReport>("hosted_server_mod_compatibility", { serverId: id }),
    enabled: !!id && enabled,
  });
}

function useInvalidateMods() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateServers();
  return useCallback(
    (id: string) => {
      void queryClient.invalidateQueries({ queryKey: hostKeys.mods(id) });
      void queryClient.invalidateQueries({ queryKey: hostKeys.compat(id) });
      void queryClient.invalidateQueries({ queryKey: hostKeys.sync(id) });
      invalidate(id);
    },
    [queryClient, invalidate],
  );
}

export function useRemoveServerMod() {
  const invalidate = useInvalidateMods();
  return useMutation({
    mutationFn: async ({ serverId, file }: { serverId: string; file: string }) =>
      await invoke<void>("remove_hosted_server_mod", { serverId, file }),
    onSuccess: (_, { serverId }) => invalidate(serverId),
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useSetServerModEnabled() {
  const invalidate = useInvalidateMods();
  return useMutation({
    mutationFn: async ({ serverId, file, enabled }: { serverId: string; file: string; enabled: boolean }) =>
      await invoke<string>("set_hosted_server_mod_enabled", { serverId, file, enabled }),
    onSuccess: (_, { serverId }) => invalidate(serverId),
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useAddServerModFile() {
  const invalidate = useInvalidateMods();
  return useMutation({
    mutationFn: async ({ serverId, sourcePath }: { serverId: string; sourcePath: string }) =>
      await invoke<ServerMod>("add_hosted_server_mod_file", { serverId, sourcePath }),
    onSuccess: (mod, { serverId }) => {
      invalidate(serverId);
      toast.success(`${mod.name} added`);
    },
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useInstallServerMod() {
  const invalidate = useInvalidateMods();
  return useMutation({
    mutationFn: async ({ serverId, source, projectId, versionId }: { serverId: string; source: "modrinth" | "curseforge"; projectId: string; versionId?: string }) =>
      await invoke<ServerMod>("install_hosted_server_mod", { serverId, source, projectId, versionId: versionId ?? null }),
    onSuccess: (mod, { serverId }) => {
      invalidate(serverId);
      toast.success(`${mod.name} installed`);
    },
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useCheckServerModUpdates() {
  return useMutation({
    mutationFn: async (serverId: string) =>
      await invoke<ServerModUpdate[]>("check_hosted_server_mod_updates", { serverId }),
    onError: (error) => toast.error(`Update check failed: ${formatError(error)}`),
  });
}

export function useApplyServerModUpdate() {
  const invalidate = useInvalidateMods();
  return useMutation({
    mutationFn: async ({ serverId, update }: { serverId: string; update: ServerModUpdate }) =>
      await invoke<ServerMod>("apply_hosted_server_mod_update", { serverId, update }),
    onSuccess: (mod, { serverId }) => {
      invalidate(serverId);
      toast.success(`${mod.name} updated`);
    },
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useSearchModsForServer() {
  return useMutation({
    mutationFn: async ({ serverId, query }: { serverId: string; query: string }) =>
      await invoke<ModrinthSearchResponse>("search_mods_for_hosted_server", { serverId, query, limit: 12 }),
    onError: (error) => toast.error(`Search failed: ${formatError(error)}`),
  });
}

// --- Backups ---------------------------------------------------------------

export function useServerBackups(id: string | null) {
  return useQuery({
    queryKey: hostKeys.backups(id ?? ""),
    queryFn: async () => await invoke<Backup[]>("hosted_server_backups", { serverId: id }),
    enabled: !!id,
  });
}

export function useCreateBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ serverId, label }: { serverId: string; label: string }) =>
      await invoke<Backup>("create_hosted_server_backup", { serverId, label }),
    onSuccess: (_, { serverId }) => {
      void queryClient.invalidateQueries({ queryKey: hostKeys.backups(serverId) });
      toast.success("Backup created");
    },
    onError: (error) => toast.error(`Backup failed: ${formatError(error)}`),
  });
}

export function useRestoreBackup() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateMods();
  return useMutation({
    mutationFn: async ({ serverId, file }: { serverId: string; file: string }) =>
      await invoke<Backup>("restore_hosted_server_backup", { serverId, file }),
    onSuccess: (_, { serverId }) => {
      void queryClient.invalidateQueries({ queryKey: hostKeys.backups(serverId) });
      void queryClient.invalidateQueries({ queryKey: hostKeys.properties(serverId) });
      void queryClient.invalidateQueries({ queryKey: hostKeys.players(serverId) });
      invalidate(serverId);
      toast.success("Backup restored");
    },
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useDeleteBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ serverId, file }: { serverId: string; file: string }) =>
      await invoke<void>("delete_hosted_server_backup", { serverId, file }),
    onSuccess: (_, { serverId }) => void queryClient.invalidateQueries({ queryKey: hostKeys.backups(serverId) }),
    onError: (error) => toast.error(formatError(error)),
  });
}

// --- From an instance, sync, import ----------------------------------------

export function useInstanceAnalysis(instanceId: string | null) {
  return useQuery({
    queryKey: hostKeys.analysis(instanceId ?? ""),
    queryFn: async () => await invoke<InstanceAnalysis>("analyse_instance_for_server", { instanceId }),
    enabled: !!instanceId,
    staleTime: 30_000,
  });
}

export function useBuildFromInstance() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async (request: BuildRequest) => await invoke<BuildOutcome>("build_server_from_instance", { request }),
    onSuccess: () => {
      invalidate();
      toast.success("Server built from the instance");
    },
    onError: (error) => toast.error(`Failed to build the server: ${formatError(error)}`),
  });
}

export function useServerSync(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: hostKeys.sync(id ?? ""),
    queryFn: async () => await invoke<SyncReport>("compare_hosted_server_with_instance", { serverId: id, instanceId: null }),
    enabled: !!id && enabled,
  });
}

export function useDetectServerFolder() {
  return useMutation({
    mutationFn: async (folder: string) => await invoke<Detection>("detect_server_folder", { folder }),
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useImportServer() {
  const invalidate = useInvalidateServers();
  return useMutation({
    mutationFn: async (request: ImportRequest) => await invoke<HostedServerSummary>("import_hosted_server", { request }),
    onSuccess: () => {
      invalidate();
      toast.success("Server imported");
    },
    onError: (error) => toast.error(`Import failed: ${formatError(error)}`),
  });
}
