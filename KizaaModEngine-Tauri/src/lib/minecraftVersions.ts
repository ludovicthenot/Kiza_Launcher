import type { MinecraftVersionEntry } from "./queries";

const MINECRAFT_1_7_RELEASE_DATE = Date.parse("2013-10-25T00:00:00Z");

function isSupportedReleaseId(id: string): boolean {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(id.trim());
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major >= 2 || (major === 1 && minor >= 7);
}

export function isSupportedMinecraftVersion(version: MinecraftVersionEntry): boolean {
  if (version.type === "release") return isSupportedReleaseId(version.id);

  const releaseTime = Date.parse(version.releaseTime);
  return Number.isFinite(releaseTime) && releaseTime >= MINECRAFT_1_7_RELEASE_DATE;
}

export function filterMinecraftVersions(
  versions: MinecraftVersionEntry[],
  releasesOnly: boolean,
): MinecraftVersionEntry[] {
  return versions.filter(
    (version) =>
      isSupportedMinecraftVersion(version) &&
      (!releasesOnly || version.type === "release"),
  );
}

export function formatMinecraftVersionType(type: string): string {
  if (type === "release") return "Release";
  if (type === "snapshot") return "Snapshot";
  if (type === "old_beta") return "Old beta";
  if (type === "old_alpha") return "Old alpha";
  return type.replace(/_/g, " ");
}
