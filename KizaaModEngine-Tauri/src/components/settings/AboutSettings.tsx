import { useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  Check,
  CircleAlert,
  ClipboardCopy,
  Cpu,
  ExternalLink,
  Github,
  Globe,
  Info,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { useAppConfig, useCheckServices, useSystemReport } from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { useUpdaterStore } from "../../lib/updater";
import { cn } from "../../lib/utils";
import { ActionButton, Row, Section } from "./controls";
import { useThemeAsset } from "../../lib/theme/assets";

const REPOSITORY = "https://github.com/ludovicthenot/Kiza_Launcher";
const PATREON = "https://www.patreon.com/cw/nefcode";

/**
 * What this is, which version of it, what it is running on, and whether the
 * things it depends on are answering.
 *
 * The update state shown here is the launcher's real one — the same store the
 * Update button in the title bar reads — rather than a second, prettier account
 * of it that could disagree. Same for the system readings: they come from
 * `system_report.rs`, measured, not from anything the interface guessed.
 */

/** A label and value pair in the system table. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{value}</span>
    </div>
  );
}

function gigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function AboutSettings() {
  const kizaHeader = useThemeAsset("logo");
  const { t } = useI18n();
  const updater = useUpdaterStore();
  const { data: system } = useSystemReport();
  const { data: config } = useAppConfig();
  const checkServices = useCheckServices();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  const updateLine = () => {
    switch (updater.phase) {
      case "checking":
        return t("Checking…");
      case "available":
        return t("An update is available.");
      case "downloading":
        return t("Downloading the update…");
      case "ready":
      case "deferred":
        return t("An update is ready to install.");
      case "installing":
        return t("Installing…");
      default:
        return t("Kiza is up to date.");
    }
  };

  const busy = updater.phase === "checking" || updater.phase === "downloading";
  const checks = checkServices.data;

  const copyEverything = async () => {
    const lines = [
      `Kiza Launcher ${version ?? "?"} (${config?.update_channel ?? "stable"})`,
      system ? `Install: ${system.install_id.slice(-4).toUpperCase()}` : null,
      system ? `System: ${system.os} ${system.os_version} ${system.arch}` : null,
      system ? `CPU: ${system.cpu} (${system.cores} cores)` : null,
      system ? `RAM: ${(system.total_ram_mb / 1024).toFixed(1)} GB` : null,
      system?.disk
        ? `Disk ${system.disk.mount}: ${gigabytes(system.disk.free_bytes)} free of ${gigabytes(system.disk.total_bytes)}`
        : null,
      `WebView: ${navigator.userAgent}`,
    ].filter(Boolean);

    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success(t("Copied. Paste it wherever you are describing the problem."));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-secondary/10 px-4 py-8 text-center">
        <img src={kizaHeader} alt="Kiza Launcher" className="h-24 w-auto" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {version ? (
            <span className="font-mono">v{version}</span>
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          {config?.update_channel === "beta" && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
              {t("Beta")}
            </span>
          )}
        </div>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("A Minecraft launcher with isolated instances, managed mods, and a Kiza client drawn inside the game.")}
        </p>
      </div>

      <Section icon={RefreshCw} title={t("Updates")}>
        <Row label={updateLine()}>
          <ActionButton onClick={() => void updater.checkForUpdate()} busy={busy} icon={RefreshCw}>
            {t("Check now")}
          </ActionButton>
        </Row>
        <Row
          label={t("How updates arrive")}
          hint={t("Kiza checks at launch and every five minutes. Each update is signed, and one that fails its signature is refused.")}
        />
      </Section>

      <Section
        icon={Cpu}
        title={t("This machine")}
        hint={t("Measured on this computer, not guessed from the browser.")}
      >
        {system ? (
          <div className="grid grid-cols-1 gap-x-8 py-1 sm:grid-cols-2">
            <Fact label={t("System")} value={`${system.os} ${system.os_version}`} />
            <Fact label={t("Architecture")} value={system.arch} />
            <Fact label={t("Processor")} value={system.cpu || t("unknown")} />
            <Fact
              label={t("Cores")}
              value={system.cores > 0 ? String(system.cores) : t("unknown")}
            />
            <Fact label={t("Memory")} value={`${(system.total_ram_mb / 1024).toFixed(1)} GB`} />
            <Fact
              label={t("Free space")}
              value={
                system.disk
                  ? `${gigabytes(system.disk.free_bytes)} / ${gigabytes(system.disk.total_bytes)}`
                  : t("unknown")
              }
            />
            <Fact
              label={t("Installation")}
              value={
                // Shown as its last four characters. It is random, tied to no
                // account, and exists so two reports sent a week apart can be
                // recognised as the same install.
                <span className="font-mono">••••{system.install_id.slice(-4).toUpperCase()}</span>
              }
            />
            <Fact label={t("Engine")} value="Tauri" />
          </div>
        ) : (
          <div className="py-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}
        <Row label={t("Copy all of this")}>
          <ActionButton onClick={() => void copyEverything()} icon={ClipboardCopy}>
            {t("Copy")}
          </ActionButton>
        </Row>
      </Section>

      <div>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-muted-foreground" />
          {t("Quick check")}
        </h3>
        <p className="mb-2 text-xs text-muted-foreground">
          {t("Whether the services a launch depends on are answering right now.")}
        </p>

        <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
          {checks ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {checks.map((check) => (
                <div
                  key={check.id}
                  className={cn(
                    "rounded-lg border p-2 text-center",
                    check.reachable
                      ? "border-emerald-500/25 bg-emerald-500/5"
                      : "border-red-500/25 bg-red-500/5",
                  )}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    {check.reachable ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <CircleAlert className="h-3.5 w-3.5 text-red-400" />
                    )}
                    <span className="truncate text-xs font-medium">{check.label}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {check.reachable && check.latency_ms !== null
                      ? `${check.latency_ms} ms`
                      : t("No answer")}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              {checkServices.isPending ? t("Asking each of them…") : t("Not checked yet.")}
            </p>
          )}

          <div className="mt-3 flex justify-center">
            <ActionButton
              onClick={() => checkServices.mutate()}
              busy={checkServices.isPending}
              icon={Activity}
            >
              {t("Run the check")}
            </ActionButton>
          </div>
        </div>
      </div>

      <Section icon={Info} title={t("Project")}>
        <Row label={t("Source code and releases")}>
          <ActionButton onClick={() => void openUrl(REPOSITORY)} icon={Github}>
            {t("Open")}
          </ActionButton>
        </Row>
        <Row label={t("Report a problem")}>
          <ActionButton onClick={() => void openUrl(`${REPOSITORY}/issues`)} icon={ExternalLink}>
            {t("Open")}
          </ActionButton>
        </Row>
        <Row
          label={t("Support the project")}
          hint={t("Kiza is free and stays free. This is the only place anything is asked for.")}
        >
          <ActionButton onClick={() => void openUrl(PATREON)} icon={Globe}>
            {t("Patreon")}
          </ActionButton>
        </Row>
      </Section>

      {/* Named because they are other people's work, and because someone
          reading an About page is entitled to know what is inside. */}
      <Section icon={BookOpen} title={t("Built with")}>
        <Row label="Tauri, Rust, React" hint={t("The launcher itself.")} />
        <Row
          label="Modrinth, CurseForge"
          hint={t("Where mods come from. Kiza is not affiliated with either.")}
        />
        <Row
          label="Mojang, Microsoft"
          hint={t("Minecraft and the accounts that sign in to it. Kiza is not affiliated with either.")}
        />
      </Section>
    </div>
  );
}
