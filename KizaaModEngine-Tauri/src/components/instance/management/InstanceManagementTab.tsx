import { useEffect, useMemo, useState } from "react";
import {
  Cpu,
  FolderOpen,
  HardDrive,
  Loader2,
  Save,
  Settings2,
  Share2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { GameInstanceSummary } from "../../../lib/types";
import {
  useAppConfig,
  useDeleteInstance,
  useDetectMinecraftRuntime,
  useInstancePerformanceProfile,
  useInstanceSettings,
  useInstallMinecraftRuntime,
  useMinecraftInstallStatus,
  useMinecraftVersions,
  useOpenInstanceFolder,
  usePerformanceProfiles,
  useExportInstance,
  useRenameInstance,
  useRunningInstances,
  useSaveInstancePerformanceProfile,
  useSaveInstanceSettings,
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
  const { data: instanceSettings } = useInstanceSettings(instance.id);
  const saveSettings = useSaveInstanceSettings();

  const renameInstance = useRenameInstance();
  const setVersion = useSetInstanceVersion();
  const setJava = useSetInstanceJava();
  const saveProfile = useSaveInstancePerformanceProfile();
  const deleteInstance = useDeleteInstance();
  const openFolder = useOpenInstanceFolder();
  const installRuntime = useInstallMinecraftRuntime();
  const startInstall = useStartMinecraftInstall();
  const exportInstance = useExportInstance();

  const [name, setName] = useState(instance.display_name);
  const [mcVersion, setMcVersion] = useState(instance.minecraft?.mc_version ?? "");
  const [java, setJavaSelection] = useState<MinecraftJavaSelection>(
    (instance.minecraft?.java_major?.toString() as MinecraftJavaSelection | undefined) ?? "auto",
  );
  const [profileId, setProfileId] = useState(savedProfile?.profile_id ?? "balanced");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [javaPath, setJavaPath] = useState("");
  const [minMem, setMinMem] = useState("");
  const [maxMem, setMaxMem] = useState("");
  const [extraArgs, setExtraArgs] = useState("");

  useEffect(() => {
    setJavaPath(instanceSettings?.java_path ?? "");
    setMinMem(instanceSettings?.min_memory_mb != null ? String(instanceSettings.min_memory_mb) : "");
    setMaxMem(instanceSettings?.max_memory_mb != null ? String(instanceSettings.max_memory_mb) : "");
    setExtraArgs(instanceSettings?.extra_args ?? "");
  }, [instanceSettings]);

  const parseMem = (value: string): number | null => {
    const parsed = Number(value.trim());
    return value.trim() && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  };
  const saveAdvanced = () =>
    saveSettings.mutate({
      instanceId: instance.id,
      settings: {
        java_path: javaPath.trim() || null,
        min_memory_mb: parseMem(minMem),
        max_memory_mb: parseMem(maxMem),
        extra_args: extraArgs.trim() || null,
      },
    });

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
              <Button
                className="mt-2 w-full"
                onClick={() => exportInstance.mutate(instance.id)}
                disabled={exportInstance.isPending}
                title="Export a shareable modpack zip (importable in CurseForge, Prism, MultiMC)"
              >
                {exportInstance.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                Share / Export
              </Button>
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

        <Panel className="p-5">
          <div className="mb-4">
            <h3 className="flex items-center gap-2 font-semibold">
              <Cpu className="h-4 w-4 text-primary" />
              Advanced launch (RAM &amp; JVM)
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Per-instance overrides. Leave a field empty to use the profile / auto default.
            </p>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Optional Java override</label>
              <Input
                value={javaPath}
                onChange={(event) => setJavaPath(event.target.value)}
                placeholder="Managed runtime is preferred; override only for testing"
                disabled={isRunning}
              />
              <p className="text-xs text-muted-foreground">Leave empty to use the managed runtime.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Minimum RAM (MB)</label>
                <Input value={minMem} onChange={(event) => setMinMem(event.target.value)} placeholder="Auto" disabled={isRunning} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Maximum RAM (MB)</label>
                <Input value={maxMem} onChange={(event) => setMaxMem(event.target.value)} placeholder="Auto (from profile)" disabled={isRunning} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Extra JVM arguments</label>
              <Input
                value={extraArgs}
                onChange={(event) => setExtraArgs(event.target.value)}
                placeholder="-XX:MaxGCPauseMillis=40 (optional)"
                disabled={isRunning}
              />
            </div>
            <Button variant="primary" onClick={saveAdvanced} disabled={isRunning || saveSettings.isPending}>
              {saveSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save advanced settings
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
