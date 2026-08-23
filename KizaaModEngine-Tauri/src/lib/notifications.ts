import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { AppConfig } from "./queries";

/**
 * The single place a notification goes through.
 *
 * The switches on the Notifications page used to be stored and never read:
 * `notify_update_ready` and `notify_downloads_finished` were written to the
 * config file, and nothing anywhere consulted them. Turning one off changed
 * nothing at all, which is worse than not offering the switch.
 *
 * So every notice now goes through `notify`, and `notify` is the only code that
 * decides. A new notification added later gets the switches, the quiet hours
 * and the sound for free — and, more to the point, cannot accidentally skip
 * them.
 */

/** What a notification is about, and therefore which switch governs it. */
export type NotificationKind =
  | "background"
  | "update_ready"
  | "downloads_finished"
  | "game_started"
  | "backup_done"
  | "critical";

/** Which config field each kind answers to. `critical` answers to none. */
const SWITCHES: Record<Exclude<NotificationKind, "critical">, keyof AppConfig> = {
  background: "notify_background",
  update_ready: "notify_update_ready",
  downloads_finished: "notify_downloads_finished",
  game_started: "notify_game_started",
  backup_done: "notify_backup_done",
};

export type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export const TOAST_POSITIONS: ToastPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export function toastPosition(value: string | undefined): ToastPosition {
  return (TOAST_POSITIONS as string[]).includes(value ?? "")
    ? (value as ToastPosition)
    : "bottom-right";
}

/** "HH:MM" as minutes past midnight, or null if it is not a time. */
export function minutesOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Whether `now` falls inside the quiet period.
 *
 * A period whose end is earlier than its start runs over midnight, which is the
 * shape almost everyone picks: 22:00 to 08:00 is one stretch of night, not
 * fourteen hours of daytime. Treating it as a plain `start <= now < end`
 * comparison would silence exactly the wrong half of the day.
 */
export function insideQuietHours(now: Date, from: string, to: string): boolean {
  const start = minutesOfDay(from);
  const end = minutesOfDay(to);
  // An unreadable time is not a reason to go quiet: a typo in the config file
  // should not silently stop every notification.
  if (start === null || end === null) return false;
  if (start === end) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export interface QuietContext {
  now: Date;
  gameRunning: boolean;
}

/**
 * Whether a notification of this kind may interrupt right now.
 *
 * Split out from the sending so it can be tested against a fixed clock: the
 * alternative is a rule about midnight that nobody can check without staying up
 * for it.
 */
export function mayInterrupt(
  kind: NotificationKind,
  config: AppConfig,
  context: QuietContext,
): boolean {
  const critical = kind === "critical";

  if (!critical) {
    const field = SWITCHES[kind];
    if (!config[field]) return false;
  }

  const quiet =
    (config.dnd_during_game && context.gameRunning) ||
    (config.dnd_quiet_hours && insideQuietHours(context.now, config.dnd_from, config.dnd_to));

  // Critical notices — a crash, an update that failed — get through a quiet
  // period when the user has allowed it. Being told at midnight that the game
  // died beats finding out tomorrow.
  if (quiet && !(critical && config.dnd_allow_critical)) return false;

  return true;
}

/**
 * Plays the short sound that goes with an in-app message.
 *
 * Synthesised rather than shipped as a file: it is two notes, and an asset
 * would have to be bundled, cached and licence-checked to save nothing.
 */
function playChime() {
  try {
    const AudioCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.setValueAtTime(1174, context.currentTime + 0.09);

    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.26);
    oscillator.onended = () => void context.close();
  } catch {
    // A machine with no audio device is not a reason to lose the notification.
  }
}

export interface Notice {
  kind: NotificationKind;
  title: string;
  body: string;
}

/**
 * Sends one notice, through whichever channels are switched on.
 *
 * Returns what actually happened rather than nothing, so a caller — and a test
 * — can tell the difference between "sent" and "suppressed".
 */
export async function notify(
  notice: Notice,
  config: AppConfig | undefined,
  context: QuietContext = { now: new Date(), gameRunning: false },
): Promise<{ windows: boolean; inApp: boolean }> {
  const result = { windows: false, inApp: false };
  // Without a configuration there is nothing to consult, and guessing would
  // mean either notifying someone who asked not to be, or swallowing a notice
  // they wanted.
  if (!config) return result;
  if (!mayInterrupt(notice.kind, config, context)) return result;

  if (config.notify_in_app) {
    toast(notice.title, { description: notice.body });
    if (config.notify_sound) playChime();
    result.inApp = true;
  }

  if (config.notify_windows) {
    // Sent through the backend rather than a second copy of the notification
    // plugin on this side: the permission prompt, the capability entry and the
    // Windows call already live there, and two paths to the same tray would
    // drift the moment one of them gained a rule.
    try {
      await invoke("send_notification", { title: notice.title, body: notice.body });
      result.windows = true;
    } catch {
      // Windows refusing is what the Test button on the settings page exists
      // to reveal; it is not worth an error message here.
    }
  }

  return result;
}
