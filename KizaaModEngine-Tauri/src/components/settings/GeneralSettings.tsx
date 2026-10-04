import { Gamepad2, Loader2, MonitorCog, RefreshCw, Shield, Boxes } from "lucide-react";
import {
  useLaunchAtStartup,
  useSetLaunchAtStartup,
  usePerformanceProfiles,
  useFirstRunSetup,
  useSetDefaultPerformanceProfile,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { toast } from "sonner";
import { useSettingsDraft } from "../../lib/useSettingsDraft";
import { isGatedChannel, mayFollow, useAccess } from "../../lib/access";
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
  const { draft, isLoading, error, update } = useSettingsDraft();
  const access = useAccess((state) => state.status);

  /**
   * Switching channel, which is not always a switch.
   *
   * Alpha and Beta are handed out by invitation, and the service refuses them
   * to a launcher that cannot prove it was invited. Setting the channel anyway
   * would leave somebody on a stream that answers every check with a refusal —
   * the setting would say Alpha and nothing would ever arrive.
   *
   * So an invited channel is asked for rather than set: connect Discord first,
   * and the launcher finishes the switch itself if the account is on the list.
   * What was wanted is remembered across the trip to the browser.
   */
  const chooseChannel = async (value: string) => {
    if (!isGatedChannel(value)) {
      update({ update_channel: value });
      return;
    }

    const status = access ?? (await useAccess.getState().refresh());
    if (mayFollow(status, value)) {
      update({ update_channel: value });
      return;
    }

    toast.info(t("That channel is by invitation. Connect Discord to continue."));
    try {
      await useAccess.getState().connect(value);
    } catch (problem) {
      toast.error(String(problem));
    }
  };
  const { data: startsWithWindows } = useLaunchAtStartup();
  const setStartsWithWindows = useSetLaunchAtStartup();
  // Field by field, not the whole store.
  //
  // `useUpdaterStore()` with no selector subscribes to every change in it, and
  // the store ticks on each chunk of a download. This page therefore re-rendered
  // its every row -- three pickers, six switches -- several times a second while
  // an update was coming down, which is most of what "the settings feel slow"
  // was made of.
  const updaterPhase = useUpdaterStore((state) => state.phase);
  const updaterError = useUpdaterStore((state) => state.error);
  const updaterVersion = useUpdaterStore((state) => state.version);
  const checkForUpdate = useUpdaterStore((state) => state.checkForUpdate);
  const { data: performanceProfiles } = usePerformanceProfiles();
  const { data: setupState } = useFirstRunSetup();
  const setDefaultProfile = useSetDefaultPerformanceProfile();


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
        <Row
          label={t("Send crash reports to Kiza")}
          hint={t("What the doctor found, what the launch was and the end of the log. Never your account or anything you typed. One report per kind of crash per day.")}
        >
          <div className="w-72">
            <LauncherOptionPicker
              ariaLabel={t("Send crash reports to Kiza")}
              options={[
                { value: "ask", label: t("Ask me after each crash") },
                { value: "always", label: t("Always, without asking") },
                { value: "never", label: t("Never") },
              ]}
              placeholder={t("Ask me after each crash")}
              value={draft.crash_reports ?? "ask"}
              onValueChange={(value) => update({ crash_reports: value })}
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

      <Section
        icon={Boxes}
        title={t("New instances")}
        hint={t("What a freshly created instance starts with. Each one can be changed afterwards from Manage instance.")}
      >
        <Row
          label={t("Performance profile")}
          hint={t("Sizes the memory Minecraft is given, from the RAM this machine actually has.")}
        >
          <div className="w-72">
            <LauncherOptionPicker
              ariaLabel={t("Performance profile")}
              options={(performanceProfiles ?? []).map((profile) => ({
                value: profile.id,
                label: profile.label,
                description: profile.description,
              }))}
              value={setupState?.selected_performance_profile ?? "balanced"}
              onValueChange={(value) => setDefaultProfile.mutate(value)}
              placeholder={t("Balanced")}
              loading={!performanceProfiles}
            />
          </div>
        </Row>
      </Section>

      <Section icon={RefreshCw} title={t("Updates")}>
        <Row
          label={t("Which releases to follow")}
          hint={t("Beta arrives earlier and breaks more often. Switching takes effect at the next check, not at the next launch.")}
        >
          <div className="w-72">
            <LauncherOptionPicker
              ariaLabel={t("Which releases to follow")}
              options={[
                { value: "stable", label: t("Stable — tested releases") },
                { value: "beta", label: t("Beta — early, rougher") },
                { value: "alpha", label: t("Alpha — by invitation") },
              ]}
              placeholder={t("Stable — tested releases")}
              value={draft.update_channel}
              onValueChange={(value) => void chooseChannel(value)}
            />
          </div>
        </Row>
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
        <Row
          label={t("Check for an update now")}
          hint={t("Kiza also checks by itself every five minutes.")}
        >
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => void checkForUpdate()}
              disabled={updaterPhase === "checking"}
              className="inline-flex items-center gap-2 rounded-[9px] bg-secondary/70 px-4 py-2.5 text-sm transition hover:bg-secondary disabled:opacity-60"
            >
              {updaterPhase === "checking" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {updaterPhase === "checking" ? t("Checking…") : t("Check now")}
            </button>

            {/* What the check found, in words.
                A spinning button and nothing else is what made this look like a
                page that was loading: the automatic check runs every five
                minutes and can take half a minute to fail, so somebody arriving
                mid-check saw a spinner start on its own and never learned what
                came of it. */}
            {updaterPhase === "error" && updaterError && (
              <p className="max-w-xs text-right text-xs text-amber-300">{updaterError}</p>
            )}
            {updaterPhase === "unavailable" && (
              <p className="text-right text-xs text-muted-foreground">
                {t("This is the latest release on this channel.")}
              </p>
            )}
            {(updaterPhase === "available" || updaterPhase === "ready") && updaterVersion && (
              <p className="text-right text-xs text-primary">
                {t("Version {version} is waiting.").replace("{version}", updaterVersion)}
              </p>
            )}
          </div>
        </Row>
      </Section>
    </div>
      )}
    </ConfigGate>
  );
}
