import { describe, expect, it } from "vitest";
import { deriveKizaEvents, parseLogLine } from "../../src/lib/gameLog";

const read = (...raw: string[]) => deriveKizaEvents(raw.map(parseLogLine));
const kinds = (...raw: string[]) => read(...raw).map((event) => event.kind);

/**
 * What the activity list is allowed to call a problem.
 *
 * The game already says how serious each line is, and Kiza was throwing that
 * away before deciding: any line containing the word "Exception" became "The
 * game reported an error", in red. Mods say that word constantly, and most of
 * the time they are saying they handled one.
 */
describe("reading a game log", () => {
  /**
   * Activity is a short list of what happened, not a feed of everything the
   * game said. A launch produces dozens of warnings, nearly all of them mods
   * talking to each other, so none of them belong here -- and above all none of
   * them is a crash. They keep their amber in the raw log, where somebody
   * looking for one will find it.
   */
  it("leaves warnings out of the activity list entirely", () => {
    // A real one, from Distant Horizons, which says this on every launch.
    expect(
      kinds(
        "[12:04:11] [main/WARN]: Distant Horizons: Explicit Garbage Collection Disabled. " +
          "This can cause out of memory crashes.",
      ),
    ).toEqual([]);

    // The shape that used to cost the most: handled, said so, still red.
    expect(
      kinds("[12:04:12] [Render thread/WARN]: Caught Exception while loading a model, skipping it"),
    ).toEqual([]);

    // Even one that says the word twice and mentions a crash.
    expect(
      kinds("[12:04:12] [main/WARN]: Exception during CrashReport preview, ignoring"),
    ).toEqual([]);
  });

  it("still calls a crash a crash", () => {
    // Names no exception at all, and is the most important line in the file.
    expect(
      kinds("[12:04:13] [Render thread/ERROR]: java.lang.OutOfMemoryError: Java heap space"),
    ).toEqual(["crash"]);
    expect(
      kinds(
        "[12:04:13] [Render thread/ERROR]: Unreported exception thrown! " +
          "java.lang.NullPointerException",
      ),
    ).toEqual(["crash"]);
  });

  /**
   * A stack trace printed straight to stderr has no level on it at all, so a
   * rule that required ERROR would miss the one line that matters most.
   */
  it("recognises a crash that arrives with no level at all", () => {
    expect(kinds('Exception in thread "main" java.lang.NoClassDefFoundError')).toEqual(["crash"]);
    expect(kinds("---- Minecraft Crash Report ----")).toEqual(["crash"]);
  });

  /** And an ordinary message mentioning the word is still an ordinary message. */
  it("is not fooled by the word on a quiet line", () => {
    expect(kinds("[12:04:10] [main/INFO]: Loaded ExceptionHandler v2.1")).toEqual([]);
    expect(kinds("[12:04:10] [main/INFO]: Registered ErrorReporter listener")).toEqual([]);
  });

  /** Repeated or not, a warning still says nothing here. */
  it("stays quiet however often a warning repeats", () => {
    const warning = "[12:04:11] [main/WARN]: Explicit Garbage Collection Disabled.";
    expect(
      kinds(warning, "[12:04:12] [main/INFO]: Loading 42 mods", warning, warning),
    ).toEqual(["mods"]);
  });

  it("keeps the level the game gave each line", () => {
    expect(parseLogLine("[12:04:11] [main/WARN]: something").level).toBe("warn");
    expect(parseLogLine("[12:04:11] [main/ERROR]: something").level).toBe("error");
    expect(parseLogLine("[12:04:11] [main/FATAL]: something").level).toBe("error");
    expect(parseLogLine("[12:04:11] [main/INFO]: something").level).toBe("info");
    // No prefix at all: not a claim of severity either way.
    expect(parseLogLine("plain output").level).toBe("info");
  });
});
