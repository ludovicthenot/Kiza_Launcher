import { useCallback, useState } from "react";
import type { MinecraftLoader } from "./types";
import type { NewHostedServer } from "./hostQueries";
import type { ServerPreset } from "./serverPresets";

/**
 * The creator's form, as one object.
 *
 * The card on the left and the settings panel on the right edit the same
 * draft, so a preset picked on the right shows in the card and a port typed
 * in the card is what the panel saves. `toRequest` is the only place the
 * draft becomes what the backend takes.
 */
export interface ServerDraft {
  name: string;
  description: string;
  version: string;
  loader: MinecraftLoader;
  loaderVersion: string;
  presetId: string | null;
  port: number;
  minMemoryMb: number;
  maxMemoryMb: number;
  /** null: what the Minecraft version needs. */
  javaMajor: number | null;
  jvmArgs: string;
  maxPlayers: number;
  difficulty: string;
  gamemode: string;
  onlineMode: boolean;
  pvp: boolean;
  whitelist: boolean;
  hardcore: boolean;
  seed: string;
  levelName: string;
  viewDistance: number;
  iconPath: string | null;
}

export const EMPTY_DRAFT: ServerDraft = {
  name: "",
  description: "",
  version: "",
  loader: "vanilla",
  loaderVersion: "",
  presetId: null,
  port: 25565,
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
  javaMajor: null,
  jvmArgs: "",
  maxPlayers: 20,
  difficulty: "normal",
  gamemode: "survival",
  onlineMode: true,
  pvp: true,
  whitelist: false,
  hardcore: false,
  seed: "",
  levelName: "world",
  viewDistance: 10,
  iconPath: null,
};

/** The `server.properties` a draft asks for on the first start. */
export function draftProperties(draft: ServerDraft): Record<string, string> {
  const properties: Record<string, string> = {
    "max-players": String(draft.maxPlayers),
    difficulty: draft.difficulty,
    gamemode: draft.gamemode,
    "online-mode": String(draft.onlineMode),
    pvp: String(draft.pvp),
    "white-list": String(draft.whitelist),
    hardcore: String(draft.hardcore),
    "level-name": draft.levelName.trim() || "world",
    "view-distance": String(draft.viewDistance),
  };
  if (draft.seed.trim()) properties["level-seed"] = draft.seed.trim();
  if (draft.description.trim()) properties.motd = draft.description.trim();
  return properties;
}

export function draftToRequest(draft: ServerDraft): NewHostedServer {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    mc_version: draft.version,
    loader: draft.loader,
    loader_version: draft.loader === "vanilla" ? null : draft.loaderVersion,
    preset: draft.presetId,
    port: draft.port,
    java_major: draft.javaMajor,
    min_memory_mb: draft.minMemoryMb,
    max_memory_mb: draft.maxMemoryMb,
    jvm_args: draft.jvmArgs.split(/\s+/).filter(Boolean),
    properties: draftProperties(draft),
    icon_path: draft.iconPath,
  };
}

/** What a preset fills in; the rest of the draft is left as it was. */
export function applyPreset(draft: ServerDraft, preset: ServerPreset): ServerDraft {
  return {
    ...draft,
    presetId: preset.id,
    loader: preset.loader,
    maxMemoryMb: preset.maxMemoryMb,
    ...(preset.id === "survival" ? { difficulty: "normal", gamemode: "survival" } : {}),
    ...(preset.id === "community" ? { maxPlayers: 50, whitelist: true } : {}),
    ...(preset.id === "skyblock" ? { difficulty: "hard" } : {}),
  };
}

export function useServerDraft(initial: Partial<ServerDraft> = {}) {
  const [draft, setDraft] = useState<ServerDraft>({ ...EMPTY_DRAFT, ...initial });
  const update = useCallback(<K extends keyof ServerDraft>(key: K, value: ServerDraft[K]) => {
    setDraft((current) => (current[key] === value ? current : { ...current, [key]: value }));
  }, []);
  const reset = useCallback(() => setDraft({ ...EMPTY_DRAFT, ...initial }), [initial]);
  return { draft, update, setDraft, reset };
}
