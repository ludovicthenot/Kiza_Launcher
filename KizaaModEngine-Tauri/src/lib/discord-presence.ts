import type { ActiveTab, ContentCategoryId } from "./store";

export type DiscordLauncherActivity =
  | "browsing_instances"
  | "configuring_instance"
  | "exploring_mods"
  | "exploring_shaders"
  | "exploring_resource_packs"
  | "exploring_modpacks"
  | "exploring_data_packs"
  | "managing_content"
  | "managing_profiles"
  | "managing_worlds"
  | "viewing_activity";

const DISCOVER_ACTIVITY: Record<ContentCategoryId, DiscordLauncherActivity> = {
  mod: "exploring_mods",
  shader: "exploring_shaders",
  resourcepack: "exploring_resource_packs",
  modpack: "exploring_modpacks",
  datapack: "exploring_data_packs",
};

export function discordActivityForInstanceView(
  activeTab: ActiveTab,
  contentCategory: ContentCategoryId,
): DiscordLauncherActivity {
  if (activeTab === "discover") return DISCOVER_ACTIVITY[contentCategory];

  switch (activeTab) {
    case "settings":
      return "configuring_instance";
    case "profiles":
      return "managing_profiles";
    case "worlds":
      return "managing_worlds";
    case "logs":
      return "viewing_activity";
    case "mods":
      return "managing_content";
  }
}
