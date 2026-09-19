// Parses raw Minecraft log lines and derives friendly "Kiza Manager" events,
// in the spirit of Lunar Client's in-game status feed.

export type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Who wrote the line. Three voices share one log: the launcher writes the
 * header and the odd note, the Kiza client inside the game announces
 * itself as `[Kiza Client]`, and everything else is the game and its mods.
 */
export type LogSource = "launcher" | "client" | "game";

export interface LogLine {
  raw: string;
  level: LogLevel;
  thread: string | null;
  message: string;
  source: LogSource;
}

const LAUNCHER_TAG = "[Kiza Launcher";
const CLIENT_TAG = "[Kiza Client";

export function sourceOf(raw: string, message: string): LogSource {
  if (raw.startsWith(LAUNCHER_TAG)) return "launcher";
  // The client prints to stdout, which Minecraft's logger wraps as
  // `[STDOUT]: [Kiza Client] ...`; the tag is somewhere in the message.
  if (raw.startsWith(CLIENT_TAG) || message.includes(CLIENT_TAG)) return "client";
  return "game";
}

/**
 * Activity is a short list of things that happened, not a feed of everything
 * the game said. There is deliberately no "warning" kind: a launch produces
 * dozens, almost all of them mods talking to each other, and a list that
 * reports them is a list nobody reads twice. Warnings keep their colour in the
 * raw log, where somebody looking for one will find it.
 */
export type KizaEventKind = "launch" | "mods" | "graphics" | "audio" | "world" | "server" | "crash" | "info";

export interface KizaEvent {
  kind: KizaEventKind;
  text: string;
}

export interface KizaEventContext {
  /** Number of mods the player manages in the launcher library for this instance. */
  libraryModCount?: number;
}

const LINE_RE = /^\[(?<time>[^\]]+)\]\s+\[(?<thread>[^/\]]+)\/(?<level>[A-Z]+)\]:?\s?(?<msg>.*)$/;

export function parseLogLine(raw: string): LogLine {
  const match = LINE_RE.exec(raw);
  if (!match?.groups) {
    // The launcher's own header and the client's bare prints carry no
    // Minecraft-style level; a launcher line saying WARN or ERROR does.
    const source = sourceOf(raw, raw);
    const tagged = /\[Kiza (?:Launcher|Client)\/(WARN|ERROR)\]/.exec(raw);
    const level: LogLevel = tagged ? (tagged[1] === "ERROR" ? "error" : "warn") : "info";
    return { raw, level, thread: null, message: raw, source };
  }
  const levelRaw = match.groups.level.toUpperCase();
  const level: LogLevel =
    levelRaw === "ERROR" || levelRaw === "FATAL"
      ? "error"
      : levelRaw === "WARN"
        ? "warn"
        : levelRaw === "DEBUG" || levelRaw === "TRACE"
          ? "debug"
          : "info";
  const message = match.groups.msg ?? raw;
  return {
    raw,
    level,
    thread: match.groups.thread ?? null,
    message,
    source: sourceOf(raw, message),
  };
}

/** What the Manager's status strip counts and says. */
export interface LogSummary {
  warnings: number;
  /** Lines the game marked ERROR. Not crashes: a mod logging at ERROR and carrying on is one of these. */
  errors: number;
  /** The last line worth showing as "what is happening now". */
  current: LogLine | null;
  /** The first line that says the game itself is going down, if any. */
  fatal: LogLine | null;
}

const FATAL_RE =
  /---- Minecraft Crash Report ----|Exception in thread "main"|A fatal error has been detected|java\.lang\.OutOfMemoryError|Could not create the Java Virtual Machine|Error: Could not find or load main class|no lwjgl(64)? in java\.library\.path/;

/**
 * Counts what the log says and picks the line that describes the moment.
 *
 * An ERROR is counted, not shouted: mods log at ERROR and keep going, and a
 * pack that starts with three of them is a pack that starts. What the
 * Manager calls an error is the game failing to start, and that comes from
 * the launch status and the crash report, not from a level. The counts say
 * how noisy the run was; `fatal` is the one line the whole log turns on.
 */
export function summariseLog(lines: LogLine[]): LogSummary {
  let warnings = 0;
  let errors = 0;
  let current: LogLine | null = null;
  let fatal: LogLine | null = null;
  for (const line of lines) {
    if (line.level === "warn") warnings += 1;
    if (line.level === "error") errors += 1;
    if (!fatal && FATAL_RE.test(line.raw)) fatal = line;
    // Stack frames and blank continuation lines are not a status.
    const trimmed = line.raw.trim();
    if (trimmed && !trimmed.startsWith("at ") && !trimmed.startsWith("...") && !trimmed.startsWith("Caused by:")) {
      current = line;
    }
  }
  return { warnings, errors, current, fatal };
}

/**
 * Ordered, first-match rules. Each yields one Kiza Manager event.
 *
 * `needs` is the levels a line must be at for the rule to apply. Without it a
 * rule matched on words alone, which is how a warning became a crash: a mod
 * logging "caught Exception, continuing" at WARN was reported as "The game
 * reported an error", in red, next to a real one. The game says how serious a
 * line is and Kiza was throwing that away before deciding.
 */
const RULES: {
  test: RegExp;
  needs?: LogLevel[];
  build: (m: RegExpExecArray, context: KizaEventContext) => KizaEvent;
}[] = [
  // The launcher's own header, which opens every captured log.
  {
    test: /^\[Kiza Launcher\] Launching "(.+?)" -- Minecraft (\S+) with (.+)$/,
    build: (m) => ({ kind: "launch", text: `Launching ${m[1]} — Minecraft ${m[2]} with ${m[3]}` }),
  },
  {
    test: /^\[Kiza Launcher\] Profile (.+?) \(\S+\) -- (\d+) to (\d+) MB -- Java (\d+)/,
    build: (m) => ({ kind: "info", text: `Profile ${m[1]}, ${m[2]}–${m[3]} MB, Java ${m[4]}` }),
  },
  {
    test: /^\[Kiza Launcher\] (menu|window|presence) left to (.+?) \(/,
    build: (m) => ({
      kind: "info",
      text: `${m[1] === "menu" ? "Menu" : m[1] === "window" ? "Window" : "Discord presence"} left to ${m[2]}`,
    }),
  },
  {
    test: /\[Kiza Client\] Client runtime (ready|degraded|failed) with (\d+) capabilit/,
    build: (m) => ({
      kind: m[1] === "failed" ? "crash" : "info",
      text: m[1] === "ready" ? `Kiza Client ready (${m[2]} capabilities)` : `Kiza Client ${m[1]} (${m[2]} capabilities)`,
    }),
  },
  {
    test: /Loading Minecraft (\S+) with Fabric Loader (\S+)/,
    build: (m) => ({ kind: "launch", text: `Starting Minecraft ${m[1]} with Fabric ${m[2]}` }),
  },
  {
    test: /Forge Mod Loader version (\S+) for Minecraft (\S+) loading/,
    build: (m) => ({ kind: "launch", text: `Starting Minecraft ${m[2]} with Forge ${m[1]}` }),
  },
  {
    test: /Forge Mod Loader has successfully loaded (\d+) mods/,
    build: (m) => ({ kind: "mods", text: `${m[1]} mods loaded` }),
  },
  {
    test: /Max texture size: (\d+)/,
    build: (m) => ({ kind: "graphics", text: `Textures up to ${m[1]} px` }),
  },
  {
    test: /\[jei\]: Building ingredient filter/,
    build: () => ({ kind: "info", text: "Indexing recipes (JEI)" }),
  },
  {
    // Fabric's count includes the game, Java, the loader, libraries and the
    // Kiza optimizations - not just the player's mods, so never echo it as
    // "N mods". Prefer the launcher's own library count when available.
    test: /Loading (\d+) mods/,
    build: (m, context) => ({
      kind: "mods",
      text:
        context.libraryModCount != null
          ? `Loading your ${context.libraryModCount} mod${context.libraryModCount === 1 ? "" : "s"} + Kiza optimizations (${m[1]} components with libraries)`
          : `Loading ${m[1]} components (mods, libraries and Fabric modules)`,
    }),
  },
  {
    test: /\[Sodium\].*(Loaded|initialized)/i,
    build: () => ({ kind: "graphics", text: "Sodium renderer active" }),
  },
  {
    test: /Backend library: LWJGL/,
    build: (m) => ({ kind: "graphics", text: m[0] }),
  },
  {
    test: /OpenAL initialized|Sound engine started/,
    build: () => ({ kind: "audio", text: "Audio engine ready" }),
  },
  {
    test: /Reloading ResourceManager/,
    build: () => ({ kind: "graphics", text: "Loading resource packs" }),
  },
  {
    test: /Setting user: (\S+)/,
    build: (m) => ({ kind: "info", text: `Signed in as ${m[1]}` }),
  },
  {
    test: /Connecting to ([^,]+), (\d+)/,
    build: (m) => ({ kind: "server", text: `Joining server ${m[1]}:${m[2]}` }),
  },
  {
    test: /Started serverThread|Preparing (start|spawn) region/,
    build: () => ({ kind: "world", text: "Loading world" }),
  },
  {
    test: /Loaded \d+% of the world|Time elapsed: \d+ ms/,
    build: () => ({ kind: "world", text: "World ready" }),
  },
  {
    test: /Stopping!|Stopping server/,
    build: () => ({ kind: "info", text: "Leaving the game" }),
  },
  {
    test: /Incompatible mods found|Mod resolution failed/,
    build: () => ({ kind: "crash", text: "Incompatible mods detected" }),
  },
  {
    // A crash whatever the line says it is. These phrases are not written by a
    // mod being chatty: a crash report header or a thread dying is the game
    // ending, and a stack trace printed straight to stderr carries no level at
    // all, so requiring one here would miss the real thing.
    test:
      /---- Minecraft Crash Report ----|Exception in thread|A fatal error has been detected|has crashed/,
    build: () => ({ kind: "crash", text: "The game reported an error" }),
  },
  {
    // And the loose version, which needs the game to agree it is serious.
    // "Exception" appears in mod names, in messages about exceptions that were
    // handled, and in warnings about what would happen if one were not. At
    // ERROR the game is not being chatty, so the net is wider here: a bare
    // OutOfMemoryError names no exception and is the most important line in
    // the file.
    test: /Exception|CrashReport|[A-Za-z]Error\b/,
    needs: ["error"],
    build: () => ({ kind: "crash", text: "The game reported an error" }),
  },
];

// De-duplicates repeated events (e.g. many resource reloads).
export function deriveKizaEvents(lines: LogLine[], context: KizaEventContext = {}): KizaEvent[] {
  const events: KizaEvent[] = [];
  let lastKey = "";

  for (const line of lines) {
    for (const rule of RULES) {
      if (rule.needs && !rule.needs.includes(line.level)) continue;

      const m = rule.test.exec(line.message) ?? rule.test.exec(line.raw);
      if (!m) continue;

      const event = rule.build(m, context);
      const key = `${event.kind}:${event.text}`;
      if (key !== lastKey) {
        events.push(event);
        lastKey = key;
      }
      break;
    }
  }
  return events;
}
