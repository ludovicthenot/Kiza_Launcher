import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  formatMinecraftLoader,
  MINECRAFT_LOADER_LABELS,
  MINECRAFT_LOADER_OPTIONS,
} from "../../src/lib/minecraftLoaders";

const root = path.resolve(__dirname, "..", "..");

/**
 * The names the backend will actually accept over the wire.
 *
 * Not the variant names: the enum carries `#[serde(rename_all = "snake_case")]`,
 * which turns `NeoForge` into `neo_forge`. An earlier version of this test
 * lowercased the variant instead of applying the rule, read `NeoForge` as
 * `neoforge`, and passed while every call naming a loader failed to
 * deserialize before it reached any Rust code — the launcher reported that
 * NeoForge had no build for a Minecraft version it has published forty-five of.
 * A per-variant `#[serde(rename = "…")]` wins over the rule, so it is read too.
 */
function acceptedLoaderNames(): string[] {
  const source = fs.readFileSync(path.join(root, "src-tauri", "src", "game_manager.rs"), "utf8");
  const from = source.indexOf("pub enum MinecraftLoader {");
  expect(from, "the loader enum moved").toBeGreaterThan(-1);
  const body = source.slice(from, source.indexOf("\n}", from));

  const snakeCase = (variant: string) =>
    variant.replace(/(?<!^)([A-Z])/g, "_$1").toLowerCase();

  return [...body.matchAll(/(?:#\[serde\(rename = "([a-z_]+)"\)\]\s*)?^\s{4}(\w+),/gm)].map(
    (match) => match[1] ?? snakeCase(match[2]),
  );
}

describe("Minecraft loaders", () => {
  it("exposes every loader the launcher can install as an explicit choice", () => {
    expect(MINECRAFT_LOADER_OPTIONS.map((loader) => loader.value)).toEqual([
      "vanilla",
      "fabric",
      "forge",
      "neoforge",
    ]);
  });

  it("only names loaders the backend will accept", () => {
    const accepted = acceptedLoaderNames();

    expect(accepted).toContain("neoforge");
    expect(accepted, "serde would decode a variant the interface never sends").not.toContain(
      "neo_forge",
    );
    expect([...Object.keys(MINECRAFT_LOADER_LABELS)].sort()).toEqual([...accepted].sort());
  });

  it("formats a resolved Forge build", () => {
    expect(
      formatMinecraftLoader({
        mc_version: "1.20.1",
        loader: "forge",
        loader_version: "47.4.21",
      }),
    ).toBe("Forge 47.4.21");
  });

  /**
   * The label used to be `loader === "fabric" ? "Fabric" : "Forge"`, so every
   * loader that was not Fabric was written as Forge — which is how choosing
   * NeoForge asked for a "Version Forge".
   */
  it("does not call NeoForge Forge", () => {
    expect(
      formatMinecraftLoader({
        mc_version: "1.21.11",
        loader: "neoforge",
        loader_version: "21.11.4-beta",
      }),
    ).toBe("NeoForge 21.11.4-beta");
  });
});
