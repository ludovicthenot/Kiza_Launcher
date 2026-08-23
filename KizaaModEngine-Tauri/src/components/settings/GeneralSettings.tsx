import { useEffect, useState } from "react";
import { Gamepad2, Loader2, MonitorCog, RefreshCw, Shield } from "lucide-react";
import {
  AppConfig,
  useAppConfig,
  useLaunchAtStartup,
  useSaveAppConfig,
  useSetLaunchAtStartup,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { useUpdaterStore } from "../../lib/updater";
import { LauncherOptionPicker } from "../ui/launcher-option-picker";
import { Checkbox } from "../ui/checkbox";
import { ConfigGate, Row, Section, Toggle } from "./controls";

/**
 * Launcher behaviour: how it starts, what it does around a game, and how it
 * updates.
 *
 * Every control here writes straight to the configuration file — there is no
 * Save button, because a settings page that can be left in an unsaved state is
 * a settings page that silently discards work.
 */
export function GeneralSettings() {
  const { t } = useI18n();
  const { data: config, isLoading, error } = useAppConfig();
  const saveConfig = useSaveAppConfig();
  const { data: startsWithWindows } = useLaunchAtStartup();
  const setStartsWithWindows = useSetLaunchAtStartup();
  const updater = useUpdaterStore();

  const [draft, setDraft] = useState<AppConfig | null>(null);
  useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  const update = (patch: Partial<AppConfig>) => {
    // The gate below only renders the controls once the draft exists, so this
    // cannot fire before then — the guard is here so the types say it too.
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
      <Section icon={MonitorCog} title={t("Startup and window")}>
        <Row label={t("Start Kiza when Windows starts")}>
          <Toggle
            label={t("Start Kiza when Windows starts")}
            checked={startsWithWindows ?? false}
            busy={setStartsWithWindows.isPending}
            onChange={(value) => setStartsWithWindows.mutate(value)}
          />
        </Row>
        <Row
          label={t("Close button action")}
          hint={t("Closing the window can keep downloads and a running game alive.")}
        >
          <div className="w-72">
            <LauncherOptionPicker
              ariaLabel={t("Close button action")}
              options={[
                { value: "tray", label: t("Minimise to the notification area") },
                { value: "quit", label: t("Quit Kiza") },
              ]}
              placeholder={t("Minimise to the notification area")}
              value={draft.close_button_action}
              onValueChange={(value) => update({ close_button_action: value })}
            />
          </div>
        </Row>
        <Row label={t("Hide Kiza while playing")}>
          <Toggle
            label={t("Hide Kiza while playing")}
            checked={draft.close_to_tray_on_launch}
            onChange={(value) => update({ close_to_tray_on_launch: value })}
          />
        </Row>
      </Section>

      <Section icon={Gamepad2} title={t("Game launch")}>
        <Row label={t("Quit the launcher after the game starts")}>
          <Toggle
            label={t("Quit the launcher after the game starts")}
            checked={draft.quit_after_launch}
            onChange={(value) => update({ quit_after_launch: value })}
          />
        </Row>
        <Row label={t("Open the Kiza Manager log window on launch")}>
          <Toggle
            label={t("Open the Kiza Manager log window on launch")}
            checked={draft.open_log_window_on_launch}
            onChange={(value) => update({ open_log_window_on_launch: value })}
          />
        </Row>
        <Row
          label={t("Check the files before playing")}
          hint={t("Catches a half-finished install before it turns into a crash.")}
        >
          <Toggle
            label={t("Check the files before playing")}
            checked={draft.verify_before_launch}
            onChange={(value) => update({ verify_before_launch: value })}
          />
        </Row>
        <Row label={t("After a crash")}>
          <div className="w-72">
            <LauncherOptionPicker
              ariaLabel={t("After a crash")}
              options={[
                { value: "report", label: t("Open the report and offer a repair") },
                { value: "safe_mode", label: t("Offer to hunt the broken mod") },
                { value: "silent", label: t("Say nothing") },
              ]}
              placeholder={t("Open the report and offer a repair")}
              value={draft.crash_action}
              onValueChange={(value) => update({ crash_action: value })}
            />
          </div>
        </Row>
      </Section>

      <Section icon={Shield} title="Discord">
        <Row label={t("Discord Rich Presence")}>
          <Toggle
            label={t("Discord Rich Presence")}
            checked={draft.enable_discord_rpc}
            onChange={(value) => update({ enable_discord_rpc: value })}
          />
        </Row>
        <div className="flex flex-wrap gap-6 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={draft.discord_show_instance_name}
              disabled={!draft.enable_discord_rpc}
              onChange={() =>
                update({ discord_show_instance_name: !draft.discord_show_instance_name })
              }
            />
            {t("Show the instance name")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={draft.discord_show_mc_version}
              disabled={!draft.enable_discord_rpc}
              onChange={() => update({ discord_show_mc_version: !draft.discord_show_mc_version })}
            />
            {t("Show the Minecraft version")}
          </label>
        </div>
        {/* Stated because it is the question anyone sharing their screen asks. */}
        <p className="py-2.5 text-xs text-muted-foreground">
          {t("Server addresses are never shared.")}
        </p>
      </Section>

      <Section icon={RefreshCw} title={t("Updates")}>
        <Row
          label={t("Download updates automatically")}
          hint={t("Installing stays your decision; only the download is automatic.")}
        >
          <Toggle
            label={t("Download updates automatically")}
            checked={draft.auto_download_updates}
            onChange={(value) => update({ auto_download_updates: value })}
          />
        </Row>
        <Row label={t("Check for an update now")}>
          <button
            type="button"
            onClick={() => void updater.checkForUpdate()}
            disabled={updater.phase === "checking"}
            className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5 text-sm transition hover:border-primary/40 disabled:opacity-60"
          >
            {updater.phase === "checking" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("Check now")}
          </button>
        </Row>
      </Section>
    </div>
      )}
    </ConfigGate>
  );
}
