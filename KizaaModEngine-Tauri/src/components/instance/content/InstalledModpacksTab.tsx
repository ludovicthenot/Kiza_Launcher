import { Boxes, ChevronRight } from "lucide-react";
import { useInstances } from "../../../lib/queries";
import { useAppStore } from "../../../lib/store";
import { Badge, Button, EmptyState } from "../../ui/primitives";

export function InstalledModpacksTab() {
  const instances = useInstances();
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);
  const modpacks = (instances.data ?? []).filter((instance) =>
    instance.detected_variant?.startsWith("Modpack "),
  );

  if (!modpacks.length) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyState
          icon={Boxes}
          title="No modpack installed"
          description="Install a Modrinth or CurseForge modpack from Search content. Every modpack is created as an isolated instance."
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 sm:p-6">
      {modpacks.map((instance) => (
        <div
          key={instance.id}
          className="flex min-w-0 items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/40 p-4"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{instance.display_name}</div>
            <div className="mt-1 flex flex-wrap gap-2">
              <Badge>Minecraft {instance.minecraft?.mc_version ?? "unknown"}</Badge>
              <Badge>{instance.minecraft?.loader ?? "vanilla"}</Badge>
            </div>
          </div>
          <Button
            onClick={() => setSelectedInstanceId(instance.id)}
            className="h-9 shrink-0"
            variant="primary"
          >
            Open instance
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
