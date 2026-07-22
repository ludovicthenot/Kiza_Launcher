export type GameInstanceStatus = 
  | "Valid"
  | "MissingPath"
  | "InvalidSignature"
  | "NoWriteAccess"
  | "Unverified";

export interface GameInstance {
  schema_version: number;
  id: string;
  game_id: string;
  display_name: string;
  install_path: string;
  executable_path: string;
  mods_path: string;
  detected_variant: string | null;
  minecraft?: MinecraftInstanceConfig | null;
  status: GameInstanceStatus;
  created_at: string;
  last_verified_at: string | null;
}

export type MinecraftLoader = 'vanilla' | 'fabric' | 'forge';

export interface MinecraftInstanceConfig {
  mc_version: string;
  loader: MinecraftLoader;
  loader_version: string | null;
  java_major?: number | null;
}

export interface GameInstanceSummary extends GameInstance {
  active_profile_id: string | null;
  mod_count: number;
  active_mod_count: number; // New field
  last_deployed_at: string | null; // New field
}

export interface ProfileModState {
  mod_id: string;
  enabled: boolean;
  load_order: number;
}

export interface Profile {
  id: string;
  name: string;
  instance_id: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  mods_state: ProfileModState[];
  notes: string | null;
}

export interface ProfileConfig {
  schema_version: number;
  active_profile_id: string | null;
  profiles: Profile[];
}

export interface Mod {
  id: string;
  name: string;
  version: string;
  description: string;
  source: string | null;
  author: string | null;
  homepage_url: string | null;
  cover_url: string | null;
  cover_path: string | null;
  file_size: number | null;
  game_versions: string[];
  loaders: string[];
  updated_at: string | null;
  enabled: boolean;
  install_date: string;
  files: string[];
  load_order: number;
  deployed_file_count: number;
}

export interface DeleteModResult {
  mod_id: string;
  mod_name: string;
  was_enabled: boolean;
  deployed_files_removed: number;
  profile_references_removed: number;
  preserved_unmanaged_files: number;
  shared_dependencies_preserved: number;
  orphan_dependencies_removed: number;
  orphan_dependencies_preserved: number;
  cleanup_pending: boolean;
}

export interface VerifyIssue {
  issue_type: string;
  path: string;
  mod_id: string | null;
  details: string;
}

export interface VerifyResult {
  ok: boolean;
  issues: VerifyIssue[];
}

export type DownloadState = 
  | "Queued"
  | "Resolving"
  | "Downloading"
  | "Paused"
  | "Retrying"
  | "Finalizing"
  | "Downloaded"
  | { Failed: string }
  | "Canceled"
  | "ReadyToInstall"
  | "Installing"
  | { Installed: string }
  | { InstallFailed: string };

export interface DownloadJob {
  id: string;
  mod_name: string;
  file_name: string;
  file_name_display: string; // New
  version: string | null; // New
  game_domain: string | null;
  mod_id: number | null;
  file_id: number | null;
  url: string | null;
  destination: string;
  temp_path: string;
  state: DownloadState;
  progress_bytes: number;
  total_bytes: number | null;
  retries: number;
  
  // Install Status
  install_status: "NotInstalled" | "ReadyToInstall" | "Installing" | "Installed" | "InstallFailed";
  installed_instance_id: string | null;
  install_error: string | null;
  installed_mod_id: string | null;
}
