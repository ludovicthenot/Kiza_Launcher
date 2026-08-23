import { useState } from "react";
import { ClipboardCopy, FolderOpen, RotateCcw, Terminal, TriangleAlert } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { useOpenKizaFolder, useResetAppConfig } from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { ActionButton, Row, Section } from "./controls";

/**
 * The things a settings page normally hides, and the one destructive button.
 *
 * Everything here is aimed at a person who has a problem and is trying to
 * describe it to someone else — which is why the diagnostics are copyable text
 * rather than a panel of readings nobody can paste into a message.
 */
export function AdvancedSettings() {
  const { t } = useI18n();
  const openFolder = useOpenKizaFolder();
  const resetConfig = useResetAppConfig();
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

  return (
    <div className="space-y-6">
      <Section
        icon={Terminal}
        title={t("Reporting a problem")}
        hint={t("What someone helping you will ask for first.")}
      >
        <Row
          label={t("Copy the details of this machine")}
          hint={t("Version, screen, language and WebView build. No account and no file paths.")}
        >
          <ActionButton onClick={() => void copyDiagnostics()} icon={ClipboardCopy}>
            {t("Copy")}
          </ActionButton>
        </Row>
        <Row
          label={t("Open the logs")}
          hint={t("The launcher's own log files, and the last game session's.")}
        >
          <ActionButton onClick={() => openFolder.mutate("logs")} icon={FolderOpen}>
            {t("Open")}
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
              // Two clicks rather than a dialogue: the action is reversible in
              // the sense that nothing is lost but the settings themselves, so
              // a modal would be more ceremony than it deserves — and one
              // click would be too few.
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
    </div>
  );
}
