import { useState } from "react";
import { useAppStore } from "../../lib/store";
import { formatMinecraftLoader } from "../../lib/minecraftLoaders";
import { GameInstanceSummary } from "../../lib/types";
import { SkinHead } from "../common/SkinHead";
import { invoke } from "@tauri-apps/api/core";
import { LaunchStatusBanner } from "./LaunchStatusBanner";
import { CheckCircle2, Loader2, Play, RefreshCw, RotateCw, Settings, ShieldCheck, Terminal, User } from "lucide-react";
import {
  useDeployMods,
  useInstancePerformanceProfile,
  useLaunchMinecraft,
  useLaunchStatus,
  useMinecraftAccount,
  useMinecraftInstallStatus,
  useOfflineAccounts,
  usePerformanceProfiles,
  useProfiles,
  useRefreshMods,
  useRunningInstances,
  useSaveInstancePerformanceProfile,
  useStartMinecraftInstall,
  useVerifyInstance,
} from "../../lib/queries";
import { cn } from "../../lib/utils";
import { acceptsMods } from "./content/contentCategories";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button, IconButton, Input } from "../ui/primitives";
import {
  isMinecraftPlayLocked,
  MinecraftInstallExperience,
  MinecraftPlayButton,
} from "./MinecraftInstallExperience";
import { useI18n } from "../../lib/i18n";
import { Checkbox } from "../ui/checkbox";
import { LoaderLogo } from "../common/LoaderLogo";
import { part } from "../../lib/theme/parts";
import { PartIcon, PartLabel } from "../common/PartContent";

/** What each instance state is called in the header, and its colour. */
const STATUS_LABEL: Record<string, string> = {
  Valid: "Healthy",
  MissingPath: "Missing Path",
  InvalidSignature: "Invalid Signature",
  NoWriteAccess: "Read Only",
  Unverified: "Unverified",
};
const STATUS_TONE: Record<string, string> = {
  Valid: "text-emerald-300",
  MissingPath: "text-red-300",
  InvalidSignature: "text-orange-300",
  NoWriteAccess: "text-amber-300",
  Unverified: "text-muted-foreground",
};

interface InstanceHeaderProps {
  instance: GameInstanceSummary;
}

export function InstanceHeader({ instance }: InstanceHeaderProps) {
  const { t } = useI18n();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const deployMods = useDeployMods();
  const verifyInstance = useVerifyInstance();
  const refreshMods = useRefreshMods();
  const { data: profileConfig } = useProfiles(instance.id);
  const isMinecraft = instance.game_id === "minecraft";
  const { data: minecraftAccount } = useMinecraftAccount();
  const { data: offlineProfiles } = useOfflineAccounts();
  const { data: mcInstall } = useMinecraftInstallStatus(isMinecraft ? instance.id : null);
  const startMcInstall = useStartMinecraftInstall();
  const launchMinecraft = useLaunchMinecraft();
  const { data: performanceProfiles } = usePerformanceProfiles();
  const { data: instancePerfProfile } = useInstancePerformanceProfile(isMinecraft ? instance.id : null);
  const { data: runningInstances } = useRunningInstances();
  const { data: launchStatus } = useLaunchStatus(isMinecraft ? instance.id : null);
  const savePerfProfile = useSaveInstancePerformanceProfile();
  const isRunning = !!runningInstances?.[instance.id];

  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [launchUsername, setLaunchUsername] = useState("Player");
  const [launchOffline, setLaunchOffline] = useState(false);
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

  // The typed name only matters offline; with the account selected the backend
  // uses its own username, so an empty field must not block the launch.
  const usesOfflineName = !minecraftAccount || launchOffline;

  const handleLaunch = async () => {
    if ((usesOfflineName && !launchUsername.trim())
      || (isMinecraft && isMinecraftPlayLocked(mcInstall))) {
      return;
    }
    try {
      if (selectedPerfProfile && selectedPerfProfile !== instancePerfProfile?.profile_id) {
        await savePerfProfile.mutateAsync({ instanceId: instance.id, profileId: selectedPerfProfile });
      }
      launchMinecraft.mutate(
        {
          instanceId: instance.id,
          username: launchUsername.trim(),
          offline: launchOffline,
        },
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
      <div className="z-10 shrink-0 px-4 pb-4 pt-[4.25rem] sm:px-6">
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="min-w-0">
            {/* The name, then one quiet line of facts. The folder is on the
                name's tooltip and in the right-click menu, not spelled out. */}
            <h2 {...part("instance.title")} className="truncate text-[22px] font-bold leading-tight tracking-tight" title={instance.install_path}>
              {instance.display_name}
            </h2>
            <div {...part("instance.facts")} className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
              <span className={cn("inline-flex items-center gap-1.5", STATUS_TONE[instance.status] ?? "text-muted-foreground")}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {isRunning ? t("In game") : t(STATUS_LABEL[instance.status] ?? "Unverified")}
              </span>
              {mcInstall?.stage === "done" && mcInstall.ready && (
                <span className="inline-flex items-center gap-1 text-emerald-300/90" title={t("The game files are all there")}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("Verified")}
                </span>
              )}
              {instance.minecraft && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <LoaderLogo loader={instance.minecraft.loader} className="h-4 w-4 rounded-[4px] shadow-none" />
                    <span className="truncate">
                      {instance.minecraft.mc_version} · {loaderLabel}
                    </span>
                  </span>
                </>
              )}
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1" title={t("Profile")}>
                <User className="h-3.5 w-3.5" />
                {t(activeProfileName)}
              </span>
              {minecraftAccount && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <SkinHead url={minecraftAccount.skin_head_url} className="h-4 w-4 rounded-[4px]" />
                    <span className="truncate">{minecraftAccount.username}</span>
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
            {isMinecraft ? (
              // Wrapped so a theme can place it: Play moves with the theme,
              // and can never be hidden by one.
              <div {...part("instance.play")} className="flex">
                <MinecraftPlayButton
                  status={mcInstall}
                  isLaunching={launchMinecraft.isPending}
                  isRunning={isRunning}
                  isInstanceValid={instance.status === "Valid"}
                  onClick={() => setLaunchDialogOpen(true)}
                />
              </div>
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

            {/* Nothing to sync on a Vanilla instance: there are no mods, and a
                button promising to sync them is a promise about a thing that
                is not there. */}
            {acceptsMods(instance.minecraft?.loader) && (
              <Button {...part("instance.sync", { label: true, icon: true })} onClick={handleDeploy} disabled={deployMods.isPending || instance.status !== "Valid"} className={cn(deployMods.isPending && "animate-pulse")}>
                {deployMods.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PartIcon name="instance.sync" icon={RefreshCw} className="h-3.5 w-3.5" />}
                <PartLabel name="instance.sync">{t("Sync mods")}</PartLabel>
              </Button>
            )}

            {/* The small tools share one capsule, like a toolbar's group. */}
            <div {...part("instance.tools")} className="flex items-center rounded-[12px] bg-secondary/45 p-0.5">
              {isMinecraft && (isRunning || launchActive || launchStatus?.phase === "crashed") && (
                <IconButton onClick={openConsole} title={t("Open Kiza Manager console")}>
                  <Terminal className="h-4 w-4" />
                </IconButton>
              )}
              <IconButton onClick={() => verifyInstance.mutate(instance.id)} disabled={verifyInstance.isPending} title={t("Verify instance")}>
                <ShieldCheck className={cn("h-4 w-4", verifyInstance.isPending && "animate-pulse")} />
              </IconButton>
              <IconButton onClick={() => refreshMods.mutate(instance.id)} disabled={refreshMods.isPending} title={t("Refresh mods")}>
                <RotateCw className={cn("h-4 w-4", refreshMods.isPending && "animate-spin")} />
              </IconButton>
              <IconButton onClick={() => setActiveTab("settings")} title={t("Manage instance")}>
                <Settings className="h-4 w-4" />
              </IconButton>
            </div>
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

      <Dialog open={launchDialogOpen} onOpenChange={setLaunchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Launch Minecraft</DialogTitle>
            <DialogDescription>
              {minecraftAccount
                ? t("Choose which account to play with.")
                : "Connect a Microsoft account if possible; this name is only used as the offline fallback."}
            </DialogDescription>
          </DialogHeader>
          {/* With an account connected the choice has to be explicit: the
              backend used to ignore the typed name outright. */}
          {minecraftAccount && (
            <button
              type="button"
              onClick={() => setLaunchOffline(false)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border p-3 text-left transition",
                !launchOffline
                  ? "border-primary bg-primary/10"
                  : "border-border/70 bg-secondary/15 hover:border-primary/40",
              )}
            >
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-secondary/40">
                <SkinHead url={minecraftAccount.skin_head_url} className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{minecraftAccount.username}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{minecraftAccount.uuid}</div>
              </div>
              <Checkbox checked={!launchOffline} readOnly tabIndex={-1} />
            </button>
          )}

          {minecraftAccount ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setLaunchOffline(true)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border p-3 text-left transition",
                  launchOffline
                    ? "border-primary bg-primary/10"
                    : "border-border/70 bg-secondary/15 hover:border-primary/40",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{t("Play offline")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("Use a local name instead. Online servers will refuse it.")}
                  </div>
                </div>
                <Checkbox checked={launchOffline} readOnly tabIndex={-1} />
              </button>
              {launchOffline && (
                <div className="space-y-2">
                  {(offlineProfiles ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(offlineProfiles ?? []).map((profile) => (
                        <button
                          key={profile.id}
                          type="button"
                          onClick={() => setLaunchUsername(profile.username)}
                          className={cn(
                            "rounded-md border px-3 py-1.5 text-sm transition",
                            launchUsername === profile.username
                              ? "border-primary bg-primary/10"
                              : "border-border/70 bg-secondary/15 hover:border-primary/40",
                          )}
                        >
                          {profile.username}
                        </button>
                      ))}
                    </div>
                  )}
                  <Input
                    value={launchUsername}
                    onChange={(event) => setLaunchUsername(event.target.value)}
                    placeholder={t("Offline username")}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Offline username")}</label>
              <Input value={launchUsername} onChange={(event) => setLaunchUsername(event.target.value)} />
            </div>
          )}
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
                || (usesOfflineName && !launchUsername.trim())
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
