// Correlates a search result (a Modrinth/CurseForge project title) with an
// already-installed file, so search rows can offer Uninstall instead of
// Install. Matching is name-based: a result is considered installed when every
// distinctive token of its title appears in an installed file name.

const STOPWORDS = new Set([
  "shader", "shaders", "shaderpack", "shaderpacks", "pack", "packs",
  "mod", "mods", "resource", "the", "and", "for", "with",
]);

function normalizeAlnum(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function distinctiveTokens(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

/** Returns the installed file name matching this title, or null. */
export function findInstalledByTitle(title: string, installedNames: string[]): string | null {
  const tokens = distinctiveTokens(title);
  if (tokens.length === 0) return null;
  for (const name of installedNames) {
    const normalized = normalizeAlnum(name);
    if (tokens.every((token) => normalized.includes(token))) return name;
  }
  return null;
}
