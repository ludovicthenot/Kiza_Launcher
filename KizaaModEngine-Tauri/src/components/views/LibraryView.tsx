import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  updateDiscordStatus,
  useCreateMinecraftInstance,
  useInstances,
  useMinecraftVersions,
  useStartMinecraftInstall,
  useVerifyInstance,
} from "../../lib/queries";
import { InstanceCard } from "../common/InstanceCard";
import { AlertCircle, Blocks, Cpu, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { useAppStore } from "../../lib/store";
import { MINECRAFT_LOADER_OPTIONS } from "../../lib/minecraftLoaders";
import type { MinecraftLoader } from "../../lib/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Badge, Button, EmptyState, Input, Panel, Select } from "../ui/primitives";

export function LibraryView() {
  const { data: instances, isLoading, error } = useInstances();
  const verifyInstance = useVerifyInstance();
  const { data: mcVersions } = useMinecraftVersions();
  const createMinecraftInstance = useCreateMinecraftInstance();
  const startMinecraftInstall = useStartMinecraftInstall();
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);

  const [isAddingMinecraft, setIsAddingMinecraft] = useState(false);
  const [minecraftDialogOpen, setMinecraftDialogOpen] = useState(false);
  const [minecraftName, setMinecraftName] = useState("Kiza Alpha");
  const [minecraftVersion, setMinecraftVersion] = useState("");
  const [minecraftLoader, setMinecraftLoader] = useState<MinecraftLoader>("vanilla");

  const minecraftInstances = useMemo(
    () => (instances ?? []).filter((instance) => instance.game_id === "minecraft"),
    [instances],
  );

  useEffect(() => {
    updateDiscordStatus(null);
  }, []);

  useEffect(() => {
    if (minecraftVersion) return;
    const latestRelease = mcVersions?.versions.find((version) => version.type === "release")?.id ?? mcVersions?.versions[0]?.id;
    if (latestRelease) setMinecraftVersion(latestRelease);
  }, [mcVersions, minecraftVersion]);

  const handleCreateMinecraft = async () => {
    if (!minecraftName.trim() || !minecraftVersion.trim()) return;

    try {
      setIsAddingMinecraft(true);
      const instance = await createMinecraftInstance.mutateAsync({
        displayName: minecraftName.trim(),
        mcVersion: minecraftVersion.trim(),
        loader: minecraftLoader,
        loaderVersion: minecraftLoader === "vanilla" ? null : "latest",
      });

      await startMinecraftInstall.mutateAsync(instance.id);
      setSelectedInstanceId(instance.id);
      setMinecraftDialogOpen(false);
    } finally {
      setIsAddingMinecraft(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-destructive">
        <AlertCircle className="mb-4 h-12 w-12" />
        <p className="text-lg font-medium">Failed to load instances</p>
        <p className="text-sm opacity-80">{String(error)}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8">
      <Dialog open={minecraftDialogOpen} onOpenChange={setMinecraftDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a Minecraft instance</DialogTitle>
            <DialogDescription>
              Create an isolated Minecraft instance with the modloader you choose.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Instance name</label>
              <Input value={minecraftName} onChange={(event) => setMinecraftName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Minecraft version</label>
              <Select
                value={minecraftVersion}
                onChange={(event) => setMinecraftVersion(event.target.value)}
                className="w-full"
              >
                {(mcVersions?.versions ?? []).slice(0, 120).map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.id} - {version.type}
                  </option>
                ))}
                {!mcVersions?.versions?.length && <option value={minecraftVersion}>{minecraftVersion || "latest"}</option>}
              </Select>
              <p className="text-xs text-muted-foreground">
                Files stay in the Kiza-managed folder. The official Minecraft launcher is never modified.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Modloader</label>
              <Select
                value={minecraftLoader}
                onChange={(event) => setMinecraftLoader(event.target.value as MinecraftLoader)}
                className="w-full"
              >
                {MINECRAFT_LOADER_OPTIONS.map((loader) => (
                  <option key={loader.value} value={loader.value}>
                    {loader.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setMinecraftDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateMinecraft}
              disabled={isAddingMinecraft || !minecraftName.trim() || !minecraftVersion.trim()}
              variant="primary"
            >
              {isAddingMinecraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Blocks className="h-4 w-4" />}
              Create and install
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="kiza-enter mb-6 flex flex-wrap items-start justify-between gap-4" style={{ "--enter-index": 0 } as React.CSSProperties}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="bg-gradient-to-r from-foreground via-foreground to-primary/80 bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl">
              Kiza Launcher Alpha
            </h1>
            <Badge className="h-6 rounded-full border-primary/30 bg-primary/10 text-primary">Minecraft only</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Create isolated Vanilla, Fabric or Forge instances and add the mods you choose.
          </p>
        </div>

        <Button
          onClick={() => setMinecraftDialogOpen(true)}
          disabled={isAddingMinecraft || createMinecraftInstance.isPending}
          variant="primary"
          className="shrink-0"
        >
          {isAddingMinecraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Blocks className="h-4 w-4" />}
          New instance
        </Button>
      </div>

      <div className="kiza-enter mb-6 grid gap-3 md:grid-cols-3" style={{ "--enter-index": 1 } as React.CSSProperties}>
        <Panel className="p-4">
          <div className="flex items-center gap-3">
            <Rocket className="h-5 w-5 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">Optimized launch</div>
              <div className="truncate text-xs text-muted-foreground">VSync off, FPS options, managed Java.</div>
            </div>
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center gap-3">
            <Cpu className="h-5 w-5 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">Modloader choice</div>
              <div className="truncate text-xs text-muted-foreground">Vanilla, Fabric or Forge per instance.</div>
            </div>
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">Isolated instances</div>
              <div className="truncate text-xs text-muted-foreground">The official launcher is never touched.</div>
            </div>
          </div>
        </Panel>
      </div>

      {minecraftInstances.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {minecraftInstances.map((instance, index) => (
            <InstanceCard
              key={instance.id}
              instance={instance}
              className="kiza-enter"
              style={{ "--enter-index": index + 2 } as React.CSSProperties}
              onClick={() => setSelectedInstanceId(instance.id)}
              onVerify={(event) => {
                event.stopPropagation();
                verifyInstance.mutate(instance.id);
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          className="min-h-[360px]"
          title="No Minecraft instance"
          description="Create your first isolated Minecraft instance and choose Vanilla, Fabric or Forge."
        />
      )}
    </div>
  );
}
