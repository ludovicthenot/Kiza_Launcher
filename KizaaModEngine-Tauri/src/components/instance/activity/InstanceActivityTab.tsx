import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  Boxes,
  FolderOpen,
  Gamepad2,
  Globe,
  Loader2,
  MessageSquare,
  Monitor,
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
import { cn } from "../../../lib/utils";
import { Badge, Button, EmptyState } from "../../ui/primitives";

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

export function InstanceActivityTab({ instance }: { instance: GameInstanceSummary }) {
  const [view, setView] = useState<"activity" | "raw">("activity");
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
  const running = status?.phase === "running";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 px-5 py-5 sm:px-6">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-balance">
            <Terminal className="h-5 w-5 text-primary" />
            Activity & logs
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Follow launches, game events, warnings and crashes for this instance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={running ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : ""}>
            {running ? "In game" : status?.phase ?? "Idle"}
          </Badge>
          <div className="flex rounded-lg border border-border/70 bg-secondary/20 p-0.5">
            {(["activity", "raw"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setView(option)}
                className={cn(
                  "h-9 rounded-md px-3 text-sm font-medium transition-colors",
                  view === option ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "activity" ? "Activity" : "Raw log"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : view === "activity" ? (
          events.length ? (
            <ol className="mx-auto max-w-5xl space-y-2">
              {events.map((event, index) => {
                const Icon = EVENT_ICON[event.kind];
                return (
                  <li
                    key={`${event.kind}-${index}`}
                    className="flex min-h-12 items-start gap-3 rounded-lg border border-border/60 bg-card/45 px-4 py-3"
                  >
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", EVENT_TONE[event.kind])} />
                    <span className="text-sm leading-5">{event.text}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState
              icon={Gamepad2}
              title="No activity yet"
              description="Launch Minecraft once and Kiza will summarize the useful events here."
              className="h-full border-0 bg-transparent"
            />
          )
        ) : lines.length ? (
          <pre className="mx-auto max-w-6xl whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-black/25 p-4 font-mono text-[11px] leading-5">
            {lines.map((line, index) => (
              <div key={index} className={LEVEL_TONE[line.level]}>
                {line.raw}
              </div>
            ))}
          </pre>
        ) : (
          <EmptyState
            icon={Terminal}
            title="No log file yet"
            description="The raw Minecraft log appears after the first launch."
            className="h-full border-0 bg-transparent"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-card/25 px-5 py-3 sm:px-6">
        <span className="text-xs text-muted-foreground tabular-nums">
          {view === "activity" ? `${events.length} events` : `${lines.length} lines`}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => openFolder.mutate(instance.id)}>
            <FolderOpen className="h-4 w-4" />
            Open folder
          </Button>
          {status?.log_path && (
            <Button onClick={() => openPath(status.log_path!).catch(() => undefined)}>
              latest.log
            </Button>
          )}
          <Button onClick={() => invoke("open_console_window", { instanceId: instance.id })}>
            <Terminal className="h-4 w-4" />
            Open Kiza Manager
          </Button>
          {running && (
            <Button
              variant="danger"
              onClick={() => stopInstance.mutate(instance.id)}
              disabled={stopInstance.isPending}
            >
              <Square className="h-3.5 w-3.5" />
              Stop game
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
