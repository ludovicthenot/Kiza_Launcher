import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { DeleteModResult, GameInstanceSummary, Mod, ProfileConfig, GameInstance, DownloadJob, MinecraftLoader } from './types'
import { toast } from 'sonner'

// Helper to format error messages
function formatError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const typed = error as { message?: unknown; action_hint?: unknown };
    const message = typeof typed.message === 'string' ? typed.message : String(error);
    const hint = typeof typed.action_hint === 'string' ? ` ${typed.action_hint}` : '';
    return `${message}${hint}`;
  }

  const msg = String(error);
  
  // Map common backend errors to user-friendly messages
  if (msg.includes("Mod not found")) return "Mod not found. It may have been removed manually.";
  if (msg.includes("Archive file not found")) return "Archive file not found. Check the path.";
  if (msg.includes("Cannot deploy to invalid instance")) return "Cannot deploy: the game instance is invalid or its folder is missing.";
  if (msg.includes("Game ID mismatch")) return "Configuration conflict: this instance does not match the expected game.";
  if (msg.includes("Failed to delete mod files")) return "Delete failed: files are locked or access was denied.";
  if (msg.includes("Profile not found")) return "Profile not found.";
  if (msg.includes("Instance is not valid")) return "Invalid instance. Please check the game folder.";
  if (msg.includes("Network error") || msg.includes("fetch")) return "Network error. Check your internet connection.";
  
  // Fallback for technical errors
  return msg;
}

// Keys for React Query cache
export const queryKeys = {
  instances: ['instances'] as const,
  mods: (instanceId: string) => ['mods', instanceId] as const,
  profiles: (instanceId: string) => ['profiles', instanceId] as const,
  activeProfile: (instanceId: string) => ['activeProfile', instanceId] as const,
  verify: (instanceId: string) => ['verify', instanceId] as const,
  conflicts: (instanceId: string) => ['conflicts', instanceId] as const,
  config: ['config'] as const,
  apiConnections: ['apiConnections'] as const,
  firstRunSetup: ['firstRunSetup'] as const,
  downloads: ['downloads'] as const,
  minecraftVersions: ['minecraftVersions'] as const,
  minecraftLoaderVersions: (mcVersion: string, loader: MinecraftLoader) => ['minecraftLoaderVersions', mcVersion, loader] as const,
  minecraftInstall: (instanceId: string) => ['minecraftInstall', instanceId] as const,
  minecraftAccount: ['minecraftAccount'] as const,
  minecraftAccounts: ['minecraftAccounts'] as const,
  offlineAccounts: ['offlineAccounts'] as const,
  servers: ['servers'] as const,
  instanceCover: (instanceId: string) => ['instanceCover', instanceId] as const,
  playHistory: ['playHistory'] as const,
  worlds: (instanceId: string) => ['worlds', instanceId] as const,
  worldCheckpoints: (instanceId: string) => ['worldCheckpoints', instanceId] as const,
  performanceReport: (instanceId: string) => ['performanceReport', instanceId] as const,
  minecraftRuntime: (mcVersion?: string | null) => ['minecraftRuntime', mcVersion ?? 'default'] as const,
  performanceProfiles: ['performanceProfiles'] as const,
  instancePerformanceProfile: (instanceId: string) => ['instancePerformanceProfile', instanceId] as const,
  runningInstances: ['runningInstances'] as const,
  launchStatus: (instanceId: string) => ['launchStatus', instanceId] as const,
}

// --- Config ---

export interface AppConfig {
  enable_discord_rpc: boolean;
  discord_show_mc_version: boolean;
  discord_show_instance_name: boolean;
  close_to_tray_on_launch: boolean;
  /** Closing the window hides the launcher instead of quitting it. */
  close_to_tray: boolean;
  /** "tray" or "quit". */
  close_button_action: string;
  quit_after_launch: boolean;
  verify_before_launch: boolean;
  /** "report", "silent" or "safe_mode". */
  crash_action: string;
  auto_download_updates: boolean;
  update_channel: string;
  open_log_window_on_launch: boolean;
  minecraft_java_path: string | null;
  minecraft_min_memory_mb: number | null;
  minecraft_max_memory_mb: number | null;
  minecraft_extra_args: string | null;
  minecraft_releases_only: boolean;
  /** How many files may download at once. The queue clamps it to its own range. */
  download_concurrency: number;
  notify_background: boolean;
  notify_update_ready: boolean;
  notify_downloads_finished: boolean;
  /** "system", "24h" or "12h". */
  time_format: string;
  /** "system", "dmy", "mdy" or "ymd". */
  date_format: string;
}

/** One measured directory in the storage report. */
export interface StorageEntry {
  id: string;
  bytes: number;
  /** Whether Kiza offers to delete it. Worlds and instances never are. */
  reclaimable: boolean;
}

export interface StorageReport {
  entries: StorageEntry[];
  total_bytes: number;
  reclaimable_bytes: number;
}

export interface ApiConnectionStatus {
  id: string;
  label: string;
  kind: string;
  configured: boolean;
  status: string;
  detail: string;
  recoverable: boolean;
  action_hint: string | null;
}

export interface MinecraftAccount {
  uuid: string;
  username: string;
  skin_url: string | null;
  skin_head_url: string | null;
}

export interface MinecraftAuthStartResult {
  login_id: string;
  user_code: string;
  verification_uri: string;
  message: string;
  expires_in: number;
  interval: number;
  authority: string;
  redirect_uri: string;
  scopes: string[];
}

export type MinecraftAuthPollStatus =
  | 'pending'
  | { success: MinecraftAccount }
  | { error: string };

export interface FirstRunSetupState {
  schema_version: number;
  setup_version: number;
  setup_completed: boolean;
  completed_at: string | null;
  selected_performance_profile: string;
  skipped_steps: string[];
}

export interface MinecraftRuntimeStatus {
  required_major: number;
  java_path: string | null;
  source: string;
  installed: boolean;
  valid: boolean;
  message: string;
}

export interface MinecraftPerformanceProfile {
  id: string;
  label: string;
  description: string;
  min_memory_mb: number;
  max_memory_mb: number;
  jvm_args: string[];
}

export interface InstancePerformanceProfile {
  instance_id: string;
  profile_id: string;
}

export function updateDiscordStatus(instanceId: string | null) {
    invoke('update_discord_status', { instanceId }).catch(console.error);
}

export function useAppConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: async () => {
      return await invoke<AppConfig>('get_app_config')
    },
  })
}

export function useSaveAppConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (config: AppConfig) => {
      return await invoke<void>('save_app_config', { config })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config })
      queryClient.invalidateQueries({ queryKey: queryKeys.apiConnections })
      toast.success("Settings saved")
    },
    onError: (error) => toast.error(`Failed to save settings: ${formatError(error)}`)
  })
}

export function useApiConnections() {
  return useQuery({
    queryKey: queryKeys.apiConnections,
    queryFn: async () => {
      return await invoke<ApiConnectionStatus[]>('get_api_connections')
    },
  })
}

export function useSaveApiConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ provider, secret }: { provider: string; secret: string }) => {
      return await invoke<ApiConnectionStatus>('save_api_connection', { provider, secret })
    },
    onSuccess: (connection) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.apiConnections })
      toast.success(`${connection.label} connected`)
    },
    onError: (error) => toast.error(`Connection failed: ${formatError(error)}`)
  })
}

export function useValidateApiConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ provider, secret }: { provider: string; secret?: string | null }) => {
      return await invoke<ApiConnectionStatus>('validate_api_connection', { provider, secret })
    },
    onSuccess: (connection) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.apiConnections })
      toast.success(`${connection.label}: ${connection.status}`)
    },
    onError: (error) => toast.error(`Validation failed: ${formatError(error)}`)
  })
}

export function useRemoveApiConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (provider: string) => {
      return await invoke<void>('remove_api_connection', { provider })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.apiConnections })
      toast.success("Connection removed")
    },
    onError: (error) => toast.error(`Remove failed: ${formatError(error)}`)
  })
}

export function useFirstRunSetup() {
  return useQuery({
    queryKey: queryKeys.firstRunSetup,
    queryFn: async () => {
      return await invoke<FirstRunSetupState>('get_first_run_setup')
    },
  })
}

export function useCompleteFirstRunSetup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ selectedPerformanceProfile, skippedSteps }: { selectedPerformanceProfile: string; skippedSteps: string[] }) => {
      return await invoke<FirstRunSetupState>('complete_first_run_setup', {
        selectedPerformanceProfile,
        skippedSteps,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.firstRunSetup })
      toast.success("Initial setup completed")
    },
    onError: (error) => toast.error(`Setup failed: ${formatError(error)}`)
  })
}

export function useMinecraftAccount() {
  return useQuery({
    queryKey: queryKeys.minecraftAccount,
    queryFn: async () => {
      return await invoke<MinecraftAccount | null>('minecraft_auth_get_account')
    },
  })
}

export function useMinecraftAuthStart() {
  return useMutation({
    mutationFn: async () => {
      return await invoke<MinecraftAuthStartResult>('minecraft_auth_start')
    },
    onError: (error) => toast.error(`Microsoft login failed: ${formatError(error)}`)
  })
}

export function useMinecraftAuthPoll() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (loginId: string) => {
      return await invoke<MinecraftAuthPollStatus>('minecraft_auth_poll', { loginId })
    },
    onSuccess: (status) => {
      if (typeof status === 'object' && 'success' in status) {
        queryClient.invalidateQueries({ queryKey: queryKeys.minecraftAccount })
        queryClient.invalidateQueries({ queryKey: queryKeys.minecraftAccounts })
        queryClient.invalidateQueries({ queryKey: queryKeys.apiConnections })
        toast.success(`Connected as ${status.success.username}`)
      }
    },
    onError: (error) => toast.error(`Microsoft login failed: ${formatError(error)}`)
  })
}

export function useMinecraftLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      return await invoke<void>('minecraft_auth_logout')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftAccount })
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftAccounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.apiConnections })
      toast.success("Microsoft account disconnected")
    },
    onError: (error) => toast.error(`Logout failed: ${formatError(error)}`)
  })
}

export function useMinecraftAccounts() {
  return useQuery({
    queryKey: queryKeys.minecraftAccounts,
    queryFn: async () => {
      return await invoke<MinecraftAccount[]>('minecraft_auth_list_accounts')
    },
  })
}

export function useSetActiveMinecraftAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (uuid: string) => {
      return await invoke<MinecraftAccount>('minecraft_auth_set_active', { uuid })
    },
    onSuccess: (account) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftAccount })
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftAccounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.apiConnections })
      toast.success(`Active Minecraft account: ${account.username}`)
    },
    onError: (error) => toast.error(`Account switch failed: ${formatError(error)}`)
  })
}

export function useRemoveMinecraftAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (uuid: string) => {
      return await invoke<MinecraftAccount[]>('minecraft_auth_remove_account', { uuid })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftAccount })
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftAccounts })
      queryClient.invalidateQueries({ queryKey: queryKeys.apiConnections })
      toast.success("Minecraft account removed")
    },
    onError: (error) => toast.error(`Account remove failed: ${formatError(error)}`)
  })
}

// --- Instances ---

export function useInstances() {
  return useQuery({
    queryKey: queryKeys.instances,
    queryFn: async () => {
      return await invoke<GameInstanceSummary[]>('list_game_instances')
    },
  })
}

export function useAddInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (path: string) => {
      return await invoke<GameInstance>('add_game_instance', { installPath: path })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      toast.success("Game instance added successfully")
    },
    onError: (error) => toast.error(`Failed to add instance: ${formatError(error)}`)
  })
}

export function useVerifyInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<GameInstance>('verify_game_instance', { instanceId })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      if (data.status === 'Valid') {
        toast.success("Instance verified: Valid")
      } else {
        toast.warning(`Instance verification: ${data.status}`)
      }
    },
    onError: (error) => toast.error(`Verification failed: ${formatError(error)}`)
  })
}

// --- Mods ---

export function useMods(instanceId: string | null) {
  return useQuery({
    queryKey: queryKeys.mods(instanceId!),
    queryFn: async () => {
      return await invoke<Mod[]>('get_installed_mods', { instanceId })
    },
    enabled: !!instanceId,
  })
}

// --- Downloads ---

const ACTIVE_DOWNLOAD_STATES = ['Queued', 'Resolving', 'Downloading', 'Retrying', 'Finalizing', 'Installing'];

export function useDownloads() {
  return useQuery({
    queryKey: queryKeys.downloads,
    queryFn: async () => {
      return await invoke<DownloadJob[]>('get_downloads')
    },
    // Poll fast only while something is actually downloading/installing.
    refetchInterval: (query) => {
      const jobs = query.state.data ?? []
      const active = jobs.some((job) => typeof job.state === 'string' && ACTIVE_DOWNLOAD_STATES.includes(job.state))
      return active ? 1000 : 5000
    },
  })
}

export function useStartDownload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ url, fileName }: { url: string; fileName: string }) => {
      return await invoke<string>('start_download', { url, fileName })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.downloads })
      toast.success("Download started")
    },
    onError: (error) => toast.error(`Failed to start download: ${formatError(error)}`)
  })
}

export function usePauseDownload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (jobId: string) => {
      return await invoke<void>('pause_download', { jobId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.downloads })
    },
    onError: (error) => toast.error(`Failed to pause: ${formatError(error)}`)
  })
}

export function useResumeDownload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (jobId: string) => {
      return await invoke<void>('resume_download', { jobId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.downloads })
    },
    onError: (error) => toast.error(`Failed to resume: ${formatError(error)}`)
  })
}

export function useCancelDownload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (jobId: string) => {
      return await invoke<void>('cancel_download', { jobId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.downloads })
    },
    onError: (error) => toast.error(`Failed to cancel: ${formatError(error)}`)
  })
}

export interface InstallDownloadOutcome {
  Installed?: {
    instance_id: string;
    instance_name: string;
  };
  NeedsInstanceSelection?: {
    candidates: GameInstance[];
  };
}

export function useInstallDownload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ jobId, instanceId }: { jobId: string; instanceId?: string }) => {
      return await invoke<InstallDownloadOutcome>('install_download', { jobId, instanceId })
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.downloads })
      
      if (result.Installed) {
        toast.success(`Installed to ${result.Installed.instance_name}`)
        // Invalidate mods for the target instance
        queryClient.invalidateQueries({ queryKey: queryKeys.mods(result.Installed.instance_id) })
      } else if (result.NeedsInstanceSelection) {
        // This case should ideally be handled by the UI before calling mutation or by catching this result
        // For now, we just notify. The UI component will need to inspect the result.
        // But since mutation returns the result to the caller, the caller (DownloadsView) can handle it.
      }
    },
    onError: (error) => toast.error(`Installation failed: ${formatError(error)}`)
  })
}

export function useInstallMod() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, archivePath }: { instanceId: string; archivePath: string }) => {
      return await invoke<Mod>('install_mod', { instanceId, archivePath })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mods(variables.instanceId) })
      toast.success("Mod installed successfully")
    },
    onError: (error) => toast.error(`Failed to install mod: ${formatError(error)}`)
  })
}

export function useToggleMod() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, modId, enabled }: { instanceId: string; modId: string; enabled: boolean }) => {
      return await invoke('toggle_mod', { instanceId, modId, enabled })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mods(variables.instanceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conflicts(variables.instanceId) })
    },
    onError: (error) => toast.error(`Failed to toggle mod: ${formatError(error)}`)
  })
}

export function useDeleteMod() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, modId }: { instanceId: string; modId: string }) => {
      return await invoke<DeleteModResult>('delete_mod', { instanceId, modId })
    },
    onSuccess: async (result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mods(variables.instanceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles(variables.instanceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activeProfile(variables.instanceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conflicts(variables.instanceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.verify(variables.instanceId) }),
        queryClient.invalidateQueries({ queryKey: ['modCompat', variables.instanceId] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.instances }),
      ])

      toast.success(`${result.mod_name} deleted`)
      if (result.preserved_unmanaged_files > 0) {
        const noun = result.preserved_unmanaged_files === 1 ? 'file was' : 'files were'
        toast.warning(
          `${result.preserved_unmanaged_files} ${noun} preserved because the contents no longer matched this mod.`,
        )
      }
      if (result.shared_dependencies_preserved > 0) {
        const noun = result.shared_dependencies_preserved === 1 ? 'dependency was' : 'dependencies were'
        toast.info(
          `${result.shared_dependencies_preserved} shared ${noun} kept because other installed mods still use them.`,
        )
      }
      if (result.orphan_dependencies_removed > 0) {
        const noun = result.orphan_dependencies_removed === 1 ? 'unused dependency' : 'unused dependencies'
        toast.success(`${result.orphan_dependencies_removed} ${noun} also removed`)
      }
      if (result.orphan_dependencies_preserved > 0) {
        const noun = result.orphan_dependencies_preserved === 1 ? 'dependency needs' : 'dependencies need'
        toast.warning(
          `${result.orphan_dependencies_preserved} unused ${noun} manual cleanup.`,
        )
      }
      if (result.cleanup_pending) {
        toast.warning('The mod was removed, but temporary deletion files still need cleanup.')
      }
    },
    onError: (error) => toast.error(`Failed to delete mod: ${formatError(error)}`)
  })
}

export function useOpenModFolder() {
  return useMutation({
    mutationFn: async ({ instanceId, modId }: { instanceId: string; modId: string }) => {
      // Opened backend-side: the webview opener API is ACL-scoped to URLs only.
      await invoke('open_mod_folder', { instanceId, modId });
    },
    onError: (error) => toast.error(`Failed to open folder: ${formatError(error)}`)
  })
}

export function useDeployMods() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, gameId }: { instanceId: string; gameId: string }) => {
      return await invoke<string>('deploy_mods', { instanceId, gameId })
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mods(variables.instanceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.verify(variables.instanceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conflicts(variables.instanceId) })
      toast.success(result)
    },
    onError: (error) => toast.error(`Deployment failed: ${formatError(error)}`)
  })
}

export function useRepairMods() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, gameId }: { instanceId: string; gameId: string }) => {
      return await invoke<string>('repair_mods', { instanceId, gameId })
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mods(variables.instanceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conflicts(variables.instanceId) })
      toast.success(result)
    },
    onError: (error) => toast.error(`Repair failed: ${formatError(error)}`)
  })
}

export function useUndeployMods() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<string>('undeploy_mods', { instanceId })
    },
    onSuccess: (result, instanceId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conflicts(instanceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.verify(instanceId) })
      toast.success(result)
    },
    onError: (error) => toast.error(`Undeploy failed: ${formatError(error)}`)
  })
}

export function useRefreshMods() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<Mod[]>('refresh_mods', { instanceId })
    },
    onSuccess: (mods, instanceId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mods(instanceId) })
      toast.success(`Refreshed ${mods.length} mods from disk`)
    },
    onError: (error) => toast.error(`Refresh failed: ${formatError(error)}`)
  })
}

export function useScanResiduals() {
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<string[]>('scan_residuals', { instanceId })
    },
    onError: (error) => toast.error(`Scan failed: ${formatError(error)}`)
  })
}

export function useDeleteResiduals() {
  return useMutation({
    mutationFn: async ({ instanceId, files }: { instanceId: string; files: string[] }) => {
      return await invoke<string>('delete_residual_files', { instanceId, files })
    },
    onSuccess: (result) => {
      toast.success(result)
    },
    onError: (error) => toast.error(`Delete failed: ${formatError(error)}`)
  })
}

// --- Profiles ---

export function useProfiles(instanceId: string | null) {
  return useQuery({
    queryKey: queryKeys.profiles(instanceId!),
    queryFn: async () => {
      return await invoke<ProfileConfig>('list_profiles', { instanceId })
    },
    enabled: !!instanceId,
  })
}

export function useCreateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, name }: { instanceId: string; name: string }) => {
      return await invoke<string>('create_profile', { instanceId, name })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles(variables.instanceId) })
      toast.success("Profile created")
    },
    onError: (error) => toast.error(`Failed to create profile: ${formatError(error)}`)
  })
}

export function useSwitchProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, profileId }: { instanceId: string; profileId: string }) => {
      return await invoke<string>('switch_profile', { instanceId, profileId })
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles(variables.instanceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.mods(variables.instanceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.instances }) 
      queryClient.invalidateQueries({ queryKey: queryKeys.conflicts(variables.instanceId) })
      toast.success(result)
    },
    onError: (error) => toast.error(`Failed to switch profile: ${formatError(error)}`)
  })
}

export function useDeleteProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, profileId }: { instanceId: string; profileId: string }) => {
      return await invoke<void>('delete_profile', { instanceId, profileId })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles(variables.instanceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      toast.success("Profile deleted")
    },
    onError: (error) => toast.error(`Failed to delete profile: ${formatError(error)}`)
  })
}

// --- Conflicts ---

export function useConflicts(instanceId: string | null) {
  return useQuery({
    queryKey: queryKeys.conflicts(instanceId!),
    queryFn: async () => {
      return await invoke<Record<string, string[]>>('get_conflicts', { instanceId })
    },
    enabled: !!instanceId,
  })
}

// --- Minecraft ---

export interface MinecraftVersionEntry {
  id: string;
  type: string;
  url: string;
  time: string;
  releaseTime: string;
}

export interface MinecraftVersionList {
  versions: MinecraftVersionEntry[];
}

export interface MinecraftLoaderVersionEntry {
  version: string;
  stable: boolean;
}

export function useMinecraftVersions() {
  return useQuery({
    queryKey: queryKeys.minecraftVersions,
    queryFn: async () => {
      return await invoke<MinecraftVersionList>('get_minecraft_versions')
    },
  })
}

export function useMinecraftLoaderVersions(mcVersion: string, loader: MinecraftLoader) {
  return useQuery({
    queryKey: queryKeys.minecraftLoaderVersions(mcVersion, loader),
    queryFn: async () => {
      return await invoke<MinecraftLoaderVersionEntry[]>('get_minecraft_loader_versions', {
        mcVersion,
        loader,
      })
    },
    enabled: !!mcVersion && loader !== 'vanilla',
    retry: 1,
  })
}

export function useDetectMinecraftRuntime(mcVersion?: string | null) {
  return useQuery({
    queryKey: queryKeys.minecraftRuntime(mcVersion),
    queryFn: async () => {
      return await invoke<MinecraftRuntimeStatus>('detect_minecraft_runtime', { mcVersion: mcVersion ?? null })
    },
  })
}

export function useInstallMinecraftRuntime() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ mcVersion, javaMajor }: { mcVersion?: string | null; javaMajor?: number | null }) => {
      return await invoke<MinecraftRuntimeStatus>('install_minecraft_runtime', { mcVersion: mcVersion ?? null, javaMajor: javaMajor ?? null })
    },
    onSuccess: (runtime) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftRuntime(runtime.required_major >= 21 ? '1.20.5' : '1.20.4') })
      toast.success(`Java ${runtime.required_major} ready`)
    },
    onError: (error) => toast.error(`Runtime install failed: ${formatError(error)}`)
  })
}

export function usePerformanceProfiles() {
  return useQuery({
    queryKey: queryKeys.performanceProfiles,
    queryFn: async () => {
      return await invoke<MinecraftPerformanceProfile[]>('get_performance_profiles')
    },
  })
}

export function useInstancePerformanceProfile(instanceId: string | null) {
  return useQuery({
    queryKey: queryKeys.instancePerformanceProfile(instanceId ?? ''),
    queryFn: async () => {
      return await invoke<InstancePerformanceProfile>('get_instance_performance_profile', { instanceId })
    },
    enabled: !!instanceId,
  })
}

export function useSaveInstancePerformanceProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, profileId }: { instanceId: string; profileId: string }) => {
      return await invoke<InstancePerformanceProfile>('save_instance_performance_profile', { instanceId, profileId })
    },
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instancePerformanceProfile(profile.instance_id) })
      toast.success("Performance profile saved")
    },
    onError: (error) => toast.error(`Profile save failed: ${formatError(error)}`)
  })
}

export interface InstanceSettings {
  java_path: string | null;
  min_memory_mb: number | null;
  max_memory_mb: number | null;
  extra_args: string | null;
}

export function useInstanceSettings(instanceId: string | null) {
  return useQuery({
    queryKey: ['instanceSettings', instanceId ?? ''],
    queryFn: async () => {
      return await invoke<InstanceSettings>('get_instance_settings', { instanceId })
    },
    enabled: !!instanceId,
  })
}

export function useSaveInstanceSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, settings }: { instanceId: string; settings: InstanceSettings }) => {
      return await invoke<InstanceSettings>('save_instance_settings', { instanceId, settings })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['instanceSettings', variables.instanceId] })
      toast.success("Instance settings saved")
    },
    onError: (error) => toast.error(`Save failed: ${formatError(error)}`)
  })
}

export function useExportInstance() {
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<string>('export_instance', { instanceId })
    },
    onSuccess: () => toast.success("Instance exported — the folder is now open"),
    onError: (error) => toast.error(`Export failed: ${formatError(error)}`)
  })
}

export function useCreateMinecraftInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { displayName: string; mcVersion: string; loader: MinecraftLoader; loaderVersion?: string | null; javaMajor?: number | null }) => {
      return await invoke<GameInstance>('create_minecraft_instance_cmd', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      toast.success("Minecraft instance created")
    },
    onError: (error) => toast.error(`Failed to create instance: ${formatError(error)}`)
  })
}

export function useRenameInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, displayName }: { instanceId: string; displayName: string }) => {
      return await invoke<GameInstance>('rename_minecraft_instance_cmd', { instanceId, displayName })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      toast.success("Instance renamed")
    },
    onError: (error) => toast.error(`Rename failed: ${formatError(error)}`)
  })
}

export function useSetInstanceVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, mcVersion }: { instanceId: string; mcVersion: string }) => {
      return await invoke<GameInstance>('set_minecraft_instance_version_cmd', { instanceId, mcVersion })
    },
    onSuccess: (instance) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftInstall(instance.id) })
      toast.success(`Version set to ${instance.minecraft?.mc_version}. Install to download the new files.`)
    },
    onError: (error) => toast.error(`Version change failed: ${formatError(error)}`)
  })
}

export function useSetInstanceJava() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, javaMajor }: { instanceId: string; javaMajor: number | null }) => {
      return await invoke<GameInstance>('set_minecraft_instance_java_cmd', { instanceId, javaMajor })
    },
    onSuccess: (instance) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftRuntime(instance.minecraft?.mc_version) })
      toast.success(instance.minecraft?.java_major ? `Java ${instance.minecraft.java_major} selected` : "Java set to automatic")
    },
    onError: (error) => toast.error(`Java change failed: ${formatError(error)}`)
  })
}

export function useDeleteInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<void>('delete_minecraft_instance_cmd', { instanceId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      toast.success("Instance deleted")
    },
    onError: (error) => toast.error(`Delete failed: ${formatError(error)}`)
  })
}

export function useOpenInstanceFolder() {
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<void>('open_instance_folder', { instanceId })
    },
    onError: (error) => toast.error(`Failed to open folder: ${formatError(error)}`)
  })
}

// --- Mod compatibility ---

export interface CompatIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface ModCompatEntry {
  file_name: string;
  mod_id: string | null;
  name: string | null;
  version: string | null;
  minecraft_ok: boolean | null;
  issues: CompatIssue[];
}

export interface CompatReport {
  instance_id: string;
  mc_version: string;
  errors: number;
  warnings: number;
  mods: ModCompatEntry[];
}

/**
 * Static compatibility report of the instance mods folder. `modsKey` should
 * change whenever the mod list changes so the report refreshes automatically.
 */
export function useModCompatibility(instanceId: string | null, modsKey: string) {
  return useQuery({
    queryKey: ['modCompat', instanceId ?? '', modsKey],
    queryFn: async () => {
      return await invoke<CompatReport>('check_mod_compatibility', { instanceId })
    },
    enabled: !!instanceId,
    staleTime: 15_000,
  })
}

// --- Shader packs ---

export interface ShaderPackInfo {
  file_name: string;
  size: number;
}

export function useShaderpacks(instanceId: string | null) {
  return useQuery({
    queryKey: ['shaderpacks', instanceId ?? ''],
    queryFn: async () => {
      return await invoke<ShaderPackInfo[]>('list_shaderpacks', { instanceId })
    },
    enabled: !!instanceId,
  })
}

export function useDeleteShaderpack() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, fileName }: { instanceId: string; fileName: string }) => {
      return await invoke<void>('delete_shaderpack', { instanceId, fileName })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['shaderpacks', variables.instanceId] })
      toast.success("Shader pack deleted")
    },
    onError: (error) => toast.error(`Delete failed: ${formatError(error)}`)
  })
}

export function useImportShaderpack() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, sourcePath }: { instanceId: string; sourcePath: string }) => {
      return await invoke<string>('import_shaderpack', { instanceId, sourcePath })
    },
    onSuccess: (fileName, variables) => {
      queryClient.invalidateQueries({ queryKey: ['shaderpacks', variables.instanceId] })
      toast.success(`Imported ${fileName}`)
    },
    onError: (error) => toast.error(`Import failed: ${formatError(error)}`)
  })
}

export function useOpenShaderpacksFolder() {
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<void>('open_shaderpacks_folder', { instanceId })
    },
    onError: (error) => toast.error(`Failed to open folder: ${formatError(error)}`)
  })
}

export function useShaderSearch() {
  return useMutation({
    mutationFn: async (payload: { instanceId: string; query: string; limit?: number }) => {
      return await invoke<ModrinthSearchResponse>('modrinth_search_shaders', payload)
    },
    onError: (error) => toast.error(`Modrinth search failed: ${formatError(error)}`)
  })
}

export function useInstallShaderpack() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, projectId }: { instanceId: string; projectId: string }) => {
      return await invoke<string>('install_shaderpack_from_modrinth', { instanceId, projectId })
    },
    onSuccess: (fileName, variables) => {
      queryClient.invalidateQueries({ queryKey: ['shaderpacks', variables.instanceId] })
      toast.success(`Installed ${fileName}`)
    },
    onError: (error) => toast.error(`Install failed: ${formatError(error)}`)
  })
}

// --- Resource packs, data packs and modpacks ---

export type MinecraftContentType = 'shader' | 'resourcepack' | 'datapack' | 'modpack'

export interface MinecraftContentInfo {
  file_name: string
  size: number
  world_name: string | null
}

export interface MinecraftWorldInfo {
  name: string
  data_pack_count: number
}

export interface ContentInstallResult {
  content_type: MinecraftContentType
  file_name: string
  instance_id: string
  created_instance_id: string | null
  world_name: string | null
}

export function useMinecraftWorlds(instanceId: string | null) {
  return useQuery({
    queryKey: ['minecraftWorlds', instanceId ?? ''],
    queryFn: async () => {
      return await invoke<MinecraftWorldInfo[]>('list_minecraft_worlds', { instanceId })
    },
    enabled: !!instanceId,
  })
}

export function useMinecraftContent(
  instanceId: string | null,
  contentType: MinecraftContentType | null,
  worldName?: string | null,
) {
  const worldReady = contentType !== 'datapack' || !!worldName
  const listable = contentType === 'shader' || contentType === 'resourcepack' || contentType === 'datapack'
  return useQuery({
    queryKey: ['minecraftContent', instanceId ?? '', contentType ?? '', worldName ?? ''],
    queryFn: async () => {
      return await invoke<MinecraftContentInfo[]>('list_minecraft_content', {
        instanceId,
        contentType,
        worldName,
      })
    },
    enabled: !!instanceId && !!contentType && listable && worldReady,
  })
}

export function useDeleteMinecraftContent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      instanceId: string
      contentType: MinecraftContentType
      fileName: string
      worldName?: string | null
    }) => {
      return await invoke<void>('delete_minecraft_content', payload)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['minecraftContent', variables.instanceId, variables.contentType],
      })
      toast.success("Content removed")
    },
    onError: (error) => toast.error(`Delete failed: ${formatError(error)}`),
  })
}

export function useImportMinecraftContent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      instanceId: string
      contentType: MinecraftContentType
      sourcePath: string
      worldName?: string | null
    }) => {
      return await invoke<string>('import_minecraft_content', payload)
    },
    onSuccess: (fileName, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['minecraftContent', variables.instanceId, variables.contentType],
      })
      toast.success(`Imported ${fileName}`)
    },
    onError: (error) => toast.error(`Import failed: ${formatError(error)}`),
  })
}

export function useOpenMinecraftContentFolder() {
  return useMutation({
    mutationFn: async (payload: {
      instanceId: string
      contentType: MinecraftContentType
      worldName?: string | null
    }) => {
      return await invoke<void>('open_minecraft_content_folder', payload)
    },
    onError: (error) => toast.error(`Failed to open folder: ${formatError(error)}`),
  })
}

export function useInstallModrinthContent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      instanceId: string
      contentType: MinecraftContentType
      projectId: string
      versionId?: string | null
      worldName?: string | null
      displayName?: string | null
    }) => {
      return await invoke<ContentInstallResult>('install_modrinth_content', { request: payload })
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['minecraftContent', variables.instanceId, variables.contentType],
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      toast.success(result.created_instance_id ? "Modpack instance created" : `Installed ${result.file_name}`)
    },
    onError: (error) => toast.error(`Install failed: ${formatError(error)}`),
  })
}

export function useInstallCurseForgeContent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      instanceId: string
      contentType: MinecraftContentType
      modId: number
      fileId: number
      worldName?: string | null
      displayName?: string | null
    }) => {
      return await invoke<ContentInstallResult>('install_curseforge_content', { request: payload })
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['minecraftContent', variables.instanceId, variables.contentType],
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      toast.success(result.created_instance_id ? "Modpack instance created" : `Installed ${result.file_name}`)
    },
    onError: (error) => toast.error(`Install failed: ${formatError(error)}`),
  })
}

export function useIrisStatus(instanceId: string | null) {
  return useQuery({
    queryKey: ['irisInstalled', instanceId ?? ''],
    queryFn: async () => {
      return await invoke<boolean>('is_iris_installed', { instanceId })
    },
    enabled: !!instanceId,
  })
}

export function useInstallIris() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<string>('install_iris', { instanceId })
    },
    onSuccess: (fileName, instanceId) => {
      queryClient.invalidateQueries({ queryKey: ['irisInstalled', instanceId] })
      queryClient.invalidateQueries({ queryKey: queryKeys.mods(instanceId) })
      toast.success(`Installed ${fileName}`)
    },
    onError: (error) => toast.error(`Iris install failed: ${formatError(error)}`)
  })
}

export type MinecraftInstallStage =
  | 'idle'
  | 'preparing'
  | 'downloading_client'
  | 'downloading_libraries'
  | 'downloading_asset_index'
  | 'downloading_assets'
  | 'installing_fabric'
  | 'installing_forge'
  | 'installing_base_mod'
  | 'verifying'
  | 'done'
  | 'cancelled'
  | 'error';

export interface MinecraftInstallStatus {
  stage: MinecraftInstallStage;
  completed: number;
  total: number;
  overall_completed: number;
  overall_total: number;
  bytes_downloaded: number;
  bytes_total: number | null;
  current_item: string | null;
  current_category: string | null;
  message: string | null;
  ready: boolean;
}

export function useStartMinecraftInstall() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<void>('start_minecraft_install', { instanceId })
    },
    onSuccess: (_, instanceId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftInstall(instanceId) })
      toast.success("Minecraft installation started")
    },
    onError: (error) => toast.error(`Install failed: ${formatError(error)}`)
  })
}

export function useMinecraftInstallStatus(instanceId: string | null) {
  return useQuery({
    queryKey: queryKeys.minecraftInstall(instanceId!),
    queryFn: async () => {
      return await invoke<MinecraftInstallStatus>('get_minecraft_install_status', { instanceId })
    },
    enabled: !!instanceId,
    // Poll fast only while an install is in flight; keep a slow heartbeat
    // otherwise so a just-started install is always picked up.
    refetchInterval: (query) => {
      const stage = query.state.data?.stage
      const active = stage && !['idle', 'done', 'cancelled', 'error'].includes(stage)
      return active ? 1000 : 4000
    },
  })
}

export interface MinecraftLaunchResult {
  pid: number;
  java: string;
  main_class: string;
  profile_id: string;
  log_path: string;
  account_mode: string;
}

export interface OfflineAccount {
  id: string
  username: string
  uuid: string
  skin_path: string | null
  created_at: string
}

export function useOfflineAccounts() {
  return useQuery({
    queryKey: queryKeys.offlineAccounts,
    queryFn: async () => await invoke<OfflineAccount[]>('offline_accounts_list'),
  })
}

function useOfflineAccountMutation<TArgs>(
  command: string,
  successMessage: (args: TArgs) => string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: TArgs) => await invoke<unknown>(command, args as never),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.offlineAccounts })
      toast.success(successMessage(args))
    },
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useCreateOfflineAccount() {
  return useOfflineAccountMutation<{ username: string }>(
    'offline_account_create',
    (args) => `Offline profile ${args.username} created`,
  )
}

export function useRenameOfflineAccount() {
  return useOfflineAccountMutation<{ id: string; username: string }>(
    'offline_account_rename',
    (args) => `Offline profile renamed to ${args.username}`,
  )
}

export function useDeleteOfflineAccount() {
  return useOfflineAccountMutation<{ id: string }>(
    'offline_account_delete',
    () => 'Offline profile removed',
  )
}

export function useImportOfflineSkin() {
  return useOfflineAccountMutation<{ id: string; sourcePath: string }>(
    'offline_account_import_skin',
    () => 'Skin imported',
  )
}

export type CrashCategory =
  | 'missing_dependency'
  | 'wrong_java'
  | 'out_of_memory'
  | 'mixin_conflict'
  | 'module_conflict'
  | 'graphics'
  | 'unknown'

export type CrashAction =
  | { kind: 'disable_mod'; value: string }
  | { kind: 'use_java'; value: number }
  | { kind: 'increase_memory' }
  | { kind: 'repair' }
  | { kind: 'safe_mode' }
  | { kind: 'update_graphics_driver' }

export interface CrashFinding {
  category: CrashCategory
  title: string
  detail: string
  evidence: string
  subject: string | null
  actions: CrashAction[]
}

export function useCrashDiagnosis(instanceId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['crashDiagnosis', instanceId] as const,
    queryFn: async () =>
      await invoke<CrashFinding[]>('diagnose_instance_crash', { instanceId }),
    enabled: !!instanceId && enabled,
    // The log only changes on the next launch; no point re-reading it.
    staleTime: Infinity,
  })
}

export type UpdateStatus = 'available' | 'pinned' | 'up_to_date' | 'no_compatible_release'

export interface AvailableVersion {
  version_id: string
  version_name: string
  game_versions: string[]
  loaders: string[]
  released_at: string
  changelog: string | null
}

export interface UpdateCandidate {
  path: string
  provider: string
  project_id: string
  current_version_id: string
  status: UpdateStatus
  target: AvailableVersion | null
}

export interface AppliedUpdates {
  restorePointId: string
  updated: string[]
  failed: string[]
}

/** Checking hits the platforms, so it never runs on its own. */
export function useInstanceUpdates(instanceId: string | null) {
  return useMutation({
    mutationFn: async () =>
      await invoke<UpdateCandidate[]>('check_instance_updates', { instanceId }),
    onError: (error) => toast.error(`Update check failed: ${formatError(error)}`),
  })
}

export interface ProvenanceBackfill {
  matched: string[]
  unmatched: string[]
}

/** Identifies already-installed files by their hash so they become trackable. */
export function useBackfillContentOrigins() {
  return useMutation({
    mutationFn: async (instanceId: string) =>
      await invoke<ProvenanceBackfill>('backfill_content_origins', { instanceId }),
    onSuccess: (result) => {
      if (result.matched.length === 0) {
        toast.info('No installed file could be identified on Modrinth')
      } else {
        toast.success(`${result.matched.length} file(s) identified`)
      }
    },
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useApplyInstanceUpdates() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, paths }: { instanceId: string; paths: string[] }) =>
      await invoke<AppliedUpdates>('apply_instance_updates', { instanceId, paths }),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mods(variables.instanceId) })
      if (result.failed.length > 0) {
        toast.warning(
          `${result.updated.length} updated, ${result.failed.length} failed: ${result.failed[0]}`,
        )
      } else {
        toast.success(`${result.updated.length} file(s) updated`)
      }
    },
    onError: (error) => toast.error(`Update failed: ${formatError(error)}`),
  })
}

export interface AvailableVersion {
  version_id: string
  version_name: string
  game_versions: string[]
  loaders: string[]
  released_at: string
  changelog: string | null
}

/** Every release of a file's project this instance can run, newest first. */
/** Saves a release to a path the user chose, without installing it. */
export function useDownloadContentFile() {
  return useMutation({
    mutationFn: async (args: {
      provider: string
      projectId: string
      versionId: string
      destination: string
    }) => await invoke<string>('download_content_file', args),
    onSuccess: (path) => toast.success(`Downloaded to ${path}`),
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useContentVersions() {
  return useMutation({
    mutationFn: async ({ instanceId, relativePath }: { instanceId: string; relativePath: string }) =>
      await invoke<AvailableVersion[]>('list_content_versions', { instanceId, relativePath }),
    onError: (error) => toast.error(formatError(error)),
  })
}

/**
 * Moves a file to a chosen version, in either direction.
 *
 * The result is pinned by the backend: a deliberate choice that the next
 * "update everything" undid would be no choice at all.
 */
export function useSetContentVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { instanceId: string; relativePath: string; versionId: string }) =>
      await invoke<string>('set_content_version', args),
    onSuccess: (path, args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mods(args.instanceId) })
      toast.success(`${path} installed and pinned`)
    },
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useSetContentPinned() {
  return useMutation({
    mutationFn: async ({
      instanceId,
      relativePath,
      pinned,
    }: {
      instanceId: string
      relativePath: string
      pinned: boolean
    }) => await invoke('content_set_pinned', { instanceId, relativePath, pinned }),
    onError: (error) => toast.error(formatError(error)),
  })
}

export type BisectionStep =
  | { kind: 'test_vanilla' }
  | { kind: 'test_subset'; value: string[] }
  | { kind: 'culprit'; value: string }
  | { kind: 'no_culprit' }
  | { kind: 'broken_without_mods' }

export interface SafeModeState {
  step: BisectionStep
  runs: number
  enabled: string[]
  totalCandidates: number
}

export function useSafeModeStatus(instanceId: string | null) {
  return useQuery({
    queryKey: ['safeMode', instanceId] as const,
    queryFn: async () => await invoke<SafeModeState | null>('safe_mode_status', { instanceId }),
    enabled: !!instanceId,
  })
}

function useSafeModeMutation<TArgs>(command: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: TArgs) => await invoke<SafeModeState | null>(command, args as never),
    onSuccess: (_data, args) => {
      const instanceId = (args as { instanceId?: string }).instanceId
      queryClient.invalidateQueries({ queryKey: ['safeMode', instanceId] })
      if (instanceId) queryClient.invalidateQueries({ queryKey: queryKeys.mods(instanceId) })
    },
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useSafeModeStart() {
  return useSafeModeMutation<{ instanceId: string }>('safe_mode_start')
}

export function useSafeModeRecord() {
  return useSafeModeMutation<{ instanceId: string; crashed: boolean }>('safe_mode_record')
}

export function useSafeModeStop() {
  return useSafeModeMutation<{ instanceId: string }>('safe_mode_stop')
}

export interface SavedServer {
  id: string
  name: string
  address: string
  instance_id: string | null
  added_at: string
  last_played_at: string | null
}

export interface ServerStatus {
  motd: string
  players_online: number
  players_max: number
  version: string
  latency_ms: number
  /** The server's own icon, already checked to be a PNG data URI. */
  favicon: string | null
}

export interface ServerPing {
  id: string
  status: ServerStatus | null
  error: string | null
}

export function useServerHub() {
  return useQuery({
    queryKey: queryKeys.servers,
    queryFn: async () => await invoke<SavedServer[]>('server_hub_list'),
  })
}

function useServerMutation<TArgs>(command: string, success?: (args: TArgs) => string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: TArgs) => await invoke<unknown>(command, args as never),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.servers })
      if (success) toast.success(success(args))
    },
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useAddServer() {
  return useServerMutation<{ name: string; address: string; instanceId?: string | null }>(
    'server_hub_add',
    (args) => `${args.name} added`,
  )
}

export function useRemoveServer() {
  return useServerMutation<{ id: string }>('server_hub_remove')
}

export function useBindServerInstance() {
  return useServerMutation<{ id: string; instanceId: string | null }>('server_hub_set_instance')
}

/** Pings on demand: a server list should not hammer every host on render. */
/**
 * Refreshes every saved server at once.
 *
 * One at a time, two dead servers cost two full timeouts before anything
 * appears; in parallel the slowest one sets the wait.
 */
export function usePingAllServers() {
  return useMutation({
    mutationFn: async () => await invoke<ServerPing[]>('server_hub_ping_all'),
  })
}

export interface ServerImport {
  added: SavedServer[]
  skipped: number
}

/** Imports the multiplayer list an instance already has, matched by address. */
export function useImportServersFromInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: string) =>
      await invoke<ServerImport>('server_hub_import_from_instance', { instanceId }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.servers })
      toast.success(
        result.added.length > 0
          ? `${result.added.length} servers imported`
          : 'Every server in that list is already saved',
      )
    },
    onError: (error) => toast.error(formatError(error)),
  })
}

export function usePingServer() {
  return useMutation({
    mutationFn: async (address: string) =>
      await invoke<ServerStatus>('server_hub_ping', { address }),
  })
}

export function useJoinServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, username }: { id: string; username: string }) =>
      await invoke<MinecraftLaunchResult>('server_hub_join', { id, username }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.servers })
      queryClient.invalidateQueries({ queryKey: queryKeys.runningInstances })
      toast.success('Minecraft launched')
    },
    onError: (error) => toast.error(`Join failed: ${formatError(error)}`),
  })
}

export function useLaunchMinecraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { instanceId: string; username: string; offline?: boolean }) => {
      return await invoke<MinecraftLaunchResult>('launch_minecraft_instance', payload)
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      queryClient.invalidateQueries({ queryKey: queryKeys.runningInstances })
      toast.success(`Minecraft launched (PID ${res.pid})`)
    },
    onError: (error) => toast.error(`Launch failed: ${formatError(error)}`)
  })
}

export type LaunchPhase =
  | 'idle'
  | 'preparing'
  | 'downloading_java'
  | 'downloading_game'
  | 'repairing_mods'
  | 'starting'
  | 'running'
  | 'crashed'
  | 'exited';

export interface LaunchStatus {
  phase: LaunchPhase;
  message: string | null;
  pid: number | null;
  exit_code: number | null;
  log_path: string | null;
}

const BUSY_LAUNCH_PHASES: LaunchPhase[] = ['preparing', 'downloading_java', 'downloading_game', 'repairing_mods', 'starting'];

export function useLaunchStatus(instanceId: string | null) {
  return useQuery({
    queryKey: queryKeys.launchStatus(instanceId ?? ''),
    queryFn: async () => {
      return await invoke<LaunchStatus>('get_launch_status', { instanceId })
    },
    enabled: !!instanceId,
    // Poll fast while the launch is in flight, slower once idle/running.
    refetchInterval: (query) => {
      const phase = query.state.data?.phase
      return phase && BUSY_LAUNCH_PHASES.includes(phase) ? 500 : 3000
    },
  })
}

export function useStopInstance() {
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<void>('stop_minecraft_instance', { instanceId })
    },
    onError: (error) => toast.error(`Failed to stop: ${formatError(error)}`)
  })
}

export function returnToLauncher() {
  return invoke<void>('return_to_launcher')
}

export function useDismissLaunchStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: string) => {
      return await invoke<void>('dismiss_launch_status', { instanceId })
    },
    onSuccess: (_, instanceId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.launchStatus(instanceId) })
    },
  })
}

export function useInstanceLog() {
  return useMutation({
    mutationFn: async ({ instanceId, lines }: { instanceId: string; lines?: number }) => {
      return await invoke<string>('read_instance_log', { instanceId, lines: lines ?? 200 })
    },
    onError: (error) => toast.error(`Failed to read log: ${formatError(error)}`)
  })
}

/** Live tail of the instance game log. Polls while `active` is true. */
export function useLiveInstanceLog(instanceId: string | null, active: boolean) {
  return useQuery({
    queryKey: ['instanceLog', instanceId ?? ''],
    queryFn: async () => {
      return await invoke<string>('read_instance_log', { instanceId, lines: 600 })
    },
    enabled: !!instanceId && active,
    refetchInterval: active ? 1200 : false,
    // Keep the last log visible after the game exits.
    staleTime: Infinity,
  })
}

/** instance_id -> PID of the running Minecraft process. Polls while mounted. */
export function useRunningInstances() {
  return useQuery({
    queryKey: queryKeys.runningInstances,
    queryFn: async () => {
      return await invoke<Record<string, number>>('get_running_minecraft_instances')
    },
    refetchInterval: 3000,
  })
}

export function useMinecraftDownloadMod() {
  return useMutation({
    mutationFn: async (payload: {
      instanceId: string;
      url: string;
      fileName: string;
      sha1?: string | null;
      modName?: string | null;
      version?: string | null;
      description?: string | null;
      coverUrl?: string | null;
      source?: string | null;
      homepageUrl?: string | null;
      fileSize?: number | null;
      gameVersions?: string[] | null;
      loaders?: string[] | null;
      updatedAt?: string | null;
      /** Upstream project and version, so the Update Center can track this mod. */
      projectId?: string | null;
      versionId?: string | null;
    }) => {
      return await invoke<string>('minecraft_download_mod_from_url', { request: payload })
    },
    onSuccess: () => toast.success("Mod installed"),
    onError: (error) => toast.error(`Install failed: ${formatError(error)}`)
  })
}

// --- Modrinth ---

export interface ModrinthProjectHit {
  project_id: string;
  title: string;
  description: string;
  downloads: number;
  follows: number;
  icon_url: string | null;
  author: string;
  date_modified: string;
  versions: string[];
  categories: string[];
}

export interface ModrinthSearchResponse {
  hits: ModrinthProjectHit[];
  limit: number;
  offset: number;
  total_hits: number;
}

export interface ModrinthFile {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
  hashes: { sha1: string; sha512: string };
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthFile[];
  date_published: string;
}

export function useModrinthSearch() {
  return useMutation({
    mutationFn: async (payload: { instanceId: string; query: string; projectType?: string; limit?: number; offset?: number; compatibleOnly?: boolean; filterVersion?: boolean; sort?: "relevance" | "downloads" | "updated" }) => {
      return await invoke<ModrinthSearchResponse>('modrinth_search_mods', payload)
    },
    onError: (error) => toast.error(`Modrinth search failed: ${formatError(error)}`)
  })
}

export function useModrinthVersions() {
  return useMutation({
    mutationFn: async (projectId: string) => {
      return await invoke<ModrinthVersion[]>('modrinth_get_versions', { projectId })
    },
    onError: (error) => toast.error(`Failed to load versions: ${formatError(error)}`)
  })
}

// --- CurseForge ---

export interface CurseForgeFileIndex {
  game_version: string;
  mod_loader?: number | null;
}

export interface CurseForgeMod {
  id: number;
  name: string;
  allow_mod_distribution?: boolean | null;
  summary?: string | null;
  download_count?: number | null;
  date_modified?: string | null;
  links?: { website_url?: string | null } | null;
  logo?: { thumbnail_url?: string | null } | null;
  authors?: Array<{ id: number; name: string; url?: string | null }> | null;
  latest_files_indexes?: CurseForgeFileIndex[] | null;
}

export interface CurseForgeSearchResponse {
  data: CurseForgeMod[];
}

export interface CurseForgeFile {
  id: number;
  file_name: string;
  file_date: string;
  download_count?: number | null;
  file_length?: number | null;
  game_versions: string[];
  download_url?: string | null;
}

export interface CurseForgeFilesResponse {
  data: CurseForgeFile[];
}

export function useCurseForgeSearch() {
  return useMutation({
    mutationFn: async (payload: { instanceId: string; query: string; classId?: number; pageSize?: number; index?: number; compatibleOnly?: boolean; contentType?: string; filterVersion?: boolean; sort?: "relevance" | "downloads" | "updated" }) => {
      return await invoke<CurseForgeSearchResponse>('curseforge_search_mods', payload)
    },
    onSuccess: () => toast.dismiss('curseforge-search-error'),
    onError: (error) => toast.error(
      `CurseForge search failed: ${formatError(error)}`,
      { id: 'curseforge-search-error' },
    ),
  })
}

export function useCurseForgeFiles() {
  return useMutation({
    mutationFn: async (payload: { instanceId: string; modId: number; contentType?: string; pageSize?: number; index?: number }) => {
      return await invoke<CurseForgeFilesResponse>('curseforge_list_files', payload)
    },
    onError: (error) => toast.error(`Failed to load files: ${formatError(error)}`)
  })
}

export function useCurseForgeInstallFile() {
  return useMutation({
    mutationFn: async (payload: {
      instanceId: string;
      modId: number;
      fileId: number;
      fileName?: string | null;
      modName?: string | null;
      description?: string | null;
      coverUrl?: string | null;
      homepageUrl?: string | null;
      fileSize?: number | null;
      gameVersions?: string[] | null;
      updatedAt?: string | null;
    }) => {
      return await invoke<string>('curseforge_install_file', { request: payload })
    },
    onSuccess: () => toast.success("Mod installed"),
    onError: (error) => toast.error(`Install failed: ${formatError(error)}`)
  })
}

// --- Discover dependency resolution ---

export type ModProvider = 'modrinth' | 'curseforge'
export type DependencyKind = 'required' | 'optional' | 'incompatible'

export interface ProjectIdentity {
  provider: ModProvider
  project_id: string
}

export interface DependencyTarget {
  provider: ModProvider
  projectId: string | null
  versionId: string | null
  fileId: number | null
}

export interface ResolveDependenciesRequest {
  instanceId: string
  source: ModProvider
  projectId: string
  versionId?: string | null
  fileId?: number | null
  author?: string | null
}

export interface ResolvedArtifact {
  project: ProjectIdentity
  versionId: string
  fileId: number | null
  name: string
  version: string
  fileName: string
  downloadUrl: string
  sha1: string | null
  fileSize: number | null
  description: string | null
  author: string | null
  homepageUrl: string | null
  coverUrl: string | null
  gameVersions: string[]
  loaders: string[]
  updatedAt: string | null
}

export interface PlannedMod {
  artifact: ResolvedArtifact
  alreadyInstalled: boolean
}

export interface DependencyNotice {
  requiredBy: ProjectIdentity
  target: DependencyTarget
  kind: DependencyKind
  installed: boolean
}

export interface UnresolvedDependency {
  requiredBy: ProjectIdentity | null
  target: DependencyTarget
  reason: string
}

export interface DependencyResolution {
  context: { minecraftVersion: string; loader: string }
  root: PlannedMod | null
  required: PlannedMod[]
  optional: DependencyNotice[]
  incompatible: DependencyNotice[]
  conflicts: DependencyNotice[]
  unresolvedRequired: UnresolvedDependency[]
  cycles: ProjectIdentity[][]
  installOrder: ResolvedArtifact[]
  canInstall: boolean
}

export type InstallationStatus =
  | 'installed'
  | 'no_changes'
  | 'blocked'
  | 'rolled_back'
  | 'rollback_incomplete'

export interface InstalledArtifact {
  project: ProjectIdentity
  modId: string
  name: string
  fileName: string
}

export interface InstallationFailure {
  project: ProjectIdentity | null
  message: string
}

export interface DependencyInstallResult {
  before: DependencyResolution
  after: {
    status: InstallationStatus
    installed: InstalledArtifact[]
    skipped: ProjectIdentity[]
    rolledBack: InstalledArtifact[]
    rollbackFailures: InstallationFailure[]
    failure: InstallationFailure | null
    referenceCounts: Record<string, number>
  }
}

export function useResolveModDependencies() {
  return useMutation({
    mutationFn: async (request: ResolveDependenciesRequest) => {
      return await invoke<DependencyResolution>('resolve_mod_dependencies', { request })
    },
    onError: (error) => toast.error(`Dependency check failed: ${formatError(error)}`),
  })
}

export function useInstallModWithDependencies() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (request: ResolveDependenciesRequest) => {
      return await invoke<DependencyInstallResult>('install_mod_with_dependencies', { request })
    },
    onSuccess: async (result, request) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mods(request.instanceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conflicts(request.instanceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.verify(request.instanceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.instances }),
      ])
      if (result.after.status === 'installed') toast.success('Mod and required dependencies installed')
      if (result.after.status === 'no_changes') toast.success('Mod is already installed')
      if (result.after.status === 'rolled_back') toast.error('Install failed; all changes were rolled back')
      if (result.after.status === 'rollback_incomplete') toast.error('Install failed and rollback needs attention')
    },
    onError: (error) => toast.error(`Install failed: ${formatError(error)}`),
  })
}

// --- OptiFine ---
// OptiFine is published only on optifine.net, so it never appears in the
// Modrinth or CurseForge catalogues; these hit the site directly.

export interface OptiFineRelease {
  file_name: string;
  display_name: string;
  mc_version: string;
  preview: boolean;
}

export function useOptiFineReleases(instanceId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['optifineReleases', instanceId] as const,
    queryFn: async () => {
      return await invoke<OptiFineRelease[]>('optifine_list_releases', { instanceId })
    },
    enabled: !!instanceId && enabled,
    staleTime: 10 * 60 * 1000,
  })
}

export function useInstallOptiFine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { instanceId: string; fileName: string }) => {
      return await invoke<string>('optifine_install', payload)
    },
    onSuccess: (_id, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mods(variables.instanceId) })
      toast.success('OptiFine installed')
    },
    onError: (error) => toast.error(`OptiFine install failed: ${formatError(error)}`),
  })
}

// Creates an instance from a Share/Export archive.
export function useImportInstance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { archivePath: string; displayName?: string | null }) => {
      return await invoke<string>('import_instance', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances })
      toast.success('Instance imported')
    },
    onError: (error) => toast.error(`Import failed: ${formatError(error)}`),
  })
}

// --- Instance artwork ------------------------------------------------------

/**
 * The picture on an instance card, when the user chose one.
 *
 * Fetched per card rather than with the instance list: a cover is a wallpaper,
 * and several megabytes of base64 on every library reload would make the list
 * slower for a decoration.
 */
export interface InstanceCover {
  uri: string
  /** Where the picture came from: the user's own file, or the game version. */
  source: 'custom' | 'version'
}

/** Whether Kiza starts with Windows, read from the registry. */
export function useLaunchAtStartup() {
  return useQuery({
    queryKey: ['launchAtStartup'] as const,
    queryFn: async () => await invoke<boolean>('launch_at_startup_enabled'),
  })
}

export function useSetLaunchAtStartup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) =>
      await invoke<boolean>('set_launch_at_startup', { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['launchAtStartup'] }),
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useInstanceCover(instanceId: string) {
  return useQuery({
    queryKey: queryKeys.instanceCover(instanceId),
    queryFn: async () => await invoke<InstanceCover | null>('instance_cover', { instanceId }),
    staleTime: Infinity,
  })
}

export function useSetInstanceCover() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, sourcePath }: { instanceId: string; sourcePath: string }) =>
      await invoke<string>('set_instance_cover', { instanceId, sourcePath }),
    onSuccess: (_path, args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instanceCover(args.instanceId) })
    },
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useClearInstanceCover() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (instanceId: string) =>
      await invoke<void>('clear_instance_cover', { instanceId }),
    onSuccess: (_data, instanceId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instanceCover(instanceId) })
    },
  })
}

/** When each instance was last launched, keyed by instance id. */
export function usePlayHistory() {
  return useQuery({
    queryKey: queryKeys.playHistory,
    queryFn: async () => await invoke<Record<string, string>>('instance_play_history'),
  })
}

// --- World Vault -----------------------------------------------------------

export interface WorldSummary {
  folder: string
  display_name: string
  size_bytes: number
  file_count: number
  last_played_ms: number | null
  version_name: string | null
  hardcore: boolean
  icon: string | null
  checkpoint_count: number
}

export interface WorldCheckpoint {
  id: string
  instance_id: string
  folder: string
  display_name: string
  created_at: string
  reason: string
  total_bytes: number
  entries: { path: string; sha256: string; size: number }[]
}

export function useWorlds(instanceId: string | null) {
  return useQuery({
    queryKey: queryKeys.worlds(instanceId ?? ''),
    queryFn: async () => await invoke<WorldSummary[]>('world_vault_worlds', { instanceId }),
    enabled: !!instanceId,
  })
}

export function useWorldCheckpoints(instanceId: string | null) {
  return useQuery({
    queryKey: queryKeys.worldCheckpoints(instanceId ?? ''),
    queryFn: async () =>
      await invoke<WorldCheckpoint[]>('world_vault_checkpoints', { instanceId }),
    enabled: !!instanceId,
  })
}

function useWorldVaultMutation<TArgs extends { instanceId: string }, TResult>(
  command: string,
  success: (result: TResult, args: TArgs) => string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: TArgs) => await invoke<TResult>(command, args as never),
    onSuccess: (result, args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.worlds(args.instanceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.worldCheckpoints(args.instanceId) })
      toast.success(success(result, args))
    },
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useBackupWorld() {
  return useWorldVaultMutation<
    { instanceId: string; folder: string; reason: string },
    WorldCheckpoint
  >('world_vault_backup', (_result, args) => `${args.folder} backed up`)
}

export function useRestoreWorld() {
  return useWorldVaultMutation<{ instanceId: string; checkpointId: string }, number>(
    'world_vault_restore',
    (files) => `${files} files restored`,
  )
}

export function useDeleteWorldCheckpoint() {
  return useWorldVaultMutation<{ instanceId: string; checkpointId: string }, unknown>(
    'world_vault_delete',
    () => 'Backup deleted',
  )
}

// --- Kiza Lockfile ---------------------------------------------------------

export interface LockfileExport {
  json: string
  fileCount: number
  unreproducible: string[]
}

export type LockfileVerdict = 'match' | 'missing' | 'different' | 'extra'

export interface LockfileDiffEntry {
  path: string
  verdict: LockfileVerdict
  source?: { provider: string; project_id: string; version_id: string }
}

export interface LockfileApplied {
  restorePointId: string
  installed: string[]
  failed: string[]
  unfetchable: string[]
}

export function useExportLockfile() {
  return useMutation({
    mutationFn: async (instanceId: string) =>
      await invoke<LockfileExport>('lockfile_export', { instanceId }),
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useSaveLockfile() {
  return useMutation({
    mutationFn: async ({ instanceId, destination }: { instanceId: string; destination: string }) =>
      await invoke<string>('lockfile_save', { instanceId, destination }),
    onSuccess: (path) => toast.success(`Lockfile written to ${path}`),
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useReadLockfile() {
  return useMutation({
    mutationFn: async (path: string) => await invoke<string>('lockfile_read', { path }),
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useDiffLockfile() {
  return useMutation({
    mutationFn: async ({ instanceId, raw }: { instanceId: string; raw: string }) =>
      await invoke<LockfileDiffEntry[]>('lockfile_diff', { instanceId, raw }),
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useApplyLockfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, raw }: { instanceId: string; raw: string }) =>
      await invoke<LockfileApplied>('lockfile_apply', { instanceId, raw }),
    onSuccess: (result, args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mods(args.instanceId) })
      toast.success(`${result.installed.length} files installed`)
    },
    onError: (error) => toast.error(formatError(error)),
  })
}

// --- Performance Advisor ---------------------------------------------------

export type AdviceSeverity = 'critical' | 'warning' | 'tip'

export type AdviceAction =
  | { kind: 'set_max_memory'; value: number }
  | { kind: 'set_min_memory'; value: number }
  | { kind: 'use_java'; value: number }
  | { kind: 'install_mod'; value: string }
  | { kind: 'remove_mod'; value: string }

export interface Advice {
  id: string
  severity: AdviceSeverity
  title: string
  detail: string
  action?: AdviceAction
}

export interface GcSummary {
  pauses: number
  total_pause_ms: number
  max_pause_ms: number
  max_heap_after_mb: number
  heap_total_mb: number
}

export interface RunSample {
  id: string
  instance_id: string
  recorded_at: string
  label: string
  xmx_mb: number
  java_major: number
  mod_count: number
  seconds_to_menu?: number
  gc?: GcSummary
}

export type Direction = 'better' | 'worse' | 'unchanged' | 'unknown'

export interface Comparison {
  startup: Direction
  startup_delta_seconds: number | null
  worst_pause: Direction
  worst_pause_delta_ms: number | null
  total_pause: Direction
  total_pause_delta_ms: number | null
}

export interface PerformanceReport {
  advice: Advice[]
  xmsMb: number
  xmxMb: number
  totalRamMb: number | null
  javaMajor: number
  runs: RunSample[]
  comparison: Comparison | null
  measuringNextLaunch: boolean
}

export function usePerformanceReport(instanceId: string | null) {
  return useQuery({
    queryKey: queryKeys.performanceReport(instanceId ?? ''),
    queryFn: async () =>
      await invoke<PerformanceReport>('performance_report', { instanceId }),
    enabled: !!instanceId,
  })
}

function usePerformanceMutation<TArgs extends { instanceId: string }>(
  command: string,
  success?: (args: TArgs) => string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: TArgs) => await invoke<unknown>(command, args as never),
    onSuccess: (_result, args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.performanceReport(args.instanceId) })
      queryClient.invalidateQueries({ queryKey: ['instanceSettings', args.instanceId] })
      if (success) toast.success(success(args))
    },
    onError: (error) => toast.error(formatError(error)),
  })
}

export function useMeasureNextLaunch() {
  return usePerformanceMutation<{ instanceId: string; wanted: boolean }>(
    'performance_measure_next_launch',
    (args) => (args.wanted ? 'The next launch will be measured' : 'Measurement cancelled'),
  )
}

export function useApplyAdvice() {
  return usePerformanceMutation<{ instanceId: string; action: AdviceAction }>(
    'performance_apply_advice',
    () => 'Applied',
  )
}

/**
 * What Kiza occupies on disk, measured by walking the folders that exist.
 *
 * Held for a minute rather than re-measured on every visit. The walk took 1.55
 * seconds on a 1.8 GB install and grows with the folder, so re-running it each
 * time the page opened — or each time the window regained focus — was the
 * single largest stall in the settings.
 *
 * A minute is short enough that the figures stay honest, and the page carries a
 * "measure again" button for the moment after something was deleted.
 */
export function useStorageUsage() {
  return useQuery({
    queryKey: ['storageUsage'] as const,
    queryFn: async () => await invoke<StorageReport>('storage_usage'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

export function useReclaimStorage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => await invoke<number>('reclaim_storage', { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['storageUsage'] }),
    onError: (error) => toast.error(formatError(error)),
  })
}

/** Opens one of Kiza's own folders. The name is resolved in Rust, not here. */
export function useOpenKizaFolder() {
  return useMutation({
    mutationFn: async (folder: string) => await invoke<void>('open_kiza_folder', { folder }),
    onError: (error) => toast.error(formatError(error)),
  })
}

/**
 * Sends one notification so the user can see whether Windows lets them through.
 *
 * Focus Assist and a per-app block can swallow every notification while every
 * switch still reads "on", and nothing but a visible result settles it.
 */
export function useSendTestNotification() {
  return useMutation({
    mutationFn: async () => await invoke<void>('send_test_notification'),
    onError: (error) => toast.error(formatError(error)),
  })
}

/** The range the download queue honours, asked of it rather than repeated here. */
export function useDownloadConcurrencyRange() {
  return useQuery({
    queryKey: ['downloadConcurrencyRange'] as const,
    queryFn: async () => await invoke<[number, number]>('download_concurrency_range'),
    staleTime: Infinity,
  })
}

/**
 * Puts every launcher setting back to its default.
 *
 * Settings only — instances, worlds and accounts are untouched, and the
 * command has no way to reach them.
 */
export function useResetAppConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => await invoke<AppConfig>('reset_app_config'),
    onSuccess: (config) => {
      // Seeded rather than refetched: the command already returned the truth,
      // and a round trip would show the old values for a frame.
      queryClient.setQueryData(queryKeys.config, config)
      queryClient.invalidateQueries({ queryKey: ['launchAtStartup'] })
    },
    onError: (error) => toast.error(formatError(error)),
  })
}
