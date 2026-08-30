import type { MinecraftInstanceConfig, MinecraftLoader } from "./types";

export const MINECRAFT_LOADER_LABELS: Record<MinecraftLoader, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
};

export const MINECRAFT_LOADER_OPTIONS: ReadonlyArray<{
  value: MinecraftLoader;
  label: string;
}> = (Object.keys(MINECRAFT_LOADER_LABELS) as MinecraftLoader[]).map((value) => ({
  value,
  label: MINECRAFT_LOADER_LABELS[value],
}));

export function formatMinecraftLoader(config?: MinecraftInstanceConfig | null): string {
  if (!config || config.loader === "vanilla") return "Vanilla";

  // Read from the map rather than a two-way guess: the old `fabric ? … : Forge`
  // labelled every loader that was not Fabric as Forge, so a NeoForge instance
  // would have said Forge everywhere it appeared.
  const name = MINECRAFT_LOADER_LABELS[config.loader] ?? config.loader;
  return `${name} ${config.loader_version ?? ""}`.trim();
}
