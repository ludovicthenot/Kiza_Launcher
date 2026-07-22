import { Boxes, Database, Image } from "lucide-react";
import type { GameInstanceSummary } from "../../../lib/types";
import { useI18n } from "../../../lib/i18n";
import { useAppStore } from "../../../lib/store";
import { EmptyState } from "../../ui/primitives";
import { ModsTab } from "../mods/ModsTab";
import { ShadersTab } from "../shaders/ShadersTab";
import { ContentCategoryTabs } from "./ContentCategoryTabs";

const unavailableCategories = {
  resourcepack: {
    icon: Image,
    title: "No resource packs managed yet",
    description: "Resource pack installation will appear here once it can be tracked and removed safely.",
  },
  modpack: {
    icon: Boxes,
    title: "Modpacks create new instances",
    description: "A modpack cannot be installed inside an existing instance. Its installation flow will create a separate instance.",
  },
  datapack: {
    icon: Database,
    title: "Data packs belong to a world",
    description: "Select a Minecraft world before installing a data pack so existing saves are never modified by mistake.",
  },
} as const;

export function InstalledContentTab({ instance }: { instance: GameInstanceSummary }) {
  const { t } = useI18n();
  const category = useAppStore((state) => state.contentCategory);
  const unavailable = category === "mod" || category === "shader" ? null : unavailableCategories[category];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 space-y-4 border-b border-border/50 bg-card/30 p-4 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">{t("Installed content")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Manage everything added to this Minecraft instance by category.")}
          </p>
        </div>
        <ContentCategoryTabs />
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {category === "mod" && <ModsTab instanceId={instance.id} />}
        {category === "shader" && <ShadersTab instance={instance} mode="installed" />}
        {unavailable && (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={unavailable.icon}
              title={t(unavailable.title)}
              description={t(unavailable.description)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
