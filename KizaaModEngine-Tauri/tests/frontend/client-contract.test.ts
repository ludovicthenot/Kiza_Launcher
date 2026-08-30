import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The two payloads the client runtime work added, checked the way the mod
 * payload is checked.
 *
 * Both are hand-written twice — once as a Rust struct or enum, once as a
 * TypeScript declaration — and nothing on either side compiles the other. That
 * is the exact shape of the bug that made `mod.files` `undefined` and took the
 * launcher down, so these two follow it here before they have the chance.
 */

const root = path.resolve(__dirname, "..", "..");

function read(...parts: string[]): string {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

function block(source: string, start: string): string {
  const from = source.indexOf(start);
  if (from === -1) throw new Error(`${start} not found`);
  const end = source.indexOf("\n}", from);
  if (end === -1) throw new Error(`${start} is not closed`);
  return source.slice(from, end);
}

function typescriptFields(declaration: string): string[] {
  return [...block(read("src", "lib", "types.ts"), declaration).matchAll(/^\s*(\w+)[?]?\s*:/gm)].map(
    (match) => match[1],
  );
}

function rustFields(declaration: string): string[] {
  return [...block(read("src-tauri", "src", "base_mod.rs"), declaration).matchAll(
    /^\s*pub (\w+)\s*:/gm,
  )].map((match) => match[1]);
}

describe("the client runtime payload", () => {
  it.each([
    ["export interface KizaClientSupport {", "pub struct KizaClientSupport {"],
    ["export interface KizaClientModuleStatus {", "pub struct KizaClientModuleStatus {"],
  ])("sends every field %s reads", (typescript, rust) => {
    const promised = typescriptFields(typescript);
    const sent = rustFields(rust);

    expect(promised.length).toBeGreaterThan(3);
    const missing = promised.filter((field) => !sent.includes(field));
    expect(
      missing,
      `the interface reads these and the backend never sends them: ${missing}`,
    ).toEqual([]);
  });

  /**
   * The panel says "at the last launch" instead of implying the present tense,
   * which only works if the backend actually sends the flag.
   */
  it("says whether the report describes a launch that has ended", () => {
    expect(rustFields("pub struct KizaClientSupport {")).toContain("from_last_launch");
    expect(typescriptFields("export interface KizaClientSupport {")).toContain(
      "from_last_launch",
    );
  });
});

describe("the Discord launcher activity", () => {
  /** Serde renames the variants to snake_case, so the wire names are these. */
  function rustActivities(): string[] {
    const source = read("src-tauri", "src", "discord_rpc.rs");
    return [...block(source, "pub enum LauncherPresenceActivity {").matchAll(/^\s{4}(\w+),/gm)].map(
      (match) =>
        match[1].replace(/[A-Z]/g, (letter, at: number) =>
          at === 0 ? letter.toLowerCase() : `_${letter.toLowerCase()}`,
        ),
    );
  }

  function typescriptActivities(): string[] {
    const source = read("src", "lib", "discord-presence.ts");
    const from = source.indexOf("export type DiscordLauncherActivity =");
    expect(from).toBeGreaterThan(-1);
    const end = source.indexOf(";", from);
    return [...source.slice(from, end).matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  }

  it("only names activities the backend can decode", () => {
    const accepted = rustActivities();
    expect(accepted.length).toBeGreaterThan(5);

    const rejected = typescriptActivities().filter((activity) => !accepted.includes(activity));
    expect(
      rejected,
      `the interface sends these and serde would refuse them: ${rejected}`,
    ).toEqual([]);
  });

  /**
   * The one the interface deliberately never sends: the launcher sets it itself
   * when a game starts. Named here so removing it from Rust is a failing test
   * rather than a presence that quietly stops changing.
   */
  it("leaves launching to the backend", () => {
    expect(rustActivities()).toContain("launching_minecraft");
    expect(typescriptActivities()).not.toContain("launching_minecraft");
  });
});
