import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from this file rather than from the working directory, so the gate
// answers the same way whether npm, a hook or CI started it.
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(project, "src-tauri", "assets");

/**
 * Every Kiza-owned runtime jar the installer is allowed to carry.
 *
 * A count was not enough: five files still counted as five after one was
 * renamed, and adding a sixth variant failed the gate with a number instead of
 * a name. These are the names, so the failure says which one is wrong.
 */
const OWN_RUNTIME_JARS = new Set([
  "kiza-base-mod-fabric.jar",
  "kiza-base-mod-fabric-legacy.jar",
  "kiza-base-mod-forge.jar",
  "kiza-base-mod-forge-legacy.jar",
  "kiza-base-mod-forge-mid.jar",
]);

const forbiddenLayouts = [
  /(^|\/)\.minecraft\/(assets|libraries|versions)(\/|$)/i,
  /(^|\/)minecraft\/(assets|libraries|versions)\/[^/]+\/(client|server)\.jar$/i,
  /(^|\/)versions\/[^/]+\/[^/]+\.jar$/i,
];
const forbiddenJarNames = new Set(["client.jar", "server.jar", "minecraft.jar"]);

const skippedDirectories = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  "release-notes",
]);

/**
 * Walks the tree instead of asking git for tracked files.
 *
 * `git ls-files` only knows what has been added. What ships is what is on
 * disk — `include_bytes!` reads the working tree, and so does the bundler — so
 * an untracked game jar dropped into `src-tauri/assets` passed a check that was
 * looking at the index. The Kiza runtime jars themselves are frequently
 * untracked between builds, which is how the gap was found.
 */
function filesOnDisk(root) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) pending.push(full);
      } else if (entry.isFile()) {
        found.push(relative(project, full).replaceAll("\\", "/"));
      }
    }
  }
  return found;
}

/** Kept as a second pass: a forbidden file can be committed and then deleted. */
function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: project, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
      .map((file) => file.replaceAll("\\", "/"));
  } catch {
    return [];
  }
}

function forbidden(file) {
  return (
    forbiddenJarNames.has(basename(file).toLowerCase()) ||
    forbiddenLayouts.some((pattern) => pattern.test(file))
  );
}

const candidates = new Set([...filesOnDisk(project), ...trackedFiles()]);
const failures = [...candidates].filter(forbidden).sort();

if (failures.length > 0) {
  console.error("Kiza Client distribution check failed.");
  console.error(
    "Official Minecraft runtime files must be downloaded after installation, never bundled:",
  );
  for (const file of failures) console.error(`- ${file}`);
  process.exit(1);
}

let assets;
try {
  assets = readdirSync(assetsDir).filter((file) => /\.jar$/i.test(file));
} catch (error) {
  console.error(`Kiza Client distribution check failed: cannot read ${assetsDir}.`);
  console.error(String(error));
  process.exit(1);
}

const unexpected = assets.filter((file) => !OWN_RUNTIME_JARS.has(file)).sort();
const missing = [...OWN_RUNTIME_JARS].filter((file) => !assets.includes(file)).sort();
const empty = assets.filter((file) => {
  try {
    return statSync(join(assetsDir, file)).size === 0;
  } catch {
    return true;
  }
});

if (unexpected.length > 0 || missing.length > 0 || empty.length > 0) {
  console.error("Kiza Client distribution check failed in src-tauri/assets.");
  for (const file of unexpected) console.error(`- unexpected jar: ${file}`);
  for (const file of missing) console.error(`- missing runtime variant: ${file}`);
  for (const file of empty) console.error(`- empty jar: ${file}`);
  console.error("Run `npm run build:base-mod` if a variant is missing or stale.");
  process.exit(1);
}

console.log(
  `Kiza Client distribution check passed: ${assets.length} Kiza-owned runtime variants, nothing of Mojang's.`,
);
