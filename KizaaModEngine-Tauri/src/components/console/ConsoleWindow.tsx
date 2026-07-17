import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  FolderOpen,
  Gamepad2,
  Globe,
  MessageSquare,
  Minus,
  Monitor,
  Rocket,
  Server,
  Square,
  Terminal,
  Volume2,
} from "lucide-react";
import {
  returnToLauncher,
  useInstances,
  useLaunchStatus,
  useLiveInstanceLog,
  useOpenInstanceFolder,
  useStopInstance,
} from "../../lib/queries";
import { deriveKizaEvents, parseLogLine, type KizaEventKind, type LogLevel } from "../../lib/gameLog";
import { formatMinecraftLoader } from "../../lib/minecraftLoaders";
import { cn } from "../../lib/utils";

const EVENT_ICON: Record<KizaEventKind, typeof Rocket> = {
  launch: Rocket,
  mods: Boxes,
  graphics: Monitor,
  audio: Volume2,
  world: Globe,
  server: Server,
  warn: AlertTriangle,
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
  warn: "text-amber-300",
  crash: "text-red-300",
  info: "text-muted-foreground",
};

const LEVEL_TONE: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-300",
  error: "text-red-300",
  debug: "text-muted-foreground/60",
};

export function ConsoleWindow({ instanceId }: { instanceId: string }) {
  const appWindow = getCurrentWindow();
  const { data: instances } = useInstances();
  const instance = instances?.find((i) => i.id === instanceId);
  const { data: launchStatus } = useLaunchStatus(instanceId);
  const { data: rawLog } = useLiveInstanceLog(instanceId, true);
  const stopInstance = useStopInstance();
  const openFolder = useOpenInstanceFolder();
  const [view, setView] = useState<"activity" | "raw">("activity");
  const scrollRef = useRef<HTMLDivElement>(null);

  const isRunning = launchStatus?.phase === "running";
  const phase = launchStatus?.phase;

  const lines = useMemo(() => {
    if (!rawLog) return [];
    return rawLog.split("\n").filter(Boolean).map(parseLogLine);
  }, [rawLog]);
  const events = useMemo(() => deriveKizaEvents(lines), [lines]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [events.length, lines.length, view]);

  const phaseLabel = (() => {
    switch (phase) {
      case "preparing": return "Preparing";
      case "downloading_java": return "Downloading Java";
      case "downloading_game": return "Verifying files";
      case "repairing_mods": return "Repairing mods";
      case "starting": return "Starting";
      case "running": return "In game";
      case "crashed": return "Crashed";
      case "exited": return "Stopped";
      default: return "Idle";
    }
  })();

  const versionLabel = instance?.minecraft
    ? `Minecraft ${instance.minecraft.mc_version} - ${formatMinecraftLoader(instance.minecraft)}`
    : "Minecraft";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Custom draggable title bar */}
      <div
        className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 bg-card/60 pl-4 pr-2 backdrop-blur-sm"
        onMouseDown={() => appWindow.startDragging()}
      >
        <div className="flex items-center gap-2.5 pointer-events-none">
          <Terminal className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold tracking-wide text-primary">Kiza Manager</span>
          <span className="text-xs text-muted-foreground">/ {instance?.display_name ?? "Instance"}</span>
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
            title="Back to launcher"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Sub-header: status + view switch */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-card/30 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06)]">
            <Gamepad2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{instance?.display_name ?? "Instance"}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  isRunning
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : phase === "crashed"
                      ? "border-red-500/30 bg-red-500/10 text-red-300"
                      : "border-border/70 bg-secondary/30 text-muted-foreground",
                )}
              >
                {isRunning && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                {phaseLabel}
              </span>
            </div>
            <div className="truncate text-xs text-muted-foreground">{versionLabel}</div>
          </div>
        </div>

        <div className="flex rounded-lg border border-border/70 bg-secondary/20 p-0.5">
          <button
            onClick={() => setView("activity")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view === "activity" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Activity
          </button>
          <button
            onClick={() => setView("raw")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view === "raw" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Raw log
          </button>
        </div>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-background/40 px-4 py-3.5">
        {view === "activity" ? (
          events.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Boxes className="mb-3 h-8 w-8 opacity-40" />
              Waiting for the game to report activity…
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
        ) : lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No log output yet.</div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
            {lines.map((line, index) => (
              <div key={index} className={LEVEL_TONE[line.level]}>
                {line.raw}
              </div>
            ))}
          </pre>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/40 px-4 py-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {view === "activity" ? `${events.length} events` : `${lines.length} lines`}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openFolder.mutate(instanceId)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/40 px-3.5 text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-secondary/70 active:scale-[0.96]"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open folder
          </button>
          {launchStatus?.log_path && (
            <button
              onClick={() => openPath(launchStatus.log_path!).catch(() => undefined)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/40 px-3.5 text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-secondary/70 active:scale-[0.96]"
            >
              latest.log
            </button>
          )}
          <button
            onClick={() => returnToLauncher()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/40 px-3.5 text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-secondary/70 active:scale-[0.96]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to launcher
          </button>
          <button
            onClick={() => stopInstance.mutate(instanceId)}
            disabled={!isRunning || stopInstance.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3.5 text-sm font-semibold text-red-200 transition-[background-color,transform] duration-150 hover:bg-red-500/20 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Square className="h-3.5 w-3.5" />
            Stop game
          </button>
        </div>
      </div>
    </div>
  );
}
