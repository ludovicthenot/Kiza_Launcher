import { describe, expect, it } from "vitest";
import { curseforgeCompat, modrinthCompat } from "../../src/lib/searchCompat";
import type { CurseForgeMod, ModrinthProjectHit } from "../../src/lib/queries";

function curseMod(indexes: { game_version: string; mod_loader: number | null }[]): CurseForgeMod {
  return { id: 1, name: "Mod", latest_files_indexes: indexes } as unknown as CurseForgeMod;
}

function modrinthHit(versions: string[], categories: string[]): ModrinthProjectHit {
  return { project_id: "p", title: "Mod", versions, categories } as unknown as ModrinthProjectHit;
}

describe("CurseForge search compatibility", () => {
  it("marks a mod without any 1.8 build as the wrong version", () => {
    const mod = curseMod([
      { game_version: "1.20.1", mod_loader: 1 },
      { game_version: "1.21.1", mod_loader: 4 },
    ]);
    expect(curseforgeCompat(mod, "1.8", "forge")).toBe("wrong_version");
  });

  it("marks a Forge 1.8 build as compatible on a Forge 1.8 instance", () => {
    const mod = curseMod([
      { game_version: "1.8", mod_loader: 1 },
      { game_version: "1.20.1", mod_loader: 1 },
    ]);
    expect(curseforgeCompat(mod, "1.8", "forge")).toBe("compatible");
  });

  it("treats a version-only 1.8 file as compatible with any loader", () => {
    // Old CurseForge files predate loader tagging: mod_loader is null or 0.
    expect(curseforgeCompat(curseMod([{ game_version: "1.8", mod_loader: null }]), "1.8", "forge")).toBe("compatible");
    expect(curseforgeCompat(curseMod([{ game_version: "1.8", mod_loader: 0 }]), "1.8", "forge")).toBe("compatible");
  });

  it("reports unknown when CurseForge exposes no file index", () => {
    expect(curseforgeCompat(curseMod([]), "1.8", "forge")).toBe("unknown");
  });
});

describe("Modrinth search compatibility", () => {
  it("flags a project that has no 1.8 version", () => {
    expect(modrinthCompat(modrinthHit(["1.20.1"], ["forge"]), "1.8", "forge")).toBe("wrong_version");
  });

  it("accepts a project listing 1.8 for the instance loader", () => {
    expect(modrinthCompat(modrinthHit(["1.8", "1.20.1"], ["forge"]), "1.8", "forge")).toBe("compatible");
  });

  it("flags a Fabric-only project on a Forge instance", () => {
    expect(modrinthCompat(modrinthHit(["1.8"], ["fabric"]), "1.8", "forge")).toBe("wrong_loader");
  });
});
