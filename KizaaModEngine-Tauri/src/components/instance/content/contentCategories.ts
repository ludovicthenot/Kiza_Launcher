import { Boxes, Database, Image, Package, Sparkles, type LucideIcon } from "lucide-react";
import type { ContentCategoryId } from "../../../lib/store";

export type ContentCategory = {
  id: ContentCategoryId;
  label: string;
  icon: LucideIcon;
  modrinthType: string;
  curseClassId: number;
  installMode: "mod" | "shader" | "pack" | "modpack";
};

export const CONTENT_CATEGORIES: ContentCategory[] = [
  { id: "mod", label: "Mods", icon: Package, modrinthType: "mod", curseClassId: 6, installMode: "mod" },
  { id: "shader", label: "Shaders", icon: Sparkles, modrinthType: "shader", curseClassId: 6552, installMode: "shader" },
  { id: "resourcepack", label: "Resource packs", icon: Image, modrinthType: "resourcepack", curseClassId: 12, installMode: "pack" },
  { id: "modpack", label: "Modpacks", icon: Boxes, modrinthType: "modpack", curseClassId: 4471, installMode: "modpack" },
  { id: "datapack", label: "Data packs", icon: Database, modrinthType: "datapack", curseClassId: 6945, installMode: "pack" },
];

/**
 * What an instance can actually hold, by loader.
 *
 * A Vanilla instance cannot load a mod or a shader: there is no loader to
 * start one. It used to be shown the same five sections as a modded instance
 * anyway -- "Mods 0", "Shaders 0", an Add a mod button -- which read as a
 * modded instance with nothing in it, and invited somebody to add a mod to a
 * game that would then refuse to start. Resource packs and data packs are the
 * game's own, and stay.
 *
 * Modpacks are a way of making an instance, not something one holds, and are
 * left out everywhere.
 */
export function categoriesFor(loader: string | null | undefined): ContentCategory[] {
  const holdable = CONTENT_CATEGORIES.filter((category) => category.id !== "modpack");
  if (loader === "vanilla") {
    return holdable.filter((category) => category.id === "resourcepack" || category.id === "datapack");
  }
  return holdable;
}

/** Whether this instance can hold mods at all. */
export function acceptsMods(loader: string | null | undefined): boolean {
  return loader !== "vanilla";
}

export function getContentCategory(id: ContentCategoryId): ContentCategory {
  return CONTENT_CATEGORIES.find((category) => category.id === id) ?? CONTENT_CATEGORIES[0];
}
