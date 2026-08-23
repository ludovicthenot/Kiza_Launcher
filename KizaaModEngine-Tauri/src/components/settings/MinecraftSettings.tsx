import { useEffect, useState } from "react";
import { Check, Download, Loader2, Save } from "lucide-react";
import {
  useAppConfig,
  useDetectMinecraftRuntime,
  useInstallMinecraftRuntime,
  usePerformanceProfiles,
  useSaveAppConfig,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

/**
 * The game side: which versions are offered, and which Java runs them.
 *
 * Accounts used to live here and now do not — they moved to their own page,
 * because "Minecraft" was answering two unrelated questions at once.
 */
export function MinecraftSettings() {
  const { t } = useI18n();
  const { data: config } = useAppConfig();
  const { data: runtime, refetch: refetchRuntime } = useDetectMinecraftRuntime("1.20.5");
  const { data: performanceProfiles } = usePerformanceProfiles();
  const saveConfig = useSaveAppConfig();
  const installRuntime = useInstallMinecraftRuntime();

  const [minecraftReleasesOnly, setMinecraftReleasesOnly] = useState(true);
  useEffect(() => {
    if (!config) return;
    setMinecraftReleasesOnly(config.minecraft_releases_only ?? true);
  }, [config]);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t("Version catalog")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Choose whether preview builds appear when creating or editing an instance.")}
            </p>
          </div>
          <button
            type="button"
            role="checkbox"
            aria-checked={minecraftReleasesOnly}
            onClick={() => setMinecraftReleasesOnly((current) => !current)}
            className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-background/45 px-3 text-left transition-[background-color,border-color] duration-150 hover:border-primary/35 hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.96]"
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-[background-color,border-color] duration-150",
                minecraftReleasesOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary/40 text-transparent",
              )}
            >
              <Check className="h-3.5 w-3.5" />
            </span>
            <span>
              <span className="block text-sm font-semibold">{t("Release versions only")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("Hide snapshots, pre-releases and release candidates.")}
              </span>
            </span>
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold">{t("Minecraft runtime")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Kiza installs the exact Java version each instance needs automatically at launch. You can pre-install the common runtimes here so the first launch is faster.")}
        </p>
      </div>

      <div className="grid gap-4 rounded-lg border border-border/70 bg-secondary/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border/70 bg-background/40 p-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              {runtime?.valid ? t("Java 21 runtime ready") : t("Java 21 runtime not installed")}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {runtime?.message ?? t("Checking Java runtime...")}
            </p>
            {runtime?.java_path && (
              <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                {runtime.java_path}
              </p>
            )}
          </div>
          <button
            onClick={() => refetchRuntime()}
            className="h-10 rounded-md border border-border bg-secondary/30 px-3 text-sm font-medium transition hover:bg-secondary active:scale-[0.96]"
          >
            {t("Refresh")}
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("Pre-install runtimes")}
          </div>
          <div className="flex flex-wrap gap-2">
            {[8, 17, 21, 25].map((major) => (
              <button
                key={major}
                onClick={() =>
                  installRuntime.mutate(
                    { mcVersion: null, javaMajor: major },
                    { onSuccess: () => refetchRuntime() },
                  )
                }
                disabled={installRuntime.isPending}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 text-sm font-medium transition hover:bg-secondary disabled:opacity-50 active:scale-[0.96]"
              >
                {installRuntime.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Java {major}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Java 8 (MC 1.7-1.16), Java 17 (1.17-1.20.4), Java 21 (1.20.5-1.21.x), Java 25 (recent snapshots and 26.x).")}
          </p>
        </div>

        <div className="rounded-md border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
          {t("Java override, RAM and extra JVM arguments are now set per instance — open an instance and use Manage instance → Advanced launch.")}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {(performanceProfiles ?? []).map((profile) => (
            <div key={profile.id} className="rounded-md border border-border/70 bg-background/40 p-3">
              <div className="text-sm font-semibold">{profile.label}</div>
              <p className="mt-2 min-h-16 text-sm leading-5 text-muted-foreground">
                {profile.description}
              </p>
              <div className="mt-3 font-mono text-xs text-muted-foreground">
                {profile.min_memory_mb}M - {profile.max_memory_mb}M
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => {
            // Only this page's own setting: everything else writes itself as it
            // is changed, and resending a stale copy from here would undo it.
            if (!config) return;
            saveConfig.mutate({
              ...config,
              minecraft_releases_only: minecraftReleasesOnly,
            });
          }}
          disabled={saveConfig.isPending}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saveConfig.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {t("Save Minecraft settings")}
        </button>
      </div>
    </div>
  );
}
