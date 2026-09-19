import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  Coffee,
  Copy,
  Cpu,
  FileText,
  FolderOpen,
  Globe,
  Loader2,
  MessageSquare,
  Minus,
  Monitor,
  Rocket,
  Search,
  Server,
  Square,
  Stethoscope,
  Terminal,
  User,
  Volume2,
} from "lucide-react";
import {
  returnToLauncher,
  useInstanceCover,
  useInstances,
  useLaunchRecord,
  useLaunchStatus,
  useLiveInstanceLog,
  useOpenInstanceFolder,
  useOpenInstanceLog,
  useStopInstance,
} from "../../lib/queries";
import {
  deriveKizaEvents,
  parseLogLine,
  summariseLog,
  type KizaEventKind,
  type LogLevel,
  type LogLine,
  type LogSource,
} from "../../lib/gameLog";
import { formatMinecraftLoader } from "../../lib/minecraftLoaders";
import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";
import { CrashDoctorPanel } from "../instance/CrashDoctorPanel";

const EVENT_ICON: Record<KizaEventKind, typeof Rocket> = {
  launch: Rocket,
  mods: Boxes,
  graphics: Monitor,
  audio: Volume2,
  world: Globe,
  server: Server,
  crash: AlertTriangle,
  info: MessageSquare,
};

const EVENT_TONE: Record<KizaEventKind, string> = {
  launch: "text-primary",
  mods: "text-primary",
  graphics: "text-sky-300",
  audio: "text-sky-300",
  world: "text-emerald-300",
  server: "text-emerald-300",
  crash: "text-red-300",
  info: "text-muted-foreground",
};

const LEVEL_TONE: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-300",
  error: "text-red-300",
  debug: "text-muted-foreground/60",
};

const SOURCE_TONE: Record<LogSource, string> = {
  launcher: "border-primary/40 bg-primary/15 text-primary",
  client: "border-violet-400/40 bg-violet-400/15 text-violet-200",
  game: "border-border/60 bg-secondary/40 text-muted-foreground",
};

type View = "activity" | "problem" | "log";
type LogFilter = "all" | "warn" | "error" | LogSource;

/**
 * The Kiza Manager: one window that follows a game from launch to exit.
 *
 * <p>Three voices share the log -- the launcher, the Kiza client inside the
 * game, and the game itself -- and the window says which is which. Above
 * the log, one line moves: what the game is doing this second, with the
 * warnings counted beside it rather than listed. An error, here, means the
 * game could not start or died; a mod logging at ERROR and carrying on is
 * counted, not shouted. When the game does die, the Problem tab says which
 * line it turned on and what the doctor makes of it.
 */
export function ConsoleWindow({ instanceId }: { instanceId: string }) {
  const appWindow = getCurrentWindow();
  const { t } = useI18n();
  const { data: instances } = useInstances();
  const instance = instances?.find((i) => i.id === instanceId);
  const { data: launchStatus } = useLaunchStatus(instanceId);
  const { data: record } = useLaunchRecord(instanceId);
  const { data: rawLog } = useLiveInstanceLog(instanceId, true);
  const { data: cover } = useInstanceCover(instanceId);
  const stopInstance = useStopInstance();
  const openFolder = useOpenInstanceFolder();
  const openLog = useOpenInstanceLog();
  const [view, setView] = useState<View>("activity");
  const [filter, setFilter] = useState<LogFilter>("all");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  const phase = launchStatus?.phase ?? "idle";
  const isRunning = phase === "running";
  const isCrashed = phase === "crashed";
  const isBusy = ["preparing", "downloading_java", "downloading_game", "repairing_mods", "starting"].includes(phase);

  const lines = useMemo(() => {
    if (!rawLog) return [];
    return rawLog.split("\n").filter(Boolean).map(parseLogLine);
  }, [rawLog]);
  const events = useMemo(
    () => deriveKizaEvents(lines, { libraryModCount: instance?.mod_count }),
    [lines, instance?.mod_count],
  );
  const summary = useMemo(() => summariseLog(lines), [lines]);

  // The game went down when the launcher says so; the log only says where.
  const failed = isCrashed;
  const hasProblem = failed || (!isRunning && !isBusy && summary.fatal !== null);

  useEffect(() => {
    if (failed) setView("problem");
  }, [failed]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return lines.filter((line) => {
      if (filter === "warn" && line.level !== "warn") return false;
      if (filter === "error" && line.level !== "error") return false;
      if ((filter === "launcher" || filter === "client" || filter === "game") && line.source !== filter) return false;
      if (needle && !line.raw.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [lines, filter, search]);

  // Follow the tail unless the reader scrolled up to look at something.
  useEffect(() => {
    const node = scrollRef.current;
    if (node && followRef.current) node.scrollTop = node.scrollHeight;
  }, [events.length, filtered.length, view]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
  };

  // Each new activity event slides into the feed.
  useGSAP(() => {
    if (view !== "activity" || events.length === 0 || prefersReducedMotion()) return;
    gsap.from("ol > li:last-child", {
      x: -14,
      opacity: 0,
      duration: 0.35,
      ease: "power2.out",
      clearProps: "transform,opacity",
    });
  }, { dependencies: [events.length, view], scope: scrollRef });

  // The moving line crossfades rather than jumping.
  const currentText = summary.current?.message ?? "";
  useGSAP(() => {
    if (prefersReducedMotion()) return;
    gsap.fromTo(
      "[data-current-line]",
      { opacity: 0.35, y: 3 },
      { opacity: 1, y: 0, duration: 0.25, ease: "power2.out", clearProps: "transform" },
    );
  }, { dependencies: [currentText], scope: statusRef });

  // A counter that grew gets a nudge.
  useGSAP(() => {
    if (prefersReducedMotion() || summary.warnings === 0) return;
    gsap.fromTo("[data-warn-count]", { scale: 1.25 }, { scale: 1, duration: 0.3, ease: "back.out(2)", clearProps: "transform" });
  }, { dependencies: [summary.warnings], scope: statusRef });

  const phaseLabel = (() => {
    switch (phase) {
      case "preparing": return t("Preparing");
      case "downloading_java": return t("Downloading Java");
      case "downloading_game": return t("Verifying files");
      case "repairing_mods": return t("Repairing mods");
      case "starting": return t("Starting");
      case "running": return t("In game");
      case "crashed": return t("Crashed");
      case "exited": return launchStatus?.message?.startsWith("Stopped") ? t("Stopped") : t("Exited");
      default: return t("Idle");
    }
  })();

  const versionLabel = instance?.minecraft
    ? `Minecraft ${instance.minecraft.mc_version} · ${formatMinecraftLoader(instance.minecraft)}`
    : record
      ? `Minecraft ${record.minecraft_version} · ${record.loader}${record.loader_version ? ` ${record.loader_version}` : ""}`
      : "Minecraft";

  const accountLabel = record
    ? `${record.username} · ${record.account_mode === "microsoft" ? t("Microsoft account") : t("Offline")}`
    : null;

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(rawLog ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard is not always there; the button simply does nothing.
    }
  };

  const statusIcon = isCrashed ? (
    <AlertOctagon className="h-4 w-4 shrink-0 text-red-300" />
  ) : isRunning ? (
    <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
      <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400/50" />
      <span className="h-2 w-2 rounded-full bg-emerald-400" />
    </span>
  ) : isBusy ? (
    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
  ) : (
    <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Title bar */}
      <div
        className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 bg-card/60 pl-4 pr-2 backdrop-blur-sm"
        onMouseDown={() => appWindow.startDragging()}
      >
        <div className="pointer-events-none flex items-center gap-2.5">
          <Terminal className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold tracking-wide text-primary">Kiza Manager</span>
          <span className="text-xs text-muted-foreground">/ {instance?.display_name ?? record?.instance_name ?? "Instance"}</span>
        </div>
        <div className="flex items-center" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => appWindow.minimize()}
            className="flex h-8 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={() => returnToLauncher()}
            className="flex h-8 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title={t("Back to launcher")}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Header: what is running, as what, for whom */}
      <div className="shrink-0 border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-3.5">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-primary/30 to-primary/5">
            {cover && <img src={cover.uri} alt="" aria-hidden className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-semibold">{instance?.display_name ?? record?.instance_name ?? "Instance"}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  isRunning
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : isCrashed
                      ? "border-red-500/30 bg-red-500/10 text-red-300"
                      : isBusy
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border/70 bg-secondary/30 text-muted-foreground",
                )}
              >
                {isRunning && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                {phaseLabel}
                {isRunning && record && <Uptime since={record.started_at} />}
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{versionLabel}</div>
            {record && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Cpu className="h-3 w-3" />{t("Profile")} {record.profile_label}</span>
                {accountLabel && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{accountLabel}</span>}
                <span className="inline-flex items-center gap-1"><Coffee className="h-3 w-3" />Java {record.java_major} · {record.memory_mb[0]}–{record.memory_mb[1]} MB</span>
                {record.courtesies.length > 0 && (
                  <span className="inline-flex items-center gap-1" title={record.courtesies.map((c) => `${c.area}: ${c.mod_name}`).join("\n")}>
                    <Boxes className="h-3 w-3" />
                    {t("{count} left to your mods").replace("{count}", String(record.courtesies.length))}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status strip: one line that moves, and the counts beside it */}
      <div ref={statusRef} className="flex shrink-0 items-center gap-3 border-b border-border/50 bg-background/60 px-4 py-2">
        {statusIcon}
        <div className="min-w-0 flex-1">
          <div
            data-current-line
            className={cn("truncate font-mono text-[11px]", summary.current ? LEVEL_TONE[summary.current.level] : "text-muted-foreground")}
            title={summary.current?.raw}
          >
            {isCrashed
              ? t("Minecraft did not survive this launch.")
              : summary.current
                ? summary.current.message
                : t("Waiting for the game to say something…")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {summary.warnings > 0 && (
            <button
              data-warn-count
              onClick={() => { setView("log"); setFilter("warn"); }}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200 transition hover:bg-amber-500/20"
              title={t("Show the warnings")}
            >
              <AlertTriangle className="h-3 w-3" />
              {summary.warnings === 1 ? t("1 warning") : t("{count} warnings").replace("{count}", String(summary.warnings))}
            </button>
          )}
          {summary.errors > 0 && !isCrashed && (
            <button
              onClick={() => { setView("log"); setFilter("error"); }}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:bg-secondary/70"
              title={t("Lines the game marked ERROR; it kept going")}
            >
              {summary.errors === 1 ? t("1 error reported") : t("{count} errors reported").replace("{count}", String(summary.errors))}
            </button>
          )}
          {isCrashed && (
            <button
              onClick={() => setView("problem")}
              className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-200 transition hover:bg-red-500/20"
            >
              <AlertOctagon className="h-3 w-3" />
              {t("Did not start")}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-card/20 px-4 py-2">
        <div className="flex rounded-lg border border-border/70 bg-secondary/20 p-0.5">
          <TabButton active={view === "activity"} onClick={() => setView("activity")}>{t("Activity")}</TabButton>
          {hasProblem && (
            <TabButton active={view === "problem"} onClick={() => setView("problem")} tone="danger">
              <Stethoscope className="h-3 w-3" />
              {t("Problem")}
            </TabButton>
          )}
          <TabButton active={view === "log"} onClick={() => setView("log")}>{t("Log")}</TabButton>
        </div>
        {view === "log" && (
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="flex rounded-md border border-border/60 bg-secondary/20 p-0.5">
              {(["all", "warn", "error", "launcher", "client", "game"] as LogFilter[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                    filter === key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {key === "all" ? t("All") : key === "warn" ? t("Warnings") : key === "error" ? t("Errors") : key === "launcher" ? "Kiza Launcher" : key === "client" ? "Kiza Client" : t("Game")}
                </button>
              ))}
            </div>
            <label className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("Search the log")}
                className="h-7 w-40 rounded-md border border-border/60 bg-background/60 pl-7 pr-2 text-[11px] outline-none focus:border-primary/50"
              />
            </label>
          </div>
        )}
      </div>

      {/* Body */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto bg-background/40 px-4 py-3.5">
        {view === "activity" && (
          events.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Boxes className="mb-3 h-8 w-8 opacity-40" />
              {t("Waiting for the game to report activity…")}
            </div>
          ) : (
            <ol className="space-y-1.5">
              {events.map((event, index) => {
                const Icon = EVENT_ICON[event.kind];
                return (
                  <li key={index} className="flex items-start gap-3 rounded-lg border border-border/50 bg-card/50 px-3 py-2.5">
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", EVENT_TONE[event.kind])} />
                    <span className="text-sm leading-5">{event.text}</span>
                  </li>
                );
              })}
            </ol>
          )
        )}

        {view === "problem" && (
          <div className="space-y-3">
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3">
              <div className="flex items-start gap-3">
                <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{t("Minecraft could not start")}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {launchStatus?.message ?? t("The game stopped unexpectedly.")}
                  </p>
                  {summary.fatal && (
                    <div className="mt-2">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("The line it turned on")}</div>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded border border-border/50 bg-background/80 p-2 font-mono text-[10px] leading-relaxed text-red-200">
                        {summary.fatal.raw}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
              <CrashDoctorPanel instanceId={instanceId} />
            </div>
          </div>
        )}

        {view === "log" && (
          filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {lines.length === 0 ? t("No log output yet.") : t("Nothing matches.")}
            </div>
          ) : (
            <div className="font-mono text-[11px] leading-5">
              {filtered.map((line, index) => (
                <LogRow key={index} line={line} />
              ))}
            </div>
          )
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/40 px-4 py-3">
        <span className="text-xs tabular-nums text-muted-foreground">
          {view === "activity"
            ? `${events.length} ${t("events")}`
            : view === "log"
              ? `${filtered.length} / ${lines.length} ${t("lines")}`
              : t("Kiza Launcher {version}").replace("{version}", record?.launcher_version ?? "")}
        </span>
        <div className="flex items-center gap-2">
          <FooterButton onClick={() => openFolder.mutate(instanceId)} icon={FolderOpen}>{t("Open folder")}</FooterButton>
          <FooterButton onClick={() => openLog.mutate({ instanceId, which: "latest" })} icon={FileText}>latest.log</FooterButton>
          <FooterButton onClick={() => void copyLog()} icon={copied ? Check : Copy}>{copied ? t("Copied") : t("Copy")}</FooterButton>
          <FooterButton onClick={() => returnToLauncher()} icon={ArrowLeft}>{t("Back to launcher")}</FooterButton>
          <button
            onClick={() => stopInstance.mutate(instanceId)}
            disabled={!isRunning || stopInstance.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3.5 text-sm font-semibold text-red-200 transition-[background-color,transform] duration-150 hover:bg-red-500/20 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Square className="h-3.5 w-3.5" />
            {t("Stop game")}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? tone === "danger"
            ? "bg-red-500/15 text-red-200"
            : "bg-primary/15 text-primary"
          : tone === "danger"
            ? "text-red-300/80 hover:text-red-200"
            : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FooterButton({
  onClick,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  icon: typeof FolderOpen;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/40 px-3.5 text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-secondary/70 active:scale-[0.96]"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

/** One log line, with who said it when it was not the game. */
function LogRow({ line }: { line: LogLine }) {
  return (
    <div className={cn("flex gap-2", LEVEL_TONE[line.level])}>
      {line.source !== "game" && (
        <span
          className={cn(
            "mt-0.5 inline-flex h-4 shrink-0 items-center rounded border px-1 text-[9px] font-semibold uppercase tracking-wide",
            SOURCE_TONE[line.source],
          )}
        >
          {line.source === "launcher" ? "Launcher" : "Client"}
        </span>
      )}
      <span className="min-w-0 whitespace-pre-wrap break-words">{line.raw}</span>
    </div>
  );
}

/** Minutes and seconds since the launch, ticking. */
function Uptime({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const started = new Date(since).getTime();
  if (Number.isNaN(started)) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const text = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return <span className="tabular-nums opacity-80">{text}</span>;
}
