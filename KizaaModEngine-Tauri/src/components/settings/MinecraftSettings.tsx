import { AlertTriangle, Coffee, Download, Gauge, Layers, Loader2, Trash2 } from "lucide-react";
import {
  useAppConfig,
  useDetectMinecraftRuntime,
  useInstallMinecraftRuntime,
  useJavaRuntimes,
  usePerformanceProfiles,
  useRemoveJavaRuntime,
  useSaveAppConfig,
} from "../../lib/queries";
import { useStorageUnits } from "../../lib/useStorageUnits";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { ActionButton, Row, Section, Toggle } from "./controls";

/**
 * The game side: which versions are offered, and which Java runs them.
 *
 * Accounts used to live here and now do not — they moved to their own page,
 * because "Minecraft" was answering two unrelated questions at once.
 */
export function MinecraftSettings() {
  const { t } = useI18n();
  const { data: config } = useAppConfig();
  const { refetch: refetchRuntime } = useDetectMinecraftRuntime("1.20.5");
  const { data: performanceProfiles } = usePerformanceProfiles();
  const saveConfig = useSaveAppConfig();
  const installRuntime = useInstallMinecraftRuntime();
  const { data: runtimes } = useJavaRuntimes();
  const removeRuntime = useRemoveJavaRuntime();
  const formatBytes = useStorageUnits();

  const releasesOnly = config?.minecraft_releases_only ?? true;

  return (
    <div className="space-y-7">
      <Section icon={Layers} title={t("Version catalog")}>
        {/* Saved on the switch, like every other setting: a separate Save
            button was the only one left in the window. */}
        <Row label={t("Release versions only")} hint={t("Hide snapshots, pre-releases and release candidates.")}>
          <Toggle
            checked={releasesOnly}
            label={t("Release versions only")}
            busy={saveConfig.isPending}
            disabled={!config}
            onChange={(value) => config && saveConfig.mutate({ ...config, minecraft_releases_only: value })}
          />
        </Row>
      </Section>

      <div>
        <Section
          icon={Coffee}
          title={t("Java")}
          hint={t("Kiza installs the exact Java version each instance needs automatically at launch. You can pre-install the common runtimes here so the first launch is faster.")}
        >
          {/* Every managed Java is listed, installed or not: the page has to be
              able to offer an install, which means showing what is absent. */}
          {(runtimes ?? []).map((entry) => {
            const busy = installRuntime.isPending && installRuntime.variables?.javaMajor === entry.major;
            const present = entry.installed || entry.broken;
            return (
              <div key={entry.major} className="flex min-h-14 items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13.5px]">
                    <span className="font-medium">Java {entry.major}</span>
                    {entry.broken && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-300">
                        <AlertTriangle className="h-3 w-3" />
                        {t("Incomplete")}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t(entry.covers)}
                    {entry.bytes > 0 && ` · ${formatBytes(entry.bytes)}`}
                  </div>
                </div>

                <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      entry.installed ? "bg-emerald-400" : entry.broken ? "bg-amber-400" : "bg-muted-foreground/40",
                    )}
                  />
                  {entry.installed ? t("Ready") : entry.broken ? t("Broken") : t("Absent")}
                </span>

                <ActionButton
                  icon={Download}
                  busy={busy}
                  disabled={installRuntime.isPending && !busy}
                  onClick={() =>
                    installRuntime.mutate(
                      { mcVersion: null, javaMajor: entry.major },
                      { onSuccess: () => void refetchRuntime() },
                    )
                  }
                >
                  {present ? t("Repair") : t("Install")}
                </ActionButton>

                {present && (
                  <button
                    type="button"
                    onClick={() => removeRuntime.mutate(entry.major)}
                    disabled={removeRuntime.isPending}
                    title={`${t("Remove")} Java ${entry.major}`}
                    aria-label={`${t("Remove")} Java ${entry.major}`}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-secondary/70 text-muted-foreground transition-colors hover:bg-destructive/[0.15] hover:text-red-300 disabled:opacity-50"
                  >
                    {removeRuntime.isPending && removeRuntime.variables === entry.major ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </Section>
        <p className="mt-2 px-1 text-xs leading-snug text-muted-foreground">
          {t("Removing one is safe: Kiza installs whichever an instance needs again at launch.")}
        </p>
      </div>

      <div>
        <Section icon={Gauge} title={t("Performance profiles")}>
          {(performanceProfiles ?? []).map((profile) => (
            <div key={profile.id} className="flex min-h-14 items-center gap-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{t(profile.label)}</div>
                <div className="text-xs leading-snug text-muted-foreground">{t(profile.description)}</div>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatMemory(profile.min_memory_mb)} – {formatMemory(profile.max_memory_mb)}
              </span>
            </div>
          ))}
        </Section>
        <p className="mt-2 px-1 text-xs leading-snug text-muted-foreground">
          {t("Each instance picks its profile, Java, memory and JVM arguments in Manage instance → Advanced launch.")}
        </p>
      </div>
    </div>
  );
}

/** Memory as people say it: 512 MB, 2 GB, 6 GB. */
function formatMemory(megabytes: number): string {
  if (megabytes < 1024) return `${megabytes} MB`;
  const gigabytes = megabytes / 1024;
  return `${Number.isInteger(gigabytes) ? gigabytes : gigabytes.toFixed(1)} GB`;
}
