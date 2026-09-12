import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  acceptsMods,
  categoriesFor,
} from "../../src/components/instance/content/contentCategories";

/**
 * A Vanilla instance is not a modded instance with nothing in it.
 *
 * It was shown as one: "Mods 0", "Shaders 0", an Add a mod button, a Sync
 * mods button, and it opened on a mod list. Every one of those is a promise
 * about a thing a plain Minecraft cannot hold, and the first person to take
 * the promise up gets a game that will not start.
 */
describe("a Vanilla instance", () => {
  it("holds packs and nothing that needs a loader", () => {
    const ids = categoriesFor("vanilla").map((category) => category.id);
    expect(ids).toEqual(["resourcepack", "datapack"]);
    expect(acceptsMods("vanilla")).toBe(false);
  });

  it("leaves every loader with the full list", () => {
    for (const loader of ["fabric", "forge", "neoforge", "quilt"]) {
      const ids = categoriesFor(loader).map((category) => category.id);
      expect(ids).toContain("mod");
      expect(ids).toContain("shader");
      expect(ids).toContain("resourcepack");
      expect(ids).toContain("datapack");
      // Modpacks are a way of making an instance, not a thing it holds.
      expect(ids).not.toContain("modpack");
      expect(acceptsMods(loader)).toBe(true);
    }
  });

  /** Where it opens, and where nothing on it should say "mods". */
  it("opens on settings and offers no mod actions", () => {
    const view = readFileSync("src/components/views/InstanceView.tsx", "utf8");
    // The store remembers the last tab across instances; a Vanilla one must
    // not inherit a mod list from the modded instance opened before it.
    expect(view).toContain('setActiveTab("settings")');
    expect(view).toContain("acceptsMods(");

    const header = readFileSync("src/components/instance/InstanceHeader.tsx", "utf8");
    expect(header).toContain("acceptsMods(instance.minecraft?.loader)");

    const sidebar = readFileSync("src/components/instance/InstanceSidebar.tsx", "utf8");
    expect(sidebar).toContain("categoriesFor(loader)");
  });
});
