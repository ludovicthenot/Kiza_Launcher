import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every setting must be read by something that acts on it.
 *
 * This exists because it kept not being true. `notify_update_ready` and
 * `notify_downloads_finished` were stored and consulted by no code at all, so
 * turning either off changed nothing; then `quit_after_launch`,
 * `verify_before_launch`, `crash_action` and `auto_download_updates` turned out
 * to be the same. Four switches, drawn and labelled and explained, governing
 * nothing — and no test could have noticed, because each page rendered
 * perfectly.
 *
 * So the check is structural: pull the field names out of the Rust struct, and
 * insist each one appears somewhere that is neither its own declaration nor the
 * page that draws it. It cannot prove the reader does the right thing. It can
 * prove there is one, which is the failure that actually happened.
 */

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Where a mention does not count as a use: the struct itself, the TypeScript
 * mirror of it, and the settings pages, which only draw the control.
 */
const DECLARATION_ONLY = [
  "src-tauri/src/config_manager.rs",
  "src/lib/queries.ts",
  "src/components/settings/",
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "target", "dist", ".git"].includes(entry.name)) continue;
      sourceFiles(full, found);
    } else if (/\.(rs|ts|tsx)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function configFields(): string[] {
  const source = fs.readFileSync(
    path.join(ROOT, "src-tauri/src/config_manager.rs"),
    "utf8",
  );
  const start = source.indexOf("pub struct AppConfig");
  const end = source.indexOf("\n}\n", start);
  const struct = source.slice(start, end);

  return (
    [...struct.matchAll(/^\s*pub (\w+):/gm)]
      .map((match) => match[1])
      // Migrated to the OS keyring and deliberately never read from the file.
      .filter((field) => field !== "nexus_api_key")
  );
}

function readersOf(field: string, files: Map<string, string>): string[] {
  const pattern = new RegExp(`\\b${field}\\b`);
  const readers: string[] = [];

  for (const [file, text] of files) {
    const relative = path.relative(ROOT, file).replace(/\\/g, "/");
    if (DECLARATION_ONLY.some((skip) => relative.includes(skip))) continue;
    if (pattern.test(text)) readers.push(relative);
  }
  return readers;
}

const files = new Map(
  [
    ...sourceFiles(path.join(ROOT, "src-tauri/src")),
    ...sourceFiles(path.join(ROOT, "src")),
  ].map((file) => [file, fs.readFileSync(file, "utf8")]),
);

const fields = configFields();

describe("the settings struct", () => {
  it("was found and is not empty", () => {
    // A regex that quietly stopped matching would make every test below pass
    // by having nothing to check.
    expect(fields.length).toBeGreaterThan(30);
    expect(fields).toContain("update_channel");
    expect(fields).toContain("notify_windows");
  });
});

describe("every setting governs something", () => {
  it.each(fields)("%s is read outside its own declaration", (field) => {
    const readers = readersOf(field, files);
    expect(
      readers,
      `${field} is stored and read by nothing. Either wire it up, or take the control off the page.`,
    ).not.toHaveLength(0);
  });
});

describe("the check itself", () => {
  it("would notice a setting that governs nothing", () => {
    // Guards against the check passing because its search is too generous.
    expect(readersOf("a_setting_that_does_not_exist", files)).toHaveLength(0);
  });

  it("does not count the settings page that draws the control", () => {
    const notificationPage = path.join(
      ROOT,
      "src/components/settings/NotificationSettings.tsx",
    );
    const readers = readersOf("notify_sound", files);
    expect(readers.every((file) => !file.includes("components/settings/"))).toBe(true);
    // And the page really does mention it, so the exclusion is doing work.
    expect(fs.readFileSync(notificationPage, "utf8")).toContain("notify_sound");
  });
});
