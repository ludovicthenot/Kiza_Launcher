import type { GameInstanceSummary } from "../../../lib/types";
import { useAppStore } from "../../../lib/store";
import { ModsTab } from "../mods/ModsTab";
import { ShadersTab } from "../shaders/ShadersTab";
import { PackContentTab } from "./PackContentTab";
import { InstalledModpacksTab } from "./InstalledModpacksTab";

export function InstalledContentTab({ instance }: { instance: GameInstanceSummary }) {
  const category = useAppStore((state) => state.contentCategory);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {category === "mod" && (
          <ModsTab instanceId={instance.id} lastVerifiedAt={instance.last_verified_at} />
        )}
        {category === "shader" && <ShadersTab instance={instance} mode="installed" />}
        {category === "resourcepack" && <PackContentTab instance={instance} contentType="resourcepack" />}
        {category === "datapack" && <PackContentTab instance={instance} contentType="datapack" />}
        {category === "modpack" && <InstalledModpacksTab />}
      </div>
    </div>
  );
}
