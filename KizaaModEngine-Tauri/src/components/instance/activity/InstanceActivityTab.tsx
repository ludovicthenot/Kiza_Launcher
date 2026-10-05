import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  Boxes,
  FileText,
  FolderOpen,
  Gamepad2,
  Globe,
  Loader2,
  MessageSquare,
  Monitor,
  Search,
  Server,
  Square,
  Terminal,
  Volume2,
} from "lucide-react";
import { GameInstanceSummary } from "../../../lib/types";
import {
  useLaunchStatus,
  useLiveInstanceLog,
  useOpenInstanceFolder,
  useStopInstance,
} from "../../../lib/queries";
import {
  deriveKizaEvents,
  parseLogLine,
  type KizaEventKind,
  type LogLevel,
} from "../../../lib/gameLog";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { EmptyState } from "../../ui/primitives";
import { SlidingPill } from "../../ui/sliding-pill";
import { part } from "../../../lib/theme/parts";

const EVENT_ICON: Record<KizaEventKind, typeof Gamepad2> = {
  launch: Gamepad2,
  mods: Boxes,
  graphics: Monitor,
  audio: Volume2,
  world: Globe,
  server: Server,
  crash: AlertTriangle,
  info: MessageSquare,
};

/** Each kind of event on its own tinted tile, as in the Kiza Manager. */
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

const LEVEL_TONE: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-300",
  error: "text-red-300",
  debug: "text-muted-foreground/60",
};

/** The chosen segment's text; the sliding pill under it is the lift. */
const SEGMENT_ON = "text-foreground";

type View = "activity" | "log";
type Level = "all" | "warn" | "error";

/**
 * Instance → Activity: what the last launch did, in plain sentences, and the
 * log underneath for when the sentences are not enough.
 */
export function InstanceActivityTab({ instance }: { instance: GameInstanceSummary }) {
  const { t } = useI18n();
  const [view, setView] = useState<View>("activity");
  const [level, setLevel] = useState<Level>("all");
  const [search, setSearch] = useState("");
  const { data: status } = useLaunchStatus(instance.id);
  const { data: rawLog, isLoading } = useLiveInstanceLog(instance.id, true);
  const openFolder = useOpenInstanceFolder();
  const stopInstance = useStopInstance();

  const lines = useMemo(
    () => (rawLog ?? "").split("\n").filter(Boolean).map(parseLogLine),
    [rawLog],
  );
  const events = useMemo(
    () => deriveKizaEvents(lines, { libraryModCount: instance.mod_count }),
    [instance.mod_count, lines],
  );
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return lines.filter(
      (line) =>
        (level === "all" || line.level === level) &&
        (!needle || line.raw.toLowerCase().includes(needle)),
    );
  }, [lines, level, search]);
  const warnings = lines.filter((line) => line.level === "warn").length;
  const errors = lines.filter((line) => line.level === "error").length;

  const phase = status?.phase ?? "idle";
  const running = phase === "running";
  const crashed = phase === "crashed";
  const phaseLabel = running
    ? t("In game")
    : crashed
      ? t("Crashed")
      : phase === "exited"
        ? t("Exited")
        : phase === "idle"
          ? t("Idle")
          : t("Starting");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4 px-5 pb-3 pt-2 sm:px-8">
        <div className="min-w-0">
          <h2 {...part("activity.title")} className="text-[22px] font-bold tracking-tight">{t("Activity")}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
            <span className={cn("inline-flex items-center gap-1.5 font-medium", running ? "text-emerald-300" : crashed ? "text-red-300" : "")}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {phaseLabel}
            </span>
            {warnings > 0 && (
              <>
                <span aria-hidden>·</span>
                <button type="button" onClick={() => { setView("log"); setLevel("warn"); }} className="text-amber-300 hover:underline">
                  {warnings === 1 ? t("1 warning") : t("{count} warnings").replace("{count}", String(warnings))}
                </button>
              </>
            )}
            {errors > 0 && (
              <>
                <span aria-hidden>·</span>
                <button type="button" onClick={() => { setView("log"); setLevel("error"); }} className="hover:text-foreground hover:underline">
                  {errors === 1 ? t("1 error reported") : t("{count} errors reported").replace("{count}", String(errors))}
                </button>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {view === "log" && (
            <>
              <div {...part("activity.levels")} className="relative flex items-center rounded-[10px] bg-secondary/45 p-0.5">
                <SlidingPill value={level} />
                {(["all", "warn", "error"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setLevel(option)}
                    data-active={level === option}
                    className={cn(
                      "relative z-[1] h-7 rounded-[8px] px-3 text-xs font-medium transition-colors duration-200",
                      level === option ? SEGMENT_ON : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option === "all" ? t("All") : option === "warn" ? t("Warnings") : t("Errors")}
                  </button>
                ))}
              </div>
              <label className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("Search the log")}
                  className="h-8 w-44 rounded-[10px] bg-secondary/45 pl-8 pr-2 text-xs outline-none placeholder:text-muted-foreground/70 focus:bg-secondary/60 focus:shadow-[0_0_0_2px_hsl(var(--primary)/0.3)]"
                />
              </label>
            </>
          )}
          <div {...part("activity.views")} className="relative flex items-center rounded-[10px] bg-secondary/45 p-0.5">
            <SlidingPill value={view} />
            {(["activity", "log"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                data-active={view === option}
                className={cn(
                  "relative z-[1] h-7 rounded-[8px] px-3.5 text-xs font-medium transition-colors duration-200",
                  view === option ? SEGMENT_ON : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "activity" ? t("Activity") : t("Log")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2 sm:px-8 [mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%-10px),transparent)]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : view === "activity" ? (
          events.length ? (
            <ol className="divide-y divide-border/40 rounded-2xl bg-secondary/[0.22] px-4 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.06)]">
              {events.map((event, index) => {
                const Icon = EVENT_ICON[event.kind];
                return (
                  <li key={`${event.kind}-${index}`} className="flex min-h-[52px] items-center gap-3 py-2.5">
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]", EVENT_TILE[event.kind])}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[13.5px] leading-5">{event.text}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState
              icon={Gamepad2}
              title={t("No activity yet")}
              description={t("Launch Minecraft once and Kiza will summarize the useful events here.")}
              className="h-full border-0 bg-transparent"
            />
          )
        ) : shown.length ? (
          <div className="whitespace-pre-wrap break-words rounded-2xl bg-black/30 p-4 font-mono text-[11px] leading-5 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.06)]">
            {shown.map((line, index) => (
              <div key={index} className={LEVEL_TONE[line.level]}>
                {line.raw}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Terminal}
            title={lines.length ? t("Nothing matches.") : t("No log file yet")}
            description={lines.length ? undefined : t("The raw Minecraft log appears after the first launch.")}
            className="h-full border-0 bg-transparent"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-4 pt-2 sm:px-8">
        <span className="text-xs tabular-nums text-muted-foreground">
          {view === "activity"
            ? `${events.length} ${t("events")}`
            : `${shown.length} / ${lines.length} ${t("lines")}`}
        </span>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-[11px] bg-secondary/45 p-0.5">
            <Tool label={t("Open folder")} icon={FolderOpen} onClick={() => openFolder.mutate(instance.id)} />
            {status?.log_path && (
              <Tool label="latest.log" icon={FileText} onClick={() => void openPath(status.log_path!).catch(() => undefined)} />
            )}
          </div>
          <button
            type="button"
            onClick={() => void invoke("open_console_window", { instanceId: instance.id }).catch(() => undefined)}
            className="inline-flex h-9 items-center gap-2 rounded-[11px] bg-secondary/55 px-3.5 text-[13px] font-medium transition-[background-color,scale] hover:bg-secondary/80 active:scale-[0.97]"
          >
            <Terminal className="h-3.5 w-3.5" />
            {t("Open Kiza Manager")}
          </button>
          {running && (
            <button
              type="button"
              onClick={() => stopInstance.mutate(instance.id)}
              disabled={stopInstance.isPending}
              className="inline-flex h-9 items-center gap-2 rounded-[11px] bg-red-500/[0.16] px-3.5 text-[13px] font-semibold text-red-200 transition-[background-color,scale] hover:bg-red-500/25 active:scale-[0.97] disabled:opacity-50"
            >
              {stopInstance.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />}
              {t("Stop game")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Tool({ label, icon: Icon, onClick }: { label: string; icon: typeof Terminal; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-8 w-9 items-center justify-center rounded-[9px] text-muted-foreground transition-[background-color,color,scale] hover:bg-secondary/70 hover:text-foreground active:scale-[0.94]"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
