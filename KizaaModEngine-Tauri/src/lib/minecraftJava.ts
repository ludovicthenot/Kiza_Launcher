import type { MinecraftVersionEntry } from "./queries";

export type MinecraftJavaSelection = "auto" | "8" | "17" | "21" | "25";

export const MINECRAFT_JAVA_OPTIONS: ReadonlyArray<{
  value: MinecraftJavaSelection;
  label: string;
  description: string;
}> = [
  { value: "auto", label: "Automatic", description: "Use the Java version declared by Mojang" },
  { value: "8", label: "Java 8", description: "Minecraft 1.7 to 1.16" },
  { value: "17", label: "Java 17", description: "Minecraft 1.17 to 1.20.4" },
  { value: "21", label: "Java 21", description: "Minecraft 1.20.5 to 1.21.x" },
  { value: "25", label: "Java 25", description: "Minecraft 26.x and recent previews" },
];

export function javaMajorForMinecraftVersion(version: MinecraftVersionEntry): number {
  const release = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.id.trim());
  if (release) {
    const major = Number(release[1]);
    const minor = Number(release[2]);
    const patch = Number(release[3] ?? 0);
    if (major >= 2) return 25;
    if (major === 1 && (minor > 20 || (minor === 20 && patch >= 5))) return 21;
    if (major === 1 && minor >= 17) return 17;
    return 8;
  }

  const releaseTime = Date.parse(version.releaseTime);
  if (Number.isFinite(releaseTime) && releaseTime >= Date.parse("2024-04-23T00:00:00Z")) return 21;
  if (Number.isFinite(releaseTime) && releaseTime >= Date.parse("2021-06-08T00:00:00Z")) return 17;
  return 8;
}

export function filterMinecraftVersionsByJava(
  versions: MinecraftVersionEntry[],
  selection: MinecraftJavaSelection,
): MinecraftVersionEntry[] {
  if (selection === "auto") return versions;
  const javaMajor = Number(selection);
  return versions.filter((version) => javaMajorForMinecraftVersion(version) === javaMajor);
}

export function javaSelectionToMajor(selection: MinecraftJavaSelection): number | null {
  return selection === "auto" ? null : Number(selection);
}
