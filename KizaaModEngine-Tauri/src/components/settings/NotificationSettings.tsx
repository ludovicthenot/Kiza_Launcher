import { useEffect, useState } from "react";
import { Bell, BellRing, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  AppConfig,
  useAppConfig,
  useSaveAppConfig,
  useSendTestNotification,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { ActionButton, ConfigGate, Row, Section, Toggle } from "./controls";

/**
 * Which Windows notifications Kiza is allowed to send.
 *
 * Only three switches, and each one is attached to something the launcher
 * genuinely does. It would have been easy to draw ten — a settings page with
 * ten switches looks more capable than one with three — but a switch that
 * governs nothing is a promise the launcher quietly breaks.
 */
export function NotificationSettings() {
  const { t } = useI18n();
  const { data: config, isLoading, error } = useAppConfig();
  const saveConfig = useSaveAppConfig();
  const sendTest = useSendTestNotification();

  const [draft, setDraft] = useState<AppConfig | null>(null);
  useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  const update = (patch: Partial<AppConfig>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    saveConfig.mutate(next);
  };

  return (
    <ConfigGate
      ready={!!draft}
      loading={isLoading}
      error={error}
      message={t("Kiza could not read its settings file.")}
    >
      {draft && (
        <div className="space-y-6">
          <Section icon={Bell} title={t("When Kiza may interrupt you")}>
            <Row
              label={t("Kiza is still running in the background")}
              hint={t("Shown once, the first time closing the window hides Kiza instead of quitting it.")}
            >
              <Toggle
                label={t("Kiza is still running in the background")}
                checked={draft.notify_background}
                onChange={(value) => update({ notify_background: value })}
              />
            </Row>
            <Row
              label={t("An update is ready to install")}
              hint={t("Once the download has finished. Installing stays your decision.")}
            >
              <Toggle
                label={t("An update is ready to install")}
                checked={draft.notify_update_ready}
                onChange={(value) => update({ notify_update_ready: value })}
              />
            </Row>
            <Row
              label={t("The download queue has emptied")}
              hint={t("Off by default: a queue of forty files would mean a notice the moment you look away.")}
            >
              <Toggle
                label={t("The download queue has emptied")}
                checked={draft.notify_downloads_finished}
                onChange={(value) => update({ notify_downloads_finished: value })}
              />
            </Row>
          </Section>

          <Section
            icon={BellRing}
            title={t("Is Windows letting them through?")}
            hint={t("Focus Assist, a per-app block or a company policy can swallow every notification while these switches still read on. Nothing but a visible result settles it.")}
          >
            <Row label={t("Send one now")}>
              <ActionButton
                onClick={() =>
                  sendTest.mutate(undefined, {
                    onSuccess: () => toast.success(t("Sent. If nothing appeared, Windows is blocking them.")),
                  })
                }
                busy={sendTest.isPending}
                icon={BellRing}
              >
                {t("Test")}
              </ActionButton>
            </Row>
          </Section>

          {/* Stated because it is what anyone reading this page is deciding
              about, and neither of these goes through Windows at all. */}
          <div className="rounded-xl border border-border/60 bg-secondary/10 p-4 text-xs leading-5 text-muted-foreground">
            <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
              <Download className="h-3.5 w-3.5" />
              {t("Not covered by these switches")}
            </div>
            <p>
              {t("Messages inside the launcher window, and the badge on the Update button, are always shown. They interrupt nothing outside Kiza.")}
            </p>
            <p className="mt-1 flex items-center gap-1.5">
              <RefreshCw className="h-3 w-3" />
              {t("A crash always opens its report, whatever is set here — see After a crash, under General.")}
            </p>
          </div>
        </div>
      )}
    </ConfigGate>
  );
}
