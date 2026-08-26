import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The interface's idea of a mod, against what the backend actually sends.
 *
 * `src/lib/types.ts` declared `files: string[]` and `ModInfo` — the struct the
 * `get_installed_mods` command returns — did not have the field at all. So
 * `mod.files` was `undefined` at runtime while TypeScript swore it was an
 * array, and the two places that call `.some()` on it took the whole launcher
 * down with "Cannot read properties of undefined".
 *
 * It survived a long time because both of those places only run once something
 * has been found to update or to blame, and nothing ever had: mods carried no
 * provenance, so the update check could never return a candidate. The first
 * check that worked crashed the interface immediately.
 *
 * A type is a promise about a payload that crosses a language boundary, and
 * nothing on either side checks it. This does.
 */

const root = path.resolve(__dirname, "..", "..");

function block(source: string, start: string): string {
  const from = source.indexOf(start);
  if (from === -1) throw new Error(`${start} not found`);
  const end = source.indexOf("\n}", from);
  return source.slice(from, end);
}

function typescriptFields(): string[] {
  const source = fs.readFileSync(path.join(root, "src", "lib", "types.ts"), "utf8");
  return [...block(source, "export interface Mod {").matchAll(/^\s*(\w+)\s*:/gm)].map(
    (match) => match[1],
  );
}

function rustFields(): string[] {
  const source = fs.readFileSync(path.join(root, "src-tauri", "src", "lib.rs"), "utf8");
  return [...block(source, "pub struct ModInfo {").matchAll(/^\s*pub (\w+)\s*:/gm)].map(
    (match) => match[1],
  );
}

describe("the mod payload", () => {
  it("sends every field the interface says it will", () => {
    const promised = typescriptFields();
    const sent = rustFields();

    expect(promised.length).toBeGreaterThan(10);
    const missing = promised.filter((field) => !sent.includes(field));

    expect(missing, `the interface reads these and the backend never sends them: ${missing}`).toEqual(
      [],
    );
  });

  /** The field whose absence caused the crash, named so the reason survives. */
  it("sends the file list the update view and the crash doctor read", () => {
    expect(rustFields()).toContain("files");
    expect(typescriptFields()).toContain("files");
  });
});
