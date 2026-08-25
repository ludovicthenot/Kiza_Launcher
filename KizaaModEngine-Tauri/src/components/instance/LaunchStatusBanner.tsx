import { useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { LaunchStatus, useAppConfig, useDismissLaunchStatus, useInstanceLog } from "../../lib/queries";
import { cn } from "../../lib/utils";
import { CrashDoctorPanel } from "./CrashDoctorPanel";

const PHASE_LABELS: Record<string, string> = {
  preparing: "Preparing launch...",
  downloading_java: "Downloading Java runtime...",
  downloading_game: "Verifying game files...",
  repairing_mods: "Preparing managed mods...",
  starting: "Starting Minecraft...",
};

const BUSY_PHASES = Object.keys(PHASE_LABELS);

export function LaunchStatusBanner({
  instanceId,
  status,
}: {
  instanceId: string;
  status: LaunchStatus;
}) {
  const dismiss = useDismissLaunchStatus();
  const { data: config } = useAppConfig();
  const readLog = useInstanceLog();
  const [log, setLog] = useState<string | null>(null);

  const isBusy = BUSY_PHASES.includes(status.phase);
  const isCrashed = status.phase === "crashed";

  // "After a crash", from General. Three answers, and this is where each one
  // means something: "silent" says nothing at all, "report" shows the crash
  // doctor's findings, "safe_mode" offers to start hunting the broken mod.
  //
  // Read here rather than in Rust because the choice is about what the window
  // shows, and Rust has already done its part by recording the crash.
  const crashAction = config?.crash_action ?? "report";

  if (!isBusy && !isCrashed) return null;
  if (isCrashed && crashAction === "silent") return null;

  if (isBusy) {
    return (
      <div className="mt-3 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <span className="font-medium text-foreground">
          {status.message ?? PHASE_LABELS[status.phase] ?? "Launching..."}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-foreground">Minecraft crashed</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {status.message ?? "The game stopped unexpectedly."}
          </p>
          {crashAction !== "silent" && <CrashDoctorPanel instanceId={instanceId} />}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() =>
                readLog.mutate(
                  { instanceId, lines: 120 },
                  { onSuccess: (content) => setLog(content) },
                )
              }
              disabled={readLog.isPending}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 text-xs font-medium transition hover:bg-secondary active:scale-[0.96]"
            >
              {readLog.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {log ? "Refresh log" : "View log"}
            </button>
            <button
              onClick={() => dismiss.mutate(instanceId)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary/40 hover:text-foreground active:scale-[0.96]"
            >
              <X className="h-3 w-3" />
              Dismiss
            </button>
          </div>
        </div>
      </div>

      {log !== null && (
        <pre
          className={cn(
            "mt-3 max-h-64 overflow-auto rounded-md border border-border/70 bg-background/80 p-3",
            "font-mono text-[11px] leading-relaxed text-muted-foreground",
          )}
        >
          {log || "Log is empty."}
        </pre>
      )}
    </div>
  );
}
