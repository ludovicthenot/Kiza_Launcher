import { useEffect, useMemo, useState } from "react";
import {
  Blocks,
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
import type { GameInstanceSummary, KizaClientSupport } from "../../../lib/types";
import { PerformancePanel } from "../PerformancePanel";
import { LockfilePanel } from "../LockfilePanel";
import { RepairPanel } from "../RepairPanel";
import { ExportInstanceDialog } from "../ExportInstanceDialog";
import {
  useAppConfig,
  useDeleteInstance,
  useDetectMinecraftRuntime,
  useInstancePerformanceProfile,
  useInstanceSettings,
  useInstallMinecraftRuntime,
  useKizaClientSupport,
  useMinecraftInstallStatus,
  useMinecraftVersions,
  useOpenInstanceFolder,
  usePerformanceProfiles,
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
import { useI18n } from "../../../lib/i18n";
import { useAppStore } from "../../../lib/store";
import { cn } from "../../../lib/utils";
import { MinecraftVersionPicker } from "../../common/MinecraftVersionPicker";
import { ConfirmActionDialog } from "../../ui/confirm-action-dialog";
import { LauncherOptionPicker } from "../../ui/launcher-option-picker";
import { Button, Input } from "../../ui/primitives";
import { ActionButton, Row, Section } from "../../settings/controls";

type Translate = (value: string) => string;

function runtimeBadgeLabel(support: KizaClientSupport | undefined, t: Translate): string {
  if (!support) return t("Checking");
  switch (support.runtime_state) {
    case "ready":
      return t("Ready");
    case "degraded":
      return t("Degraded");
    case "failed":
      return t("Failed");
    // Vanilla: no jar to install, the client is attached at launch.
    case "agent":
      return t("Attached at launch");
    default:
      if (support.installed) return t("Installed");
      return support.available ? t("Needs install") : t("Launcher only");
  }
}

function runtimeTone(support: KizaClientSupport | undefined): string {
  if (support?.runtime_state === "ready") return "text-emerald-300";
  if (support?.runtime_state === "failed") return "text-red-300";
  if (support?.runtime_state === "degraded" || support?.runtime_state === "not_installed") return "text-amber-300";
  // An instance that simply has not been launched yet is not a warning.
  return "text-muted-foreground";
}

export function InstanceManagementTab({ instance }: { instance: GameInstanceSummary }) {
  const { t } = useI18n();
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);
  const { data: versions } = useMinecraftVersions();
  const { data: config } = useAppConfig();
  const { data: profiles } = usePerformanceProfiles();
  const { data: savedProfile } = useInstancePerformanceProfile(instance.id);
  const { data: runningInstances } = useRunningInstances();
  const { data: installStatus } = useMinecraftInstallStatus(instance.id);
  const { data: instanceSettings } = useInstanceSettings(instance.id);
  const { data: clientSupport } = useKizaClientSupport(instance.id);
  // Two lists, never one. Falling back to the expected list when nothing had
  // run drew every capability in the same chip as a capability that works, so
  // an instance that had never been launched looked exactly like one where all
  // four were live. They are still both worth showing — one says what happened,
  // the other what this version can do — as long as nobody has to guess which.
  const runtimeReported = (clientSupport?.last_reported_at_ms ?? null) !== null;
  const activeCapabilities = clientSupport?.active_capabilities ?? [];
  const plannedCapabilities = runtimeReported ? [] : (clientSupport?.expected_capabilities ?? []);
  const saveSettings = useSaveInstanceSettings();

  const renameInstance = useRenameInstance();
  const setVersion = useSetInstanceVersion();
  const setJava = useSetInstanceJava();
  const saveProfile = useSaveInstancePerformanceProfile();
  const deleteInstance = useDeleteInstance();
  const openFolder = useOpenInstanceFolder();
  const installRuntime = useInstallMinecraftRuntime();
  const startInstall = useStartMinecraftInstall();
  const [exportOpen, setExportOpen] = useState(false);

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
    // Each step says its own failure; a failure stops the ones after it.
    try {
      await saveGameSettingsSteps();
    } catch {
      // Already shown by the mutation that failed.
    }
  };

  const saveGameSettingsSteps = async () => {
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

  const javaReady = !!runtime?.valid;
  const gameDirty = nameChanged || versionChanged || javaChanged;
  const fieldClass =
    "h-9 w-full rounded-[10px] border-transparent bg-secondary/45 text-right text-[13px] focus:bg-secondary/60 sm:w-64";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-2 sm:px-8">
      <ConfirmActionDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("Delete {name}?").replace("{name}", instance.display_name)}
        description={t("This permanently removes the instance, its worlds, content and settings. This cannot be undone.")}
        confirmLabel={t("Delete instance")}
        cancelLabel={t("Cancel")}
        destructive
        busy={deleteInstance.isPending}
        onConfirm={() => {
          deleteInstance.mutate(instance.id, {
            onSuccess: () => setSelectedInstanceId(null),
            onSettled: () => setConfirmDelete(false),
          });
        }}
      />

      {/* One column of grouped lists, like a settings window: what the
          instance is, how it runs, where it lives, what Kiza adds, and the
          one destructive thing last. The panels from elsewhere wear the same
          filled shape. */}
      <div className="mx-auto max-w-3xl space-y-7 [&_.kiza-panel]:border-transparent [&_.kiza-panel]:bg-secondary/[0.32] [&_.kiza-panel]:shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)] [&_.kiza-panel]:backdrop-blur-xl">
        <header>
          <h2 className="text-[22px] font-bold tracking-tight">{t("Manage instance")}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {isRunning
              ? t("The game is running: settings unlock when it closes.")
              : t("Changes apply at the next launch.")}
          </p>
        </header>

        <Section icon={Settings2} title={t("General")}>
          <Row label={t("Name")}>
            <Input value={name} onChange={(event) => setName(event.target.value)} disabled={isRunning} className={fieldClass} />
          </Row>
          <Row label={t("Minecraft version")}>
            <div className="w-full sm:w-64">
              <MinecraftVersionPicker
                versions={availableVersions}
                value={mcVersion}
                onValueChange={setMcVersion}
                releasesOnly={releasesOnly}
                disabled={isRunning}
              />
            </div>
          </Row>
          <Row label="Java" hint={javaReady ? runtime?.java_path ?? undefined : t("Installed when the game needs it.")}>
            <div className="w-full sm:w-64">
              <LauncherOptionPicker
                ariaLabel={t("Choose Java for this instance")}
                options={MINECRAFT_JAVA_OPTIONS}
                value={java}
                onValueChange={(value) => setJavaSelection(value as MinecraftJavaSelection)}
                placeholder={t("Choose Java")}
                disabled={isRunning}
              />
            </div>
          </Row>
          {/* Save appears only when something changed, beside a word saying so. */}
          {gameDirty && (
            <div className="flex items-center justify-between gap-3 py-2.5 animate-in fade-in-0 duration-200">
              <span className="text-xs text-muted-foreground">{t("Unsaved changes")}</span>
              <Button variant="primary" className="h-8 px-3 text-[13px]" onClick={saveGameSettings} disabled={isRunning || settingsBusy}>
                {settingsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {t("Save")}
              </Button>
            </div>
          )}
        </Section>

        <Section icon={Cpu} title={t("Performance")} hint={t("Leave a field empty to use the profile or the automatic value.")}>
          <Row label={t("Profile")}>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className="w-full sm:w-64">
                <LauncherOptionPicker
                  ariaLabel={t("Choose a performance profile")}
                  options={profileOptions}
                  value={profileId}
                  onValueChange={setProfileId}
                  placeholder={t("Choose a profile")}
                  disabled={isRunning}
                  loading={!profiles}
                />
              </div>
              {profileChanged && (
                <Button variant="primary" className="h-8 shrink-0 px-3 text-[13px]" onClick={() => saveProfile.mutate({ instanceId: instance.id, profileId })} disabled={isRunning || saveProfile.isPending}>
                  {saveProfile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("Apply")}
                </Button>
              )}
            </div>
          </Row>
          <Row label={t("Memory")} hint={t("Minimum and maximum, in MB.")}>
            <div className="flex w-full items-center gap-2 sm:w-64">
              <Input value={minMem} onChange={(event) => setMinMem(event.target.value)} placeholder={t("Auto")} disabled={isRunning} className={cn(fieldClass, "sm:w-full")} />
              <span className="text-muted-foreground">–</span>
              <Input value={maxMem} onChange={(event) => setMaxMem(event.target.value)} placeholder={t("Auto")} disabled={isRunning} className={cn(fieldClass, "sm:w-full")} />
            </div>
          </Row>
          <Row label={t("Java path")} hint={t("Leave empty to use the managed runtime.")}>
            <Input value={javaPath} onChange={(event) => setJavaPath(event.target.value)} placeholder={t("Managed")} disabled={isRunning} className={fieldClass} />
          </Row>
          <Row label={t("JVM arguments")}>
            <Input value={extraArgs} onChange={(event) => setExtraArgs(event.target.value)} placeholder="-XX:MaxGCPauseMillis=40" disabled={isRunning} className={cn(fieldClass, "font-mono text-[12px]")} />
          </Row>
          <div className="flex justify-end py-2.5">
            <ActionButton icon={Save} busy={saveSettings.isPending} disabled={isRunning} onClick={saveAdvanced}>
              {t("Save")}
            </ActionButton>
          </div>
        </Section>

        <Section icon={HardDrive} title={t("Files")}>
          <Row label={t("Folder")} hint={instance.install_path}>
            <ActionButton icon={FolderOpen} onClick={() => openFolder.mutate(instance.id)}>
              {t("Open")}
            </ActionButton>
          </Row>
          <Row label={t("Game files")} hint={installStatus?.ready ? t("Everything Minecraft needs is there.") : t("Some files are missing.")}>
            <ActionButton icon={ShieldCheck} busy={startInstall.isPending} disabled={isRunning} onClick={() => startInstall.mutate(instance.id)}>
              {installStatus?.ready ? t("Repair") : t("Install")}
            </ActionButton>
          </Row>
          <Row label={`Java ${runtime?.required_major ?? selectedJavaMajor ?? ""}`.trim()} hint={javaReady ? t("Ready") : t("Missing")}>
            {!javaReady && (
              <ActionButton icon={Cpu} busy={installRuntime.isPending} onClick={() => installRuntime.mutate({ mcVersion, javaMajor: selectedJavaMajor })}>
                {t("Install Java")}
              </ActionButton>
            )}
          </Row>
          <Row label={t("Share")} hint={t("Mods, config, packs, options and worlds, as you choose.")}>
            <ActionButton icon={Share2} onClick={() => setExportOpen(true)}>
              {t("Export")}
            </ActionButton>
          </Row>
        </Section>

        <Section icon={Blocks} title={t("Kiza Client Runtime")}>
          <Row label={clientSupport?.runtime_variant ?? t("Compatibility is being checked")} hint={clientSupport?.reason ?? undefined}>
            <span className={cn("inline-flex items-center gap-1.5 text-[13px]", runtimeTone(clientSupport))}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {runtimeBadgeLabel(clientSupport, t)}
            </span>
          </Row>

          {/* Said plainly, because "ready" and "ready three weeks ago" are
              not the same sentence. */}
          {clientSupport?.installed && (
            <Row
              label={t("Last seen")}
              hint={undefined}
            >
              <span className="text-[13px] text-muted-foreground">
                {!runtimeReported
                  ? t("Never started on this instance.")
                  : clientSupport.from_last_launch
                    ? t("At the last launch")
                    : t("Active now")}
              </span>
            </Row>
          )}

          {(activeCapabilities.length > 0 || plannedCapabilities.length > 0) && (
            <div className="py-3">
              <div className="mb-2 text-xs text-muted-foreground">
                {activeCapabilities.length > 0 ? t("Running") : t("Expected on this version")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeCapabilities.map((capability) => (
                  <span key={capability} className="max-w-full truncate rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11.5px] text-emerald-300">
                    {t(capability)}
                  </span>
                ))}
                {plannedCapabilities.map((capability) => (
                  <span key={capability} className="max-w-full truncate rounded-full bg-secondary/70 px-2.5 py-1 text-[11.5px] text-muted-foreground">
                    {t(capability)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* A mod that does one of Kiza's jobs keeps it, and the page says
              which, so a missing capability reads as a choice. */}
          {clientSupport && (clientSupport.courtesies ?? []).map((courtesy) => (
            <Row
              key={courtesy.area}
              label={courtesy.area === "menu" ? t("Menu") : courtesy.area === "window" ? t("Window") : t("Discord presence")}
            >
              <span className="text-[13px] text-muted-foreground">
                {t("handled by {mod}").replace("{mod}", courtesy.mod_name)}
              </span>
            </Row>
          ))}

          {/* Why a module failed, not only that it did. */}
          {clientSupport?.modules.map((module) => (
            <Row
              key={module.id}
              label={`${t(module.name)}${module.required ? ` · ${t("Required")}` : ""}`}
              hint={module.status !== "ready" && module.detail ? t(module.detail) : undefined}
            >
              <span
                aria-label={module.status}
                className={cn(
                  "h-2 w-2 rounded-full",
                  module.status === "ready" ? "bg-emerald-400" : module.status === "failed" ? "bg-red-400" : "bg-muted-foreground/50",
                )}
              />
            </Row>
          ))}
        </Section>

        <PerformancePanel instanceId={instance.id} />
        <RepairPanel instanceId={instance.id} isRunning={isRunning} />
        <LockfilePanel instanceId={instance.id} />

        <Section icon={Trash2} title={t("Remove")}>
          <Row label={t("Delete instance")} hint={t("Deletes its local game files, worlds and installed content.")}>
            <ActionButton icon={Trash2} tone="destructive" disabled={isRunning} onClick={() => setConfirmDelete(true)}>
              {t("Delete…")}
            </ActionButton>
          </Row>
        </Section>
      </div>

      <ExportInstanceDialog
        instanceId={instance.id}
        open={exportOpen}
        onOpenChange={setExportOpen}
      />
    </div>
  );
}
