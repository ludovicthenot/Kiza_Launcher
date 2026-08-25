import { Bell, BellRing, Download, Gamepad2, Moon, RefreshCw, RotateCcw, Volume2 } from "lucide-react";
import { toast } from "sonner";
import {
  AppConfig,
  useSendTestNotification,
} from "../../lib/queries";
import { TOAST_POSITIONS } from "../../lib/notifications";
import { useI18n } from "../../lib/i18n";
import { LauncherOptionPicker } from "../ui/launcher-option-picker";
import { ActionButton, ConfigGate, Row, Section, Toggle } from "./controls";
import { useSettingsDraft } from "../../lib/useSettingsDraft";

/**
 * When Kiza may interrupt, through which channel, and when it must not.
 *
 * Every switch here is read by `lib/notifications.ts`, which is the only code
 * in the launcher that sends a notification. That was not true before: two of
 * these settings were written to the configuration file and consulted by
 * nothing, so turning them off changed precisely nothing. A switch that governs
 * nothing is worse than an absent one — it is a promise quietly broken.
 *
 * The list is still shorter than it could be. Each line corresponds to a notice
 * Kiza actually emits; the ones it does not emit yet are not drawn.
 */

/** Where in-app messages appear. The labels are what a reader recognises. */
const POSITION_LABELS: Record<string, string> = {
  "top-left": "Top left",
  "top-center": "Top centre",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom centre",
  "bottom-right": "Bottom right",
};

export function NotificationSettings() {
  const { t } = useI18n();
  const { draft, isLoading, error, update } = useSettingsDraft();
  const sendTest = useSendTestNotification();

  /** A switch on a row, with the label doubling as its accessible name. */
  const Switch = ({
    label,
    hint,
    field,
    disabled = false,
  }: {
    label: string;
    hint?: string;
    field: keyof AppConfig;
    disabled?: boolean;
  }) => (
    <Row label={label} hint={hint}>
      <Toggle
        label={label}
        checked={Boolean(draft?.[field])}
        disabled={disabled}
        onChange={(value) => update({ [field]: value } as Partial<AppConfig>)}
      />
    </Row>
  );

  return (
    <ConfigGate
      ready={!!draft}
      loading={isLoading}
      error={error}
      message={t("Kiza could not read its settings file.")}
    >
      {draft && (
        <div className="space-y-6">
          <Section
            icon={Bell}
            title={t("Channels")}
            hint={t("Two ways of being told, and each can be turned off on its own.")}
          >
            <Row
              label={t("Windows notifications")}
              hint={t("The tray notices that appear even when Kiza is behind another window.")}
            >
              <div className="flex items-center gap-3">
                <ActionButton
                  onClick={() =>
                    sendTest.mutate(undefined, {
                      onSuccess: () =>
                        toast.success(t("Sent. If nothing appeared, Windows is blocking them.")),
                    })
                  }
                  busy={sendTest.isPending}
                  disabled={!draft.notify_windows}
                  icon={BellRing}
                >
                  {t("Send a test")}
                </ActionButton>
                <Toggle
                  label={t("Windows notifications")}
                  checked={draft.notify_windows}
                  onChange={(value) => update({ notify_windows: value })}
                />
              </div>
            </Row>

            <Switch
              label={t("Messages inside Kiza")}
              hint={t("Shown in the corner of the launcher window. They interrupt nothing outside it.")}
              field="notify_in_app"
            />

            <Row
              label={t("Sound")}
              hint={
                draft.notify_in_app
                  ? t("A short chime with each message inside Kiza.")
                  : t("Needs messages inside Kiza, which are switched off.")
              }
            >
              <div className="flex items-center gap-3">
                <Volume2
                  className={
                    draft.notify_sound && draft.notify_in_app
                      ? "h-4 w-4 text-primary"
                      : "h-4 w-4 text-muted-foreground/50"
                  }
                />
                <Toggle
                  label={t("Sound")}
                  checked={draft.notify_sound}
                  disabled={!draft.notify_in_app}
                  onChange={(value) => update({ notify_sound: value })}
                />
              </div>
            </Row>

            <Row label={t("Where messages appear")}>
              <div className="w-56">
                <LauncherOptionPicker
                  ariaLabel={t("Where messages appear")}
                  options={TOAST_POSITIONS.map((position) => ({
                    value: position,
                    label: t(POSITION_LABELS[position]),
                  }))}
                  value={draft.notify_position}
                  onValueChange={(value) => update({ notify_position: value })}
                  placeholder={t("Bottom right")}
                  disabled={!draft.notify_in_app}
                />
              </div>
            </Row>
          </Section>

          <Section icon={Download} title={t("Downloads and updates")}>
            <Switch
              label={t("An update is ready to install")}
              hint={t("Once the download has finished. Installing stays your decision.")}
              field="notify_update_ready"
            />
            <Switch
              label={t("The download queue has emptied")}
              hint={t("Off by default: a queue of forty files would mean a notice the moment you look away.")}
              field="notify_downloads_finished"
            />
          </Section>

          <Section icon={Gamepad2} title={t("Game and instances")}>
            <Switch
              label={t("The game has started")}
              hint={t("Useful when Kiza is minimised and Minecraft takes a while to appear.")}
              field="notify_game_started"
            />
            <Switch
              label={t("A world backup has finished")}
              hint={t("Backups run on their own; this is how you know one has.")}
              field="notify_backup_done"
            />
            <Switch
              label={t("Kiza is still running in the background")}
              hint={t("Shown once, the first time closing the window hides Kiza instead of quitting it.")}
              field="notify_background"
            />
          </Section>

          <Section
            icon={Moon}
            title={t("Do not disturb")}
            hint={t("Held back, not discarded: whatever happened is still in the launcher when you come back to it.")}
          >
            <Switch
              label={t("While the game is running")}
              field="dnd_during_game"
              hint={t("Nothing interrupts a session, whatever is switched on above.")}
            />
            <Switch label={t("Between two times")} field="dnd_quiet_hours" />

            <Row
              label={t("Quiet from")}
              hint={
                draft.dnd_quiet_hours
                  ? t("An end earlier than the start runs over midnight.")
                  : undefined
              }
            >
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  aria-label={t("Quiet from")}
                  value={draft.dnd_from}
                  disabled={!draft.dnd_quiet_hours}
                  onChange={(event) => update({ dnd_from: event.target.value })}
                  className="h-9 rounded-md border border-border bg-secondary/30 px-2 text-sm disabled:opacity-50"
                />
                <span className="text-sm text-muted-foreground">{t("to")}</span>
                <input
                  type="time"
                  aria-label={t("Quiet until")}
                  value={draft.dnd_to}
                  disabled={!draft.dnd_quiet_hours}
                  onChange={(event) => update({ dnd_to: event.target.value })}
                  className="h-9 rounded-md border border-border bg-secondary/30 px-2 text-sm disabled:opacity-50"
                />
              </div>
            </Row>

            <Switch
              label={t("Always let a crash through")}
              hint={t("Being told at midnight that the game died beats finding out tomorrow.")}
              field="dnd_allow_critical"
              disabled={!draft.dnd_during_game && !draft.dnd_quiet_hours}
            />
          </Section>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/10 p-4">
            <div className="min-w-0 text-xs leading-5 text-muted-foreground">
              <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
                <RefreshCw className="h-3.5 w-3.5" />
                {t("Not covered by these switches")}
              </div>
              <p>
                {t("The badge on the Update button, and the crash report itself, are always shown — see After a crash, under General.")}
              </p>
            </div>
            <ActionButton
              onClick={() => {
                const defaults: Partial<AppConfig> = {
                  notify_windows: true,
                  notify_in_app: true,
                  notify_sound: false,
                  notify_position: "bottom-right",
                  notify_background: true,
                  notify_update_ready: true,
                  notify_downloads_finished: false,
                  notify_game_started: false,
                  notify_backup_done: true,
                  dnd_during_game: true,
                  dnd_quiet_hours: false,
                  dnd_from: "22:00",
                  dnd_to: "08:00",
                  dnd_allow_critical: true,
                };
                update(defaults);
                toast.success(t("Notification settings are back to their defaults."));
              }}
              icon={RotateCcw}
            >
              {t("Reset these")}
            </ActionButton>
          </div>
        </div>
      )}
    </ConfigGate>
  );
}
