import { describe, expect, it } from "vitest";
import { discordActivityForInstanceView } from "../../src/lib/discord-presence";

describe("Discord launcher presence", () => {
  it.each([
    ["mod", "exploring_mods"],
    ["shader", "exploring_shaders"],
    ["resourcepack", "exploring_resource_packs"],
    ["modpack", "exploring_modpacks"],
    ["datapack", "exploring_data_packs"],
  ] as const)("maps Discover %s to %s", (category, expected) => {
    expect(discordActivityForInstanceView("discover", category)).toBe(expected);
  });

  it("distinguishes configuration from installed content", () => {
    expect(discordActivityForInstanceView("settings", "mod")).toBe(
      "configuring_instance",
    );
    expect(discordActivityForInstanceView("mods", "shader")).toBe(
      "managing_content",
    );
  });
});
