import type { MinecraftInstanceConfig, MinecraftLoader } from "./types";

export const MINECRAFT_LOADER_OPTIONS: ReadonlyArray<{
  value: MinecraftLoader;
  label: string;
}> = [
  { value: "vanilla", label: "Vanilla" },
  { value: "fabric", label: "Fabric" },
  { value: "forge", label: "Forge" },
];

export function formatMinecraftLoader(config?: MinecraftInstanceConfig | null): string {
  if (!config || config.loader === "vanilla") return "Vanilla";

  const name = config.loader === "fabric" ? "Fabric" : "Forge";
  return `${name} ${config.loader_version ?? ""}`.trim();
}
