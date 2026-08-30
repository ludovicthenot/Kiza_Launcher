import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  formatMinecraftLoader,
  MINECRAFT_LOADER_LABELS,
  MINECRAFT_LOADER_OPTIONS,
} from "../../src/lib/minecraftLoaders";

const root = path.resolve(__dirname, "..", "..");

describe("Minecraft loaders", () => {
  it("exposes every loader the launcher can install as an explicit choice", () => {
    expect(MINECRAFT_LOADER_OPTIONS.map((loader) => loader.value)).toEqual([
      "vanilla",
      "fabric",
      "forge",
      "neoforge",
    ]);
  });

  /**
   * The backend decides what a loader is called on the wire; the interface
   * sends that string back on every command. A loader added on one side and not
   * the other is a runtime deserialization failure, not a type error, so the
   * two declarations are compared here.
   */
  it("names the loaders the backend will accept", () => {
    const source = fs.readFileSync(
      path.join(root, "src-tauri", "src", "game_manager.rs"),
      "utf8",
    );
    const from = source.indexOf("pub enum MinecraftLoader {");
    expect(from).toBeGreaterThan(-1);
    const variants = [
      ...source.slice(from, source.indexOf("\n}", from)).matchAll(/^\s{4}(\w+),/gm),
    ].map((match) => match[1].toLowerCase());

    expect(variants).toContain("neoforge");
    expect([...Object.keys(MINECRAFT_LOADER_LABELS)].sort()).toEqual([...variants].sort());
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
   * loader that was not Fabric was written as Forge — which a NeoForge instance
   * would have inherited everywhere its name appears.
   */
  it("does not call NeoForge Forge", () => {
    expect(
      formatMinecraftLoader({
        mc_version: "1.21.1",
        loader: "neoforge",
        loader_version: "21.1.209",
      }),
    ).toBe("NeoForge 21.1.209");
  });
});
