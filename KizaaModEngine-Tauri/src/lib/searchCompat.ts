// Compatibility hints for unfiltered mod search results, mirroring how the
// CurseForge and Modrinth websites badge each mod against your loader/version
// instead of hiding non-matching results.
import type { CurseForgeMod, ModrinthProjectHit } from "./queries";

export type SearchCompat = "compatible" | "wrong_version" | "wrong_loader" | "unknown";

const KNOWN_LOADERS = ["fabric", "forge", "quilt", "neoforge"];

// CurseForge modLoader codes: 1=Forge, 4=Fabric, 5=Quilt, 6=NeoForge.
const CURSEFORGE_LOADER_CODES: Record<number, string> = {
  1: "forge",
  4: "fabric",
  5: "quilt",
  6: "neoforge",
};

export function modrinthCompat(hit: ModrinthProjectHit, mcVersion: string | null, loader: string | null): SearchCompat {
  const wantLoader = loader?.toLowerCase() ?? null;
  const hitLoaders = hit.categories.filter((c) => KNOWN_LOADERS.includes(c.toLowerCase())).map((c) => c.toLowerCase());

  const loaderOk = !wantLoader || hitLoaders.length === 0 || hitLoaders.includes(wantLoader);
  const versionOk = !mcVersion || hit.versions.length === 0 || hit.versions.includes(mcVersion);

  if (!loaderOk) return "wrong_loader";
  if (!versionOk) return "wrong_version";
  if ((wantLoader && hitLoaders.length) || (mcVersion && hit.versions.length)) return "compatible";
  return "unknown";
}

export function curseforgeCompat(mod: CurseForgeMod, mcVersion: string | null, loader: string | null): SearchCompat {
  const indexes = mod.latest_files_indexes ?? [];
  if (indexes.length === 0) return "unknown";

  const wantLoader = loader?.toLowerCase() ?? null;
  // A file index carries a specific loader only when loader-specific; null or
  // 0 ("Any") means universal (older/version-only files) and matches any loader.
  const loaderMatches = (i: (typeof indexes)[number]) =>
    !wantLoader || i.mod_loader == null || i.mod_loader === 0 || CURSEFORGE_LOADER_CODES[i.mod_loader] === wantLoader;
  const versionMatches = (i: (typeof indexes)[number]) => !mcVersion || i.game_version === mcVersion;

  if (indexes.some((i) => loaderMatches(i) && versionMatches(i))) return "compatible";
  if (indexes.some(loaderMatches)) return "wrong_version";
  return "wrong_loader";
}
