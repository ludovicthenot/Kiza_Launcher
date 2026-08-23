import { describe, expect, it } from "vitest";
import {
  insideQuietHours,
  mayInterrupt,
  minutesOfDay,
  toastPosition,
  type NotificationKind,
} from "../../src/lib/notifications";
import type { AppConfig } from "../../src/lib/queries";

/**
 * A configuration with every switch on and no quiet period, so each test can
 * turn off exactly the one thing it is about.
 */
function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    notify_background: true,
    notify_update_ready: true,
    notify_downloads_finished: true,
    notify_game_started: true,
    notify_backup_done: true,
    notify_windows: true,
    notify_in_app: true,
    notify_sound: false,
    notify_position: "bottom-right",
    dnd_during_game: false,
    dnd_quiet_hours: false,
    dnd_from: "22:00",
    dnd_to: "08:00",
    dnd_allow_critical: true,
    log_retention_days: 14,
    ...overrides,
  } as AppConfig;
}

const at = (hours: number, minutes = 0) => new Date(2026, 7, 23, hours, minutes);
const quiet = { now: at(12), gameRunning: false };

describe("reading a time", () => {
  it("accepts the shapes a picker produces", () => {
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("22:30")).toBe(1350);
    expect(minutesOfDay("9:05")).toBe(545);
    expect(minutesOfDay(" 08:00 ")).toBe(480);
  });

  it("refuses what is not a time", () => {
    expect(minutesOfDay("")).toBeNull();
    expect(minutesOfDay("24:00")).toBeNull();
    expect(minutesOfDay("12:60")).toBeNull();
    expect(minutesOfDay("noon")).toBeNull();
  });
});

describe("a quiet period that runs over midnight", () => {
  // 22:00 to 08:00 is the shape almost everyone picks, and the one a plain
  // start <= now < end comparison silences backwards.
  const from = "22:00";
  const to = "08:00";

  it("is quiet late at night", () => {
    expect(insideQuietHours(at(23), from, to)).toBe(true);
  });

  it("is quiet after midnight", () => {
    expect(insideQuietHours(at(2), from, to)).toBe(true);
  });

  it("is quiet at the moment it starts", () => {
    expect(insideQuietHours(at(22), from, to)).toBe(true);
  });

  it("is awake again at the moment it ends", () => {
    expect(insideQuietHours(at(8), from, to)).toBe(false);
  });

  it("is awake in the middle of the day", () => {
    expect(insideQuietHours(at(12), from, to)).toBe(false);
  });
});

describe("a quiet period inside one day", () => {
  it("covers only its own hours", () => {
    expect(insideQuietHours(at(14), "13:00", "17:00")).toBe(true);
    expect(insideQuietHours(at(19), "13:00", "17:00")).toBe(false);
    expect(insideQuietHours(at(3), "13:00", "17:00")).toBe(false);
  });
});

describe("a quiet period that is not one", () => {
  it("treats an unreadable time as no quiet period at all", () => {
    // A typo in the config file silencing every notification for ever would be
    // impossible to diagnose from the settings page, where it would still read
    // as switched off.
    expect(insideQuietHours(at(3), "oops", "08:00")).toBe(false);
  });

  it("treats a zero-length period as no quiet period", () => {
    expect(insideQuietHours(at(9), "09:00", "09:00")).toBe(false);
  });
});

describe("the per-event switches", () => {
  const kinds: Exclude<NotificationKind, "critical">[] = [
    "background",
    "update_ready",
    "downloads_finished",
    "game_started",
    "backup_done",
  ];

  it.each(kinds)("lets %s through when its switch is on", (kind) => {
    expect(mayInterrupt(kind, config(), quiet)).toBe(true);
  });

  it("stops an update notice when that switch is off", () => {
    // The bug this whole service exists to fix: the setting was stored and
    // never read, so turning it off changed nothing.
    expect(mayInterrupt("update_ready", config({ notify_update_ready: false }), quiet)).toBe(false);
  });

  it("stops a finished-queue notice when that switch is off", () => {
    expect(
      mayInterrupt("downloads_finished", config({ notify_downloads_finished: false }), quiet),
    ).toBe(false);
  });

  it("does not let one switch govern another", () => {
    const only = config({ notify_update_ready: false });
    expect(mayInterrupt("downloads_finished", only, quiet)).toBe(true);
  });
});

describe("while the game is running", () => {
  const playing = { now: at(12), gameRunning: true };

  it("holds notifications back", () => {
    expect(mayInterrupt("update_ready", config({ dnd_during_game: true }), playing)).toBe(false);
  });

  it("lets them through when that is switched off", () => {
    expect(mayInterrupt("update_ready", config({ dnd_during_game: false }), playing)).toBe(true);
  });

  it("still lets a crash through", () => {
    // Being told the game died is the one notice worth having while the game
    // is supposedly running.
    expect(mayInterrupt("critical", config({ dnd_during_game: true }), playing)).toBe(true);
  });

  it("silences even a crash when critical notices are not allowed", () => {
    expect(
      mayInterrupt(
        "critical",
        config({ dnd_during_game: true, dnd_allow_critical: false }),
        playing,
      ),
    ).toBe(false);
  });
});

describe("during quiet hours", () => {
  const night = { now: at(23, 30), gameRunning: false };
  const quietConfig = config({ dnd_quiet_hours: true });

  it("holds an ordinary notice back", () => {
    expect(mayInterrupt("backup_done", quietConfig, night)).toBe(false);
  });

  it("lets a critical one through", () => {
    expect(mayInterrupt("critical", quietConfig, night)).toBe(true);
  });

  it("changes nothing outside the period", () => {
    expect(mayInterrupt("backup_done", quietConfig, { now: at(15), gameRunning: false })).toBe(true);
  });

  it("does nothing at all while the quiet-hours switch is off", () => {
    expect(mayInterrupt("backup_done", config({ dnd_quiet_hours: false }), night)).toBe(true);
  });
});

describe("a critical notice", () => {
  it("needs no per-event switch", () => {
    // There is deliberately no "tell me about crashes" setting to turn off.
    expect(mayInterrupt("critical", config({ notify_background: false }), quiet)).toBe(true);
  });
});

describe("where in-app messages appear", () => {
  it("keeps a position the toaster understands", () => {
    expect(toastPosition("top-left")).toBe("top-left");
    expect(toastPosition("bottom-center")).toBe("bottom-center");
  });

  it("falls back rather than passing something through", () => {
    // A stored value from an older build, or a hand-edited config, would
    // otherwise reach the toaster and put the message nowhere.
    expect(toastPosition("middle-of-the-screen")).toBe("bottom-right");
    expect(toastPosition(undefined)).toBe("bottom-right");
    expect(toastPosition("")).toBe("bottom-right");
  });
});
