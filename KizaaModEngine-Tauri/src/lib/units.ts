/**
 * How Kiza writes a size on disk.
 *
 * There were four copies of this function in the launcher — one in `utils.ts`
 * and three written again inside components — and they did not all agree. The
 * World Vault and the Storage page could print different figures for the same
 * folder, which is the kind of disagreement nobody reports as a bug and
 * everybody quietly distrusts.
 *
 * There is one here now, and it reads the user's preference, which is what
 * makes the preference worth offering at all.
 */

/** "auto" follows the drive maker's convention Windows shows in Explorer. */
export type StorageUnits = "auto" | "binary" | "decimal";

const BINARY = ["B", "KiB", "MiB", "GiB", "TiB"];
const DECIMAL = ["B", "kB", "MB", "GB", "TB"];
/**
 * What Windows prints: 1024-based arithmetic under the decimal names.
 *
 * Technically wrong and worth matching anyway. Someone comparing Kiza's figure
 * against the one in Explorer's properties dialogue needs them to agree, and
 * being right on our own would just look like being wrong.
 */
const WINDOWS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(
  bytes: number,
  units: StorageUnits = "auto",
  decimals?: number,
): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";

  const base = units === "decimal" ? 1000 : 1024;
  const names = units === "binary" ? BINARY : units === "decimal" ? DECIMAL : WINDOWS;

  let value = bytes;
  let index = 0;
  while (value >= base && index < names.length - 1) {
    value /= base;
    index += 1;
  }

  // One decimal below ten, none above: "1.4 GB" is worth the character,
  // "847.3 MB" is not.
  const places = decimals ?? (index === 0 || value >= 10 ? 0 : 1);
  return `${value.toFixed(places)} ${names[index]}`;
}

export function unitsFromConfig(config: { storage_units?: string } | undefined): StorageUnits {
  const value = config?.storage_units;
  return value === "binary" || value === "decimal" ? value : "auto";
}
