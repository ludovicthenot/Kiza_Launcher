import type { GameInstanceSummary } from "../../../lib/types";
import { useI18n } from "../../../lib/i18n";
import { useAppStore } from "../../../lib/store";
import { ModsTab } from "../mods/ModsTab";
import { ShadersTab } from "../shaders/ShadersTab";
import { ContentCategoryTabs } from "./ContentCategoryTabs";
import { PackContentTab } from "./PackContentTab";
import { InstalledModpacksTab } from "./InstalledModpacksTab";

export function InstalledContentTab({ instance }: { instance: GameInstanceSummary }) {
  const { t } = useI18n();
  const category = useAppStore((state) => state.contentCategory);

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
        {category === "resourcepack" && <PackContentTab instance={instance} contentType="resourcepack" />}
        {category === "datapack" && <PackContentTab instance={instance} contentType="datapack" />}
        {category === "modpack" && <InstalledModpacksTab />}
      </div>
    </div>
  );
}
