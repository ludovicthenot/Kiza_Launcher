import { Boxes, Database, Image, Package, Sparkles, type LucideIcon } from "lucide-react";
import type { ContentCategoryId } from "../../../lib/store";

export type ContentCategory = {
  id: ContentCategoryId;
  label: string;
  icon: LucideIcon;
  modrinthType: string;
  curseClassId: number;
  installMode: "mod" | "shader" | "browse";
};

export const CONTENT_CATEGORIES: ContentCategory[] = [
  { id: "mod", label: "Mods", icon: Package, modrinthType: "mod", curseClassId: 6, installMode: "mod" },
  { id: "shader", label: "Shaders", icon: Sparkles, modrinthType: "shader", curseClassId: 6552, installMode: "shader" },
  { id: "resourcepack", label: "Resource packs", icon: Image, modrinthType: "resourcepack", curseClassId: 12, installMode: "browse" },
  { id: "modpack", label: "Modpacks", icon: Boxes, modrinthType: "modpack", curseClassId: 4471, installMode: "browse" },
  { id: "datapack", label: "Data packs", icon: Database, modrinthType: "datapack", curseClassId: 6945, installMode: "browse" },
];

export function getContentCategory(id: ContentCategoryId): ContentCategory {
  return CONTENT_CATEGORIES.find((category) => category.id === id) ?? CONTENT_CATEGORIES[0];
}
