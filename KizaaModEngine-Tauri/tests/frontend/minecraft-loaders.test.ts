import { describe, expect, it } from "vitest";
import { formatMinecraftLoader, MINECRAFT_LOADER_OPTIONS } from "../../src/lib/minecraftLoaders";

describe("Minecraft loaders", () => {
  it("exposes Vanilla, Fabric and Forge as explicit choices", () => {
    expect(MINECRAFT_LOADER_OPTIONS.map((loader) => loader.value)).toEqual([
      "vanilla",
      "fabric",
      "forge",
    ]);
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
});
