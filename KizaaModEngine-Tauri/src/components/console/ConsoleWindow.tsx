import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  Copy,
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

const LEVEL_TONE: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-300",
  error: "text-red-300",
  debug: "text-muted-foreground/60",
};

const SOURCE_TONE: Record<LogSource, string> = {
  launcher: "bg-primary/20 text-primary",
  client: "bg-violet-400/20 text-violet-200",
  game: "bg-secondary/60 text-muted-foreground",
};

/** Each kind of event on its own tinted tile, like a settings icon. */
const EVENT_TILE: Record<KizaEventKind, string> = {
  launch: "bg-primary/20 text-primary",
  mods: "bg-primary/20 text-primary",
  graphics: "bg-sky-500/20 text-sky-300",
  audio: "bg-sky-500/20 text-sky-300",
  world: "bg-emerald-500/20 text-emerald-300",
  server: "bg-emerald-500/20 text-emerald-300",
  crash: "bg-red-500/20 text-red-300",
  info: "bg-secondary/80 text-muted-foreground",
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

  const name = instance?.display_name ?? record?.instance_name ?? "Instance";

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* The instance's own picture, blurred, tints the top of the window. */}
      {cover && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden [mask-image:linear-gradient(to_bottom,black,transparent)]"
        >
          <img src={cover.uri} alt="" className="h-full w-full scale-150 object-cover opacity-25 blur-3xl saturate-150" />
        </div>
      )}

      {/* Title bar: no line, the window's name small and quiet. */}
      <div
        className="relative flex h-11 shrink-0 items-center justify-between pl-4 pr-2"
        onMouseDown={() => appWindow.startDragging()}
      >
        <div className="pointer-events-none flex items-center gap-2 text-[12.5px]">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span className="font-semibold text-foreground/85">Kiza Manager</span>
        </div>
        <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
          <WindowButton onClick={() => appWindow.minimize()} title={t("Minimise")}>
            <Minus className="h-3.5 w-3.5" />
          </WindowButton>
          <WindowButton onClick={() => returnToLauncher()} title={t("Back to launcher")}>
            <ArrowLeft className="h-3.5 w-3.5" />
          </WindowButton>
        </div>
      </div>

      {/* Header: what is running, as what, for whom */}
      <div className="relative shrink-0 px-5 pb-4 pt-1">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[16px] bg-gradient-to-br from-primary/30 to-primary/5 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.1),0_10px_28px_-10px_hsl(0_0%_0%/0.7)]">
            {cover && <img src={cover.uri} alt="" aria-hidden className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-semibold tracking-tight">{name}</div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 font-medium",
                  isRunning ? "text-emerald-300" : isCrashed ? "text-red-300" : isBusy ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {phaseLabel}
                {isRunning && record && <Uptime since={record.started_at} />}
              </span>
              <span aria-hidden>·</span>
              <span className="truncate">{versionLabel}</span>
            </div>
            {record && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground/90">
                <span>{t("Profile")} {t(record.profile_label)}</span>
                <span aria-hidden>·</span>
                <span>Java {record.java_major} · {formatMemoryRange(record.memory_mb[0], record.memory_mb[1])}</span>
                {accountLabel && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{accountLabel}</span>
                  </>
                )}
                {record.courtesies.length > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span
                      className="underline decoration-dotted underline-offset-2"
                      title={record.courtesies.map((c) => `${c.area}: ${c.mod_name}`).join("\n")}
                    >
                      {t("{count} left to your mods").replace("{count}", String(record.courtesies.length))}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status: one line that moves, and the counts beside it */}
      <div
        ref={statusRef}
        className="relative mx-4 flex shrink-0 items-center gap-3 rounded-xl bg-secondary/[0.32] px-3.5 py-2.5 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]"
      >
        {statusIcon}
        <div className="min-w-0 flex-1">
          <div
            data-current-line
            className={cn("truncate font-mono text-[11.5px]", summary.current ? LEVEL_TONE[summary.current.level] : "text-muted-foreground")}
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
              className="inline-flex h-6 items-center gap-1 rounded-full bg-amber-500/15 px-2.5 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/25"
              title={t("Show the warnings")}
            >
              <AlertTriangle className="h-3 w-3" />
              {summary.warnings === 1 ? t("1 warning") : t("{count} warnings").replace("{count}", String(summary.warnings))}
            </button>
          )}
          {summary.errors > 0 && !isCrashed && (
            <button
              onClick={() => { setView("log"); setFilter("error"); }}
              className="inline-flex h-6 items-center gap-1 rounded-full bg-secondary/70 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary"
              title={t("Lines the game marked ERROR; it kept going")}
            >
              {summary.errors === 1 ? t("1 error reported") : t("{count} errors reported").replace("{count}", String(summary.errors))}
            </button>
          )}
          {isCrashed && (
            <button
              onClick={() => setView("problem")}
              className="inline-flex h-6 items-center gap-1 rounded-full bg-red-500/15 px-2.5 text-[11px] font-medium text-red-200 transition-colors hover:bg-red-500/25"
            >
              <AlertOctagon className="h-3 w-3" />
              {t("Did not start")}
            </button>
          )}
        </div>
      </div>

      {/* Tabs: a segmented control, and the log's own filters beside it */}
      <div className="relative flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3">
        <Segmented>
          <TabButton active={view === "activity"} onClick={() => setView("activity")}>{t("Activity")}</TabButton>
          {hasProblem && (
            <TabButton active={view === "problem"} onClick={() => setView("problem")} tone="danger">
              <Stethoscope className="h-3 w-3" />
              {t("Problem")}
            </TabButton>
          )}
          <TabButton active={view === "log"} onClick={() => setView("log")}>{t("Log")}</TabButton>
        </Segmented>
        {view === "log" && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Segmented>
              {(["all", "warn", "error", "launcher", "client", "game"] as LogFilter[]).map((key) => (
                <TabButton key={key} small active={filter === key} onClick={() => setFilter(key)}>
                  {key === "all" ? t("All") : key === "warn" ? t("Warnings") : key === "error" ? t("Errors") : key === "launcher" ? "Launcher" : key === "client" ? "Client" : t("Game")}
                </TabButton>
              ))}
            </Segmented>
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("Search the log")}
                className="h-7 w-40 rounded-lg bg-secondary/45 pl-7 pr-2 text-[11.5px] outline-none placeholder:text-muted-foreground/70 focus:bg-secondary/60 focus:shadow-[0_0_0_2px_hsl(var(--primary)/0.3)]"
              />
            </label>
          </div>
        )}
      </div>

      {/* Body: fades under the tabs and the footer rather than ending on lines */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto px-4 py-2 [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)]"
      >
        {view === "activity" && (
          events.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Loader2 className="mb-3 h-6 w-6 animate-spin opacity-50" />
              {t("Waiting for the game to report activity…")}
            </div>
          ) : (
            <ol className="divide-y divide-border/40 rounded-xl bg-secondary/[0.32] px-3.5 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
              {events.map((event, index) => {
                const Icon = EVENT_ICON[event.kind];
                return (
                  <li key={index} className="flex min-h-12 items-center gap-3 py-2">
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]", EVENT_TILE[event.kind])}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[13.5px] leading-5">{event.text}</span>
                  </li>
                );
              })}
            </ol>
          )
        )}

        {view === "problem" && (
          <div className="space-y-3">
            <div className="rounded-xl bg-red-500/[0.09] px-4 py-3.5 shadow-[inset_0_0_0_0.5px_hsl(0_80%_70%/0.15)]">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-red-500/20 text-red-300">
                  <AlertOctagon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{t("Minecraft could not start")}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {launchStatus?.message ?? t("The game stopped unexpectedly.")}
                  </p>
                  {summary.fatal && (
                    <div className="mt-2.5">
                      <div className="text-[11px] font-semibold text-muted-foreground">{t("The line it turned on")}</div>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-background/70 p-2.5 font-mono text-[10.5px] leading-relaxed text-red-200">
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
            <div className="rounded-xl bg-black/25 px-3 py-2.5 font-mono text-[11px] leading-5 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
              {filtered.map((line, index) => (
                <LogRow key={index} line={line} />
              ))}
            </div>
          )
        )}
      </div>

      {/* Footer: the count on the left, the tools in one capsule, the two
          actions that leave on the right. */}
      <div className="relative flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pb-3.5 pt-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {view === "activity"
            ? `${events.length} ${t("events")}`
            : view === "log"
              ? `${filtered.length} / ${lines.length} ${t("lines")}`
              : t("Kiza Launcher {version}").replace("{version}", record?.launcher_version ?? "")}
        </span>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-[11px] bg-secondary/45 p-0.5">
            <FooterButton onClick={() => openFolder.mutate(instanceId)} icon={FolderOpen} title={t("Open folder")} />
            <FooterButton onClick={() => openLog.mutate({ instanceId, which: "latest" })} icon={FileText} title="latest.log" />
            <FooterButton onClick={() => void copyLog()} icon={copied ? Check : Copy} title={copied ? t("Copied") : t("Copy the log")} />
          </div>
          <button
            onClick={() => returnToLauncher()}
            className="inline-flex h-9 items-center gap-2 rounded-[11px] bg-secondary/55 px-3.5 text-[13px] font-medium transition-[background-color,scale] duration-150 hover:bg-secondary/80 active:scale-[0.97]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("Back to launcher")}
          </button>
          <button
            onClick={() => stopInstance.mutate(instanceId)}
            disabled={!isRunning || stopInstance.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-[11px] bg-red-500/[0.16] px-3.5 text-[13px] font-semibold text-red-200 transition-[background-color,scale] duration-150 hover:bg-red-500/25 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {stopInstance.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />}
            {t("Stop game")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "2–8 GB" rather than "2048–8192 MB". */
function formatMemoryRange(min: number, max: number): string {
  const gb = (mb: number) => (mb % 1024 === 0 ? String(mb / 1024) : (mb / 1024).toFixed(1));
  return min >= 1024 ? `${gb(min)}–${gb(max)} GB` : `${min} MB–${gb(max)} GB`;
}

function WindowButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** The track a segmented control's segments sit in. */
function Segmented({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center rounded-[10px] bg-secondary/45 p-0.5">{children}</div>;
}

function TabButton({
  active,
  onClick,
  tone,
  small,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: "danger";
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium transition-[background-color,color,box-shadow] duration-200",
        small ? "h-6 rounded-[8px] px-2 text-[11px]" : "h-7 rounded-[8px] px-3.5 text-xs",
        active
          ? cn(
              "bg-background/90 shadow-[0_1px_3px_hsl(0_0%_0%/0.35),0_0_0_0.5px_hsl(0_0%_100%/0.06)]",
              tone === "danger" ? "text-red-200" : "text-foreground",
            )
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
  title,
}: {
  onClick: () => void;
  icon: typeof FolderOpen;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-8 w-9 items-center justify-center rounded-[9px] text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-secondary/70 hover:text-foreground active:scale-[0.94]"
    >
      <Icon className="h-4 w-4" />
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
            "mt-0.5 inline-flex h-4 shrink-0 items-center rounded-[5px] px-1.5 text-[9px] font-semibold uppercase tracking-wide",
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
