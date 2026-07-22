import { useState } from "react";
import { useAppStore } from "../../lib/store";
import { formatMinecraftLoader } from "../../lib/minecraftLoaders";
import { GameInstanceSummary } from "../../lib/types";
import { SkinHead } from "../common/SkinHead";
import { StatusBadge } from "../common/StatusBadge";
import { invoke } from "@tauri-apps/api/core";
import { LaunchStatusBanner } from "./LaunchStatusBanner";
import { InstanceSettingsDialog } from "./InstanceSettingsDialog";
import { CheckCircle2, Loader2, Play, RefreshCw, RotateCw, Settings, Terminal, User, Wrench } from "lucide-react";
import {
  useDeployMods,
  useInstancePerformanceProfile,
  useLaunchMinecraft,
  useLaunchStatus,
  useMinecraftAccount,
  useMinecraftInstallStatus,
  usePerformanceProfiles,
  useProfiles,
  useRefreshMods,
  useRunningInstances,
  useSaveInstancePerformanceProfile,
  useStartMinecraftInstall,
  useVerifyInstance,
} from "../../lib/queries";
import { cn } from "../../lib/utils";
import { MaintenanceDialog } from "./MaintenanceDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Badge, Button, IconButton, Input } from "../ui/primitives";
import {
  isMinecraftPlayLocked,
  MinecraftInstallExperience,
  MinecraftPlayButton,
} from "./MinecraftInstallExperience";
import { useI18n } from "../../lib/i18n";

interface InstanceHeaderProps {
  instance: GameInstanceSummary;
}

export function InstanceHeader({ instance }: InstanceHeaderProps) {
  const { t } = useI18n();
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);
  const deployMods = useDeployMods();
  const verifyInstance = useVerifyInstance();
  const refreshMods = useRefreshMods();
  const { data: profileConfig } = useProfiles(instance.id);
  const isMinecraft = instance.game_id === "minecraft";
  const { data: minecraftAccount } = useMinecraftAccount();
  const { data: mcInstall } = useMinecraftInstallStatus(isMinecraft ? instance.id : null);
  const startMcInstall = useStartMinecraftInstall();
  const launchMinecraft = useLaunchMinecraft();
  const { data: performanceProfiles } = usePerformanceProfiles();
  const { data: instancePerfProfile } = useInstancePerformanceProfile(isMinecraft ? instance.id : null);
  const { data: runningInstances } = useRunningInstances();
  const { data: launchStatus } = useLaunchStatus(isMinecraft ? instance.id : null);
  const savePerfProfile = useSaveInstancePerformanceProfile();
  const isRunning = !!runningInstances?.[instance.id];

  const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [launchUsername, setLaunchUsername] = useState("Player");
  const [selectedPerfProfile, setSelectedPerfProfile] = useState<string | null>(null);

  const effectivePerfProfile = selectedPerfProfile ?? instancePerfProfile?.profile_id ?? "balanced";

  // The Kiza Manager console is a separate window; the backend opens it on
  // launch when enabled, and this button opens/focuses it on demand.
  const launchPhase = launchStatus?.phase;
  const launchActive =
    launchPhase != null && launchPhase !== "idle" && launchPhase !== "exited";
  const openConsole = () => {
    invoke("open_console_window", { instanceId: instance.id }).catch(() => undefined);
  };

  const handleLaunch = async () => {
    if (!launchUsername.trim() || (isMinecraft && isMinecraftPlayLocked(mcInstall))) return;
    try {
      if (selectedPerfProfile && selectedPerfProfile !== instancePerfProfile?.profile_id) {
        await savePerfProfile.mutateAsync({ instanceId: instance.id, profileId: selectedPerfProfile });
      }
      launchMinecraft.mutate(
        { instanceId: instance.id, username: launchUsername.trim() },
        { onSettled: () => setLaunchDialogOpen(false) },
      );
    } catch {
      // savePerfProfile already surfaced the error via toast
    }
  };

  const activeProfileName = profileConfig?.profiles.find((profile) => profile.id === profileConfig.active_profile_id)?.name || "Balanced";
  const loaderLabel = formatMinecraftLoader(instance.minecraft);

  const handleDeploy = () => {
    deployMods.mutate({
      instanceId: instance.id,
      gameId: instance.game_id,
    });
  };

  const handleMinecraftInstall = () => {
    startMcInstall.mutate(instance.id);
  };

  return (
    <>
      <div className="z-10 shrink-0 border-b border-border/50 bg-card/50 px-4 py-3 backdrop-blur-sm sm:px-6">
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="min-w-0">
            <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-lg font-bold leading-tight">
              <span className="truncate">{instance.display_name}</span>
              <Badge className="h-6 max-w-[180px] truncate rounded-full px-2 py-0 text-[10px]">
                <User className="h-3 w-3" />
                {activeProfileName}
              </Badge>
            </h2>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              <StatusBadge status={instance.status} className="h-5 px-1.5 py-0 text-[10px]" />
              {isRunning && (
                <Badge className="h-6 border-emerald-500/30 bg-emerald-500/10 px-2 py-0 text-[10px] text-emerald-300">
                  In game
                </Badge>
              )}
              {instance.minecraft && (
                <Badge className="h-6 px-2 py-0 text-[10px]">
                  MC {instance.minecraft.mc_version} / {loaderLabel}
                </Badge>
              )}
              {minecraftAccount && (
                <Badge className="h-6 max-w-[180px] px-2 py-0 text-[10px]">
                  <SkinHead url={minecraftAccount.skin_head_url} className="h-4 w-4 rounded-sm" />
                  <span className="truncate">{minecraftAccount.username}</span>
                </Badge>
              )}
              <span className="max-w-[300px] truncate text-xs text-muted-foreground" title={instance.install_path}>
                {instance.install_path}
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
            {mcInstall?.stage === "done" && mcInstall.ready && (
              <Badge className="h-8 border-emerald-500/30 bg-emerald-500/10 px-2 text-[10px] text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("Verified")}
              </Badge>
            )}

            {isMinecraft ? (
              <MinecraftPlayButton
                status={mcInstall}
                isLaunching={launchMinecraft.isPending}
                isRunning={isRunning}
                isInstanceValid={instance.status === "Valid"}
                onClick={() => setLaunchDialogOpen(true)}
              />
            ) : (
              <Button
                onClick={() => setLaunchDialogOpen(true)}
                disabled={launchMinecraft.isPending || isRunning || instance.status !== "Valid"}
                variant="primary"
                className={cn("min-w-24", launchMinecraft.isPending && "animate-pulse")}
              >
                {launchMinecraft.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {isRunning ? t("In game") : t("Play")}
              </Button>
            )}

            <Button onClick={handleDeploy} disabled={deployMods.isPending || instance.status !== "Valid"} className={cn("h-9", deployMods.isPending && "animate-pulse")}>
              {deployMods.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t("Sync mods")}
            </Button>

            {isMinecraft && (isRunning || launchActive || launchStatus?.phase === "crashed") && (
              <IconButton onClick={openConsole} title={t("Open Kiza Manager console")}>
                <Terminal className="h-4 w-4" />
              </IconButton>
            )}

            <IconButton onClick={() => verifyInstance.mutate(instance.id)} disabled={verifyInstance.isPending} title={t("Verify instance")}>
              <RefreshCw className={cn("h-4 w-4", verifyInstance.isPending && "animate-spin")} />
            </IconButton>

            <IconButton onClick={() => setIsMaintenanceOpen(true)} disabled={instance.status !== "Valid"} title={t("Maintenance")}>
              <Wrench className="h-4 w-4" />
            </IconButton>

            <IconButton onClick={() => refreshMods.mutate(instance.id)} disabled={refreshMods.isPending} title={t("Refresh mods")}>
              <RotateCw className={cn("h-4 w-4", refreshMods.isPending && "animate-spin")} />
            </IconButton>

            <IconButton onClick={() => setIsSettingsOpen(true)} title={t("Instance settings")}>
              <Settings className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        {isMinecraft && mcInstall && mcInstall.stage !== "done" && (
          <MinecraftInstallExperience
            status={mcInstall}
            loaderLabel={loaderLabel}
            isActionPending={startMcInstall.isPending}
            onInstallOrRepair={handleMinecraftInstall}
          />
        )}

        {isMinecraft && launchStatus && (
          <LaunchStatusBanner instanceId={instance.id} status={launchStatus} />
        )}
      </div>

      <MaintenanceDialog instanceId={instance.id} gameId={instance.game_id} isOpen={isMaintenanceOpen} onClose={() => setIsMaintenanceOpen(false)} />

      <InstanceSettingsDialog
        instance={instance}
        isRunning={isRunning}
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        onDeleted={() => setSelectedInstanceId(null)}
      />

      <Dialog open={launchDialogOpen} onOpenChange={setLaunchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Launch Minecraft</DialogTitle>
            <DialogDescription>
              {minecraftAccount
                ? `Launching with the active Microsoft account ${minecraftAccount.username}.`
                : "Connect a Microsoft account if possible; this name is only used as the offline fallback."}
            </DialogDescription>
          </DialogHeader>
          {minecraftAccount && (
            <div className="flex items-center gap-3 rounded-md border border-border/70 bg-secondary/15 p-3">
              <div className="h-12 w-12 overflow-hidden rounded-md border border-border bg-secondary/40">
                <SkinHead url={minecraftAccount.skin_head_url} className="h-full w-full" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{minecraftAccount.username}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{minecraftAccount.uuid}</div>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Offline username</label>
            <Input value={launchUsername} onChange={(event) => setLaunchUsername(event.target.value)} />
          </div>
          {performanceProfiles && performanceProfiles.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Performance profile</label>
              <div className="grid gap-2 sm:grid-cols-3">
                {performanceProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => setSelectedPerfProfile(profile.id)}
                    className={cn(
                      "rounded-md border p-2.5 text-left transition",
                      effectivePerfProfile === profile.id
                        ? "border-primary bg-primary/10"
                        : "border-border/70 bg-secondary/15 hover:border-primary/40",
                    )}
                  >
                    <div className="text-sm font-semibold">{profile.label}</div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {profile.min_memory_mb}M - {profile.max_memory_mb}M
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setLaunchDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleLaunch}
              disabled={
                launchMinecraft.isPending
                || savePerfProfile.isPending
                || !launchUsername.trim()
                || (isMinecraft && isMinecraftPlayLocked(mcInstall))
              }
              variant="primary"
            >
              {launchMinecraft.isPending || savePerfProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Launch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
