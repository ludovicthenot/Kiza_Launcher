import { useEffect, useMemo, useState } from "react";
import {
  Cpu,
  FolderOpen,
  HardDrive,
  Loader2,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { GameInstanceSummary } from "../../../lib/types";
import {
  useAppConfig,
  useDeleteInstance,
  useDetectMinecraftRuntime,
  useInstancePerformanceProfile,
  useInstallMinecraftRuntime,
  useMinecraftInstallStatus,
  useMinecraftVersions,
  useOpenInstanceFolder,
  usePerformanceProfiles,
  useRenameInstance,
  useRunningInstances,
  useSaveInstancePerformanceProfile,
  useSetInstanceJava,
  useSetInstanceVersion,
  useStartMinecraftInstall,
} from "../../../lib/queries";
import {
  filterMinecraftVersionsByJava,
  javaSelectionToMajor,
  MINECRAFT_JAVA_OPTIONS,
  type MinecraftJavaSelection,
} from "../../../lib/minecraftJava";
import { filterMinecraftVersions } from "../../../lib/minecraftVersions";
import { useAppStore } from "../../../lib/store";
import { MinecraftVersionPicker } from "../../common/MinecraftVersionPicker";
import { ConfirmActionDialog } from "../../ui/confirm-action-dialog";
import { LauncherOptionPicker } from "../../ui/launcher-option-picker";
import { Badge, Button, Input, Panel } from "../../ui/primitives";

export function InstanceManagementTab({ instance }: { instance: GameInstanceSummary }) {
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);
  const { data: versions } = useMinecraftVersions();
  const { data: config } = useAppConfig();
  const { data: profiles } = usePerformanceProfiles();
  const { data: savedProfile } = useInstancePerformanceProfile(instance.id);
  const { data: runningInstances } = useRunningInstances();
  const { data: installStatus } = useMinecraftInstallStatus(instance.id);

  const renameInstance = useRenameInstance();
  const setVersion = useSetInstanceVersion();
  const setJava = useSetInstanceJava();
  const saveProfile = useSaveInstancePerformanceProfile();
  const deleteInstance = useDeleteInstance();
  const openFolder = useOpenInstanceFolder();
  const installRuntime = useInstallMinecraftRuntime();
  const startInstall = useStartMinecraftInstall();

  const [name, setName] = useState(instance.display_name);
  const [mcVersion, setMcVersion] = useState(instance.minecraft?.mc_version ?? "");
  const [java, setJavaSelection] = useState<MinecraftJavaSelection>(
    (instance.minecraft?.java_major?.toString() as MinecraftJavaSelection | undefined) ?? "auto",
  );
  const [profileId, setProfileId] = useState(savedProfile?.profile_id ?? "balanced");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isRunning = !!runningInstances?.[instance.id];
  const releasesOnly = config?.minecraft_releases_only ?? true;
  const availableVersions = useMemo(
    () =>
      filterMinecraftVersions(
        filterMinecraftVersionsByJava(versions?.versions ?? [], java),
        releasesOnly,
      ),
    [java, releasesOnly, versions?.versions],
  );
  const { data: runtime } = useDetectMinecraftRuntime(mcVersion);

  useEffect(() => {
    setName(instance.display_name);
    setMcVersion(instance.minecraft?.mc_version ?? "");
    setJavaSelection(
      (instance.minecraft?.java_major?.toString() as MinecraftJavaSelection | undefined) ?? "auto",
    );
  }, [instance.display_name, instance.minecraft?.java_major, instance.minecraft?.mc_version]);

  useEffect(() => {
    setProfileId(savedProfile?.profile_id ?? "balanced");
  }, [savedProfile?.profile_id]);

  useEffect(() => {
    if (availableVersions.some((version) => version.id === mcVersion)) return;
    const fallback =
      availableVersions.find((version) => version.type === "release")?.id ??
      availableVersions[0]?.id;
    if (fallback) setMcVersion(fallback);
  }, [availableVersions, mcVersion]);

  const selectedJavaMajor = javaSelectionToMajor(java);
  const nameChanged = !!name.trim() && name.trim() !== instance.display_name;
  const versionChanged = !!mcVersion && mcVersion !== instance.minecraft?.mc_version;
  const javaChanged = selectedJavaMajor !== (instance.minecraft?.java_major ?? null);
  const profileChanged = profileId !== (savedProfile?.profile_id ?? "balanced");
  const settingsBusy = renameInstance.isPending || setVersion.isPending || setJava.isPending;

  const saveGameSettings = async () => {
    if (nameChanged) {
      await renameInstance.mutateAsync({ instanceId: instance.id, displayName: name.trim() });
    }
    if (versionChanged) {
      await setVersion.mutateAsync({ instanceId: instance.id, mcVersion });
    }
    if (javaChanged || (versionChanged && selectedJavaMajor !== null)) {
      await setJava.mutateAsync({ instanceId: instance.id, javaMajor: selectedJavaMajor });
    }
  };

  const profileOptions = (profiles ?? []).map((profile) => ({
    value: profile.id,
    label: profile.label,
    description: `${profile.description} · ${profile.min_memory_mb}-${profile.max_memory_mb} MB`,
  }));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
      <ConfirmActionDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${instance.display_name}`}
        description="This permanently removes the instance, its worlds, content and settings. This cannot be undone."
        confirmLabel="Delete instance"
        destructive
        busy={deleteInstance.isPending}
        onConfirm={() => {
          deleteInstance.mutate(instance.id, {
            onSuccess: () => setSelectedInstanceId(null),
            onSettled: () => setConfirmDelete(false),
          });
        }}
      />

      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-balance">
              <Settings2 className="h-5 w-5 text-primary" />
              Manage instance
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Game version, Java, performance and local storage for this instance.
            </p>
          </div>
          <Badge className={isRunning ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : ""}>
            {isRunning ? "In game" : "Ready to edit"}
          </Badge>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
          <Panel className="p-5">
            <div className="mb-5">
              <h3 className="font-semibold">Game configuration</h3>
              <p className="text-sm text-muted-foreground">Changes are applied on the next installation or launch.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Instance name</label>
                <Input value={name} onChange={(event) => setName(event.target.value)} disabled={isRunning} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Java runtime</label>
                <LauncherOptionPicker
                  ariaLabel="Choose Java for this instance"
                  options={MINECRAFT_JAVA_OPTIONS}
                  value={java}
                  onValueChange={(value) => setJavaSelection(value as MinecraftJavaSelection)}
                  placeholder="Choose Java"
                  disabled={isRunning}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Minecraft version</label>
                <MinecraftVersionPicker
                  versions={availableVersions}
                  value={mcVersion}
                  onValueChange={setMcVersion}
                  releasesOnly={releasesOnly}
                  disabled={isRunning}
                />
              </div>
              <Button
                variant="primary"
                onClick={saveGameSettings}
                disabled={isRunning || settingsBusy || (!nameChanged && !versionChanged && !javaChanged)}
              >
                {settingsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save game settings
              </Button>
            </div>
          </Panel>

          <div className="space-y-5">
            <Panel className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Cpu className="h-4 w-4 text-primary" />
                    Java status
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Java {runtime?.required_major ?? selectedJavaMajor ?? "auto"}
                  </p>
                </div>
                <Badge
                  className={
                    runtime?.valid
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  }
                >
                  {runtime?.valid ? "Ready" : "Missing"}
                </Badge>
              </div>
              <p className="break-all text-xs text-muted-foreground">
                {runtime?.java_path ?? "The managed runtime will be installed when needed."}
              </p>
              {!runtime?.valid && (
                <Button
                  className="mt-4 w-full"
                  onClick={() => installRuntime.mutate({ mcVersion, javaMajor: selectedJavaMajor })}
                  disabled={installRuntime.isPending}
                >
                  {installRuntime.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Install Java
                </Button>
              )}
            </Panel>

            <Panel className="p-5">
              <h3 className="flex items-center gap-2 font-semibold">
                <HardDrive className="h-4 w-4 text-primary" />
                Installation
              </h3>
              <p className="mt-2 truncate text-xs text-muted-foreground" title={instance.install_path}>
                {instance.install_path}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button onClick={() => openFolder.mutate(instance.id)}>
                  <FolderOpen className="h-4 w-4" />
                  Open folder
                </Button>
                <Button
                  onClick={() => startInstall.mutate(instance.id)}
                  disabled={isRunning || startInstall.isPending}
                >
                  {startInstall.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  {installStatus?.ready ? "Repair" : "Install"}
                </Button>
              </div>
            </Panel>
          </div>
        </div>

        <Panel className="p-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Performance profile</label>
              <LauncherOptionPicker
                ariaLabel="Choose a performance profile"
                options={profileOptions}
                value={profileId}
                onValueChange={setProfileId}
                placeholder="Choose a profile"
                disabled={isRunning}
                loading={!profiles}
              />
            </div>
            <Button
              variant="primary"
              onClick={() => saveProfile.mutate({ instanceId: instance.id, profileId })}
              disabled={isRunning || !profileChanged || saveProfile.isPending}
            >
              {saveProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Apply profile
            </Button>
          </div>
        </Panel>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
          <div>
            <div className="text-sm font-semibold">Remove instance</div>
            <div className="text-xs text-muted-foreground">Deletes its local game files, worlds and installed content.</div>
          </div>
          <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={isRunning}>
            <Trash2 className="h-4 w-4" />
            Delete instance
          </Button>
        </div>
      </div>
    </div>
  );
}
