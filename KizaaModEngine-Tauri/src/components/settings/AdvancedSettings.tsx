import { useState } from "react";
import {
  ClipboardCopy,
  Database,
  FileText,
  FolderOpen,
  RefreshCcwDot,
  RotateCcw,
  ScrollText,
  Terminal,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import {
  useClearMetadataCache,
  useExportDiagnostics,
  useLogsOverview,
  useOpenKizaFolder,
  usePruneLogs,
  useRebuildInstanceIndex,
  useResetAppConfig,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { useSettingsDraft } from "../../lib/useSettingsDraft";
import { LauncherOptionPicker } from "../ui/launcher-option-picker";
import { ActionButton, ConfigGate, Row, Section } from "./controls";
import { ProblemReport } from "./ProblemReport";

/**
 * The things a settings page normally hides, and the one destructive button.
 *
 * Everything here is aimed at a person who has a problem and is trying to
 * describe it to someone else, or at one whose launcher has got itself into a
 * state. Nothing on this page is a preference — every line either produces
 * something to send, or repairs something.
 *
 * There is deliberately no "experimental features" block and no hardware
 * acceleration switch. Both would need machinery that does not exist behind
 * them yet, and a settings page whose switches are decorative is the thing this
 * whole chantier has been undoing.
 */

/** How long logs are kept. Zero is how the interface spells "for ever". */
const RETENTION_DAYS = [7, 14, 30, 90, 0];

function megabytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AdvancedSettings() {
  const { t } = useI18n();
  const openFolder = useOpenKizaFolder();
  const resetConfig = useResetAppConfig();
  const { draft, isLoading, error, update } = useSettingsDraft();
  const { data: logs } = useLogsOverview();
  const pruneLogs = usePruneLogs();
  const exportDiagnostics = useExportDiagnostics();
  const clearCache = useClearMetadataCache();
  const rebuildIndex = useRebuildInstanceIndex();
  const [confirmingReset, setConfirmingReset] = useState(false);

  const copyDiagnostics = async () => {
    const version = await getVersion().catch(() => "unknown");
    const lines = [
      `Kiza Launcher ${version}`,
      `Platform: ${navigator.platform || "unknown"}`,
      `Screen: ${window.screen.width}x${window.screen.height} @ ${window.devicePixelRatio}x`,
      `Language: ${navigator.language}`,
      // The WebView2 build, which is what an interface that renders wrongly
      // usually comes down to.
      `WebView: ${navigator.userAgent}`,
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success(t("Copied. Paste it wherever you are describing the problem."));
  };

  const retentionLabel = (days: number) =>
    days === 0 ? t("Keep them all") : t("{days} days").replace("{days}", String(days));

  return (
    <ConfigGate
      ready={!!draft}
      loading={isLoading}
      error={error}
      message={t("Kiza could not read its settings file.")}
    >
      {draft && (
        <div className="space-y-6">
          <ProblemReport />

          <Section
            icon={Terminal}
            title={t("Diagnostic tools")}
            hint={t("For when someone helping you asks for more than the report above carries.")}
          >
            <Row
              label={t("Write a diagnostic report")}
              hint={t("Version, system, storage, which services answered and how fast, and the end of the last log. No account, no e-mail, no token.")}
            >
              <ActionButton
                onClick={() =>
                  exportDiagnostics.mutate(undefined, {
                    onSuccess: (path) =>
                      toast.success(
                        t("Report written. Explorer is showing it."),
                        { description: path.split(/[\\/]/).pop() },
                      ),
                  })
                }
                busy={exportDiagnostics.isPending}
                icon={FileText}
              >
                {t("Write it")}
              </ActionButton>
            </Row>
            <Row
              label={t("Copy the details of this machine")}
              hint={t("Version, screen, language and WebView build. Short enough to paste into a message.")}
            >
              <ActionButton onClick={() => void copyDiagnostics()} icon={ClipboardCopy}>
                {t("Copy")}
              </ActionButton>
            </Row>
            <Row
              label={t("Open the Kiza folder")}
              hint={t("Everything Kiza has written: settings, instances, backups.")}
            >
              <ActionButton onClick={() => openFolder.mutate("root")} icon={FolderOpen}>
                {t("Open")}
              </ActionButton>
            </Row>
          </Section>

          <Section
            icon={ScrollText}
            title={t("Logs")}
            hint={
              logs && logs.files > 0
                ? t("{files} files, {size}{oldest}.")
                    .replace("{files}", String(logs.files))
                    .replace("{size}", megabytes(logs.bytes))
                    .replace(
                      "{oldest}",
                      logs.oldest_days === null
                        ? ""
                        : t(", oldest {days} days").replace("{days}", String(logs.oldest_days)),
                    )
                : t("Kiza has not written a log yet.")
            }
          >
            <Row
              label={t("Keep logs for")}
              hint={t("Older files are deleted when Kiza starts, and when you change this. Today's is never touched.")}
            >
              <div className="w-56">
                <LauncherOptionPicker
                  ariaLabel={t("Keep logs for")}
                  options={RETENTION_DAYS.map((days) => ({
                    value: String(days),
                    label: retentionLabel(days),
                  }))}
                  value={String(draft.log_retention_days)}
                  onValueChange={(value) => {
                    const days = Number(value);
                    update({ log_retention_days: days });
                    pruneLogs.mutate(days, {
                      onSuccess: (pruned) => {
                        if (pruned.files > 0) {
                          toast.success(
                            t("{files} old log files removed, {size} freed.")
                              .replace("{files}", String(pruned.files))
                              .replace("{size}", megabytes(pruned.bytes)),
                          );
                        }
                      },
                    });
                  }}
                  placeholder={t("14 days")}
                />
              </div>
            </Row>
            <Row
              label={t("Open the logs")}
              hint={t("The launcher's own log files, and the last game session's.")}
            >
              <ActionButton onClick={() => openFolder.mutate("logs")} icon={FolderOpen}>
                {t("Open")}
              </ActionButton>
            </Row>
          </Section>

          <Section
            icon={Wrench}
            title={t("Maintenance")}
            hint={t("Neither of these can lose a world, an instance or a save. Both only re-read or re-fetch.")}
          >
            <Row
              label={t("Rebuild the instance list")}
              hint={t("For a folder renamed by hand, a copy dropped in, or an entry left behind by a delete that failed halfway.")}
            >
              <ActionButton
                onClick={() =>
                  rebuildIndex.mutate(undefined, {
                    onSuccess: (count) =>
                      toast.success(
                        t("{count} instances found.").replace("{count}", String(count)),
                      ),
                  })
                }
                busy={rebuildIndex.isPending}
                icon={RefreshCcwDot}
              >
                {t("Rebuild")}
              </ActionButton>
            </Row>
            <Row
              label={t("Clear the metadata cache")}
              hint={t("Mod listings, version manifests and thumbnails. All of it is fetched again the next time it is needed.")}
            >
              <ActionButton
                onClick={() =>
                  clearCache.mutate(undefined, {
                    onSuccess: (freed) =>
                      toast.success(
                        freed > 0
                          ? t("{size} freed.").replace("{size}", megabytes(freed))
                          : t("The cache was already empty."),
                      ),
                  })
                }
                busy={clearCache.isPending}
                icon={Database}
              >
                {t("Clear")}
              </ActionButton>
            </Row>
          </Section>

          <Section icon={TriangleAlert} title={t("Start over")}>
            <div className="py-3">
              <Row
                label={t("Reset every launcher setting")}
                hint={t("Only the settings on these pages. Your instances, worlds and accounts are not touched.")}
              >
                {confirmingReset ? (
                  <div className="flex flex-wrap gap-2">
                    <ActionButton onClick={() => setConfirmingReset(false)}>
                      {t("Cancel")}
                    </ActionButton>
                    <ActionButton
                      onClick={() =>
                        resetConfig.mutate(undefined, {
                          onSuccess: () => {
                            setConfirmingReset(false);
                            toast.success(t("Settings are back to their defaults."));
                          },
                        })
                      }
                      busy={resetConfig.isPending}
                      icon={RotateCcw}
                      tone="destructive"
                    >
                      {t("Yes, reset them")}
                    </ActionButton>
                  </div>
                ) : (
                  // Two clicks rather than a dialogue: the action is reversible
                  // in the sense that nothing is lost but the settings
                  // themselves, so a modal would be more ceremony than it
                  // deserves — and one click would be too few.
                  <ActionButton
                    onClick={() => setConfirmingReset(true)}
                    icon={RotateCcw}
                    tone="destructive"
                  >
                    {t("Reset")}
                  </ActionButton>
                )}
              </Row>
            </div>
          </Section>

          {/* Said plainly, because its absence from this page is deliberate and
              someone will come here looking for it. */}
          <p className="text-xs leading-5 text-muted-foreground">
            {t("There is no button here that deletes your instances or worlds. Removing an instance is done from the instance itself, where you can see what you are about to lose.")}
          </p>
        </div>
      )}
    </ConfigGate>
  );
}
