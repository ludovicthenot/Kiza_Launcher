// Parses raw Minecraft log lines and derives friendly "Kiza Manager" events,
// in the spirit of Lunar Client's in-game status feed.

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogLine {
  raw: string;
  level: LogLevel;
  thread: string | null;
  message: string;
}

export type KizaEventKind = "launch" | "mods" | "graphics" | "audio" | "world" | "server" | "warn" | "crash" | "info";

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
    return { raw, level: "info", thread: null, message: raw };
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
  return {
    raw,
    level,
    thread: match.groups.thread ?? null,
    message: match.groups.msg ?? raw,
  };
}

// Ordered, first-match rules. Each yields one Kiza Manager event or null.
const RULES: { test: RegExp; build: (m: RegExpExecArray, context: KizaEventContext) => KizaEvent }[] = [
  {
    test: /Loading Minecraft (\S+) with Fabric Loader (\S+)/,
    build: (m) => ({ kind: "launch", text: `Starting Minecraft ${m[1]} with Fabric ${m[2]}` }),
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
    test: /Exception|CrashReport|has crashed|A fatal error/,
    build: () => ({ kind: "crash", text: "The game reported an error" }),
  },
];

// De-duplicates repeated events (e.g. many resource reloads).
export function deriveKizaEvents(lines: LogLine[], context: KizaEventContext = {}): KizaEvent[] {
  const events: KizaEvent[] = [];
  let lastKey = "";
  for (const line of lines) {
    for (const rule of RULES) {
      const m = rule.test.exec(line.message) ?? rule.test.exec(line.raw);
      if (m) {
        const event = rule.build(m, context);
        const key = `${event.kind}:${event.text}`;
        if (key !== lastKey) {
          events.push(event);
          lastKey = key;
        }
        break;
      }
    }
  }
  return events;
}
