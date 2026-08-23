/**
 * The text that goes out with a release.
 *
 * A written file wins over anything generated. Commit subjects are written for
 * whoever reads `git log`; release notes are read by someone deciding whether
 * to install, and those are not the same audience. When no file exists the
 * commit subjects are used as a fallback, because notes that say nothing are
 * still better than a release with none.
 *
 *     node scripts/release-notes.mjs [version]
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTES_DIR = path.join(root, "release-notes");

/** The previous tag, so the fallback knows where this release starts. */
function previousTag(version) {
  const result = spawnSync("git", ["tag", "--sort=-v:refname"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;

  const tags = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  return tags.find((tag) => tag !== `v${version}`) ?? null;
}

/** Commit subjects since the previous tag, one per line. */
function commitSubjects(version) {
  const previous = previousTag(version);
  const range = previous ? `${previous}..HEAD` : "HEAD";

  const result = spawnSync("git", ["log", range, "--format=%s", "--no-merges"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) return [];

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function releaseNotes(version) {
  const written = path.join(NOTES_DIR, `${version}.md`);
  if (fs.existsSync(written)) {
    return fs.readFileSync(written, "utf8").trim();
  }

  const subjects = commitSubjects(version);
  if (subjects.length === 0) {
    return `Kiza Launcher ${version}.`;
  }

  return [
    `Kiza Launcher ${version}`,
    "",
    ...subjects.map((subject) => `- ${subject}`),
    "",
    `_No written notes for this version; this list is its commits._`,
  ].join("\n");
}

/** The one-line form that goes into the update manifest. */
export function manifestNotes(version) {
  const full = releaseNotes(version);
  // The updater shows this in a small panel, so it takes the first meaningful
  // line rather than a whole changelog.
  const firstLine = full
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line.length > 0);

  return firstLine ?? `Kiza Launcher ${version}`;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const version =
    process.argv[2] ??
    JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  process.stdout.write(`${releaseNotes(version)}\n`);
}
