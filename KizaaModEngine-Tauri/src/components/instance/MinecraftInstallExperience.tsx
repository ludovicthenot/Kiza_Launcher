import { formatBytes } from "../../lib/units";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type { MinecraftInstallStage, MinecraftInstallStatus } from "../../lib/queries";
import { cn } from "../../lib/utils";
import { Button } from "../ui/primitives";
import { useI18n } from "../../lib/i18n";

const STAGE_LABELS: Record<MinecraftInstallStage, string> = {
  idle: "Minecraft setup required",
  preparing: "Preparing Minecraft",
  downloading_client: "Downloading Minecraft client",
  downloading_libraries: "Downloading game libraries",
  downloading_asset_index: "Loading the asset index",
  downloading_assets: "Downloading game assets",
  installing_fabric: "Installing Fabric",
  installing_forge: "Installing Forge",
  installing_base_mod: "Installing Kiza Client Runtime",
  verifying: "Verifying installation",
  done: "Ready to play",
  cancelled: "Installation cancelled",
  error: "Installation failed",
};

const DOWNLOAD_STAGES = new Set<MinecraftInstallStage>([
  "downloading_client",
  "downloading_libraries",
  "downloading_asset_index",
  "downloading_assets",
  "installing_fabric",
  "installing_forge",
]);

export function isMinecraftInstallActive(stage: MinecraftInstallStage | undefined) {
  return stage != null && !["idle", "done", "cancelled", "error"].includes(stage);
}

export function isMinecraftPlayLocked(status: MinecraftInstallStatus | null | undefined) {
  return !status || status.stage !== "done" || !status.ready;
}


function stageUnit(stage: MinecraftInstallStage, count: number) {
  if (stage === "verifying") return count === 1 ? "check" : "checks";
  if (stage === "installing_forge" || stage === "installing_base_mod") {
    return count === 1 ? "component" : "components";
  }
  return count === 1 ? "file" : "files";
}

/**
 * A ring that fills with the install: the percentage in the middle, the
 * arc easing to each new value rather than jumping, a slow turn while the
 * total is not known yet.
 */
function ProgressRing({ value, failed, label }: { value: number | null; failed: boolean; label: string }) {
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  const known = value !== null;
  const fraction = known ? Math.min(1, Math.max(0, value / 100)) : 0.28;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(value) : undefined}
      className="relative h-12 w-12 shrink-0"
    >
      <svg viewBox="0 0 48 48" className={cn("h-12 w-12 -rotate-90", !known && "animate-spin [animation-duration:1.6s]")}>
        <circle cx="24" cy="24" r={radius} fill="none" strokeWidth="4" className="stroke-foreground/10" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          className={cn(
            "transition-[stroke-dashoffset] duration-700 ease-drawer",
            failed ? "stroke-red-400" : "stroke-primary",
          )}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      {known && (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums">
          {Math.round(value)}%
        </span>
      )}
    </div>
  );
}

interface MinecraftInstallExperienceProps {
  status: MinecraftInstallStatus;
  loaderLabel: string;
  isActionPending: boolean;
  onInstallOrRepair: () => void;
}

/**
 * The install, as one calm object: a ring with the overall percentage, the
 * stage in words, one bar that moves smoothly from the stage's own count,
 * a dot per stage, and the file in hand in small type underneath.
 */
export function MinecraftInstallExperience({
  status,
  loaderLabel,
  isActionPending,
  onInstallOrRepair,
}: MinecraftInstallExperienceProps) {
  const { t } = useI18n();
  const active = isMinecraftInstallActive(status.stage);
  const failed = status.stage === "error" || status.stage === "cancelled";
  const stageFraction = status.total > 0 ? Math.min(1, status.completed / status.total) : 0;
  // Overall, smoothed by the stage in progress: eight stages of very
  // different lengths read as a bar that stalls and leaps otherwise.
  const overall = status.overall_total > 0
    ? Math.min(100, ((status.overall_completed + (active ? stageFraction : 0)) / status.overall_total) * 100)
    : null;
  const step = Math.min(status.overall_total, status.overall_completed + 1);
  const countDetail = status.total > 0
    ? `${status.completed.toLocaleString()} / ${status.total.toLocaleString()} ${t(stageUnit(status.stage, status.total))}`
    : null;
  const byteDetail = DOWNLOAD_STAGES.has(status.stage) && status.bytes_total != null
    ? `${formatBytes(status.bytes_downloaded, "auto", 1)} / ${formatBytes(status.bytes_total, "auto", 1)}`
    : null;

  return (
    <section
      aria-live="polite"
      aria-label={t("Minecraft installation")}
      className={cn(
        "mt-4 min-w-0 rounded-2xl p-4 backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-1 duration-300 motion-reduce:animate-none",
        failed ? "bg-red-500/[0.08] shadow-[inset_0_0_0_0.5px_hsl(0_80%_70%/0.2)]" : "bg-secondary/[0.28] shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.06)]",
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        {active || status.stage === "verifying" ? (
          <ProgressRing value={overall} failed={false} label={t("Overall progress")} />
        ) : (
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
              failed ? "bg-red-500/15 text-red-300" : "bg-primary/15 text-primary",
            )}
          >
            {failed ? <AlertTriangle className="h-5 w-5" /> : status.stage === "idle" ? <Download className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </span>
        )}

        <div className="min-w-0 flex-1">
          {/* The stage name crossfades as it changes. */}
          <h3 key={status.stage} className="truncate text-[15px] font-semibold animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            {t(STAGE_LABELS[status.stage])}
          </h3>
          <p
            role={failed ? "alert" : undefined}
            className={cn("mt-0.5 truncate text-[12.5px] text-muted-foreground", failed && "whitespace-normal text-red-300")}
          >
            {failed || status.stage === "idle"
              ? status.message ?? t("Install the selected Minecraft version and loader before playing.")
              : [
                  status.overall_total > 0
                    ? t("Step {a} of {b}").replace("{a}", String(step)).replace("{b}", String(status.overall_total))
                    : null,
                  loaderLabel,
                ].filter(Boolean).join(" · ")}
          </p>
        </div>

        {(status.stage === "idle" || failed) && (
          <Button
            onClick={onInstallOrRepair}
            disabled={isActionPending}
            variant="primary"
            className="shrink-0"
          >
            {isActionPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : failed ? (
              <RotateCcw className="h-4 w-4" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {failed ? t("Retry / Repair") : t("Install Minecraft")}
          </Button>
        )}
      </div>

      {active && (
        <div className="mt-4 space-y-2.5">
          {/* One bar for the stage in hand, easing between values, with a
              sheen passing over the filled part to show it is alive. */}
          <div
            role="progressbar"
            aria-label={t("Current step")}
            aria-valuemin={status.total > 0 ? 0 : undefined}
            aria-valuemax={status.total > 0 ? 100 : undefined}
            aria-valuenow={status.total > 0 ? Math.round(stageFraction * 100) : undefined}
            className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
          >
            <div
              className={cn(
                "kiza-sheen h-full rounded-full bg-primary transition-[width] duration-700 ease-drawer",
                status.total === 0 && "w-1/4 animate-pulse",
              )}
              style={status.total > 0 ? { width: `${Math.max(2, stageFraction * 100)}%` } : undefined}
            />
          </div>

          <div className="flex min-w-0 items-center justify-between gap-4 text-[11.5px] text-muted-foreground">
            <span className="min-w-0 truncate font-mono text-[11px] opacity-80" title={status.current_item ?? undefined}>
              {status.current_item ?? status.current_category ?? t("Working from local manifests and verified downloads.")}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
              <span>{countDetail ?? t("Waiting for a real total")}</span>
              {byteDetail && (
                <>
                  <span aria-hidden>·</span>
                  <span>{byteDetail}</span>
                </>
              )}
            </span>
          </div>

          {/* A dot per stage: done, in hand, to come. */}
          {status.overall_total > 0 && (
            <div className="flex items-center gap-1.5 pt-0.5" aria-hidden>
              {Array.from({ length: status.overall_total }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors duration-500",
                    index < status.overall_completed
                      ? "bg-primary/70"
                      : index === status.overall_completed
                        ? "bg-primary/40 animate-pulse"
                        : "bg-foreground/10",
                  )}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

interface MinecraftPlayButtonProps {
  status: MinecraftInstallStatus | null | undefined;
  isLaunching: boolean;
  isRunning: boolean;
  isInstanceValid: boolean;
  onClick: () => void;
}

export function MinecraftPlayButton({
  status,
  isLaunching,
  isRunning,
  isInstanceValid,
  onClick,
}: MinecraftPlayButtonProps) {
  const { t } = useI18n();
  const locked = isMinecraftPlayLocked(status);
  return (
    <Button
      onClick={onClick}
      disabled={locked || isLaunching || isRunning || !isInstanceValid}
      variant="primary"
      className={cn("min-w-24", isLaunching && "animate-pulse")}
      title={locked ? t("Minecraft must be installed and verified before launch.") : undefined}
    >
      {isLaunching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isRunning ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      {isRunning ? t("In game") : t("Play")}
    </Button>
  );
}
