import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileArchive,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type { MinecraftInstallStage, MinecraftInstallStatus } from "../../lib/queries";
import { cn } from "../../lib/utils";
import { Badge, Button } from "../ui/primitives";
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
  installing_base_mod: "Installing Kiza base mod",
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function stageUnit(stage: MinecraftInstallStage, count: number) {
  if (stage === "verifying") return count === 1 ? "check" : "checks";
  if (stage === "installing_forge" || stage === "installing_base_mod") {
    return count === 1 ? "component" : "components";
  }
  return count === 1 ? "file" : "files";
}

interface ProgressTrackProps {
  label: string;
  detail: string;
  value: number | null;
}

function ProgressTrack({ label, detail, value }: ProgressTrackProps) {
  const determinate = value !== null;
  const percentage = determinate ? Math.min(100, Math.max(0, value)) : null;

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 items-center justify-between gap-3 text-[11px]">
        <span className="font-medium text-foreground/90">{label}</span>
        <span className="truncate text-right text-muted-foreground tabular-nums" title={detail}>
          {detail}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={percentage ?? undefined}
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-[width] duration-200",
            !determinate && "w-1/3 animate-pulse",
          )}
          style={determinate ? { width: `${percentage}%` } : undefined}
        />
      </div>
    </div>
  );
}

interface MinecraftInstallExperienceProps {
  status: MinecraftInstallStatus;
  loaderLabel: string;
  isActionPending: boolean;
  onInstallOrRepair: () => void;
}

export function MinecraftInstallExperience({
  status,
  loaderLabel,
  isActionPending,
  onInstallOrRepair,
}: MinecraftInstallExperienceProps) {
  const { t } = useI18n();
  const active = isMinecraftInstallActive(status.stage);
  const failed = status.stage === "error" || status.stage === "cancelled";
  const globalProgress = status.overall_total > 0
    ? (status.overall_completed / status.overall_total) * 100
    : null;
  const stageProgress = status.total > 0 ? (status.completed / status.total) * 100 : null;
  const step = Math.min(status.overall_total, status.overall_completed + 1);
  const countDetail = status.total > 0
    ? `${status.completed.toLocaleString()} / ${status.total.toLocaleString()} ${stageUnit(status.stage, status.total)}`
    : "Waiting for a real total";
  const byteDetail = status.bytes_total != null
    ? `${formatBytes(status.bytes_downloaded)} / ${formatBytes(status.bytes_total)}`
    : status.bytes_downloaded > 0
      ? `${formatBytes(status.bytes_downloaded)} downloaded - total size unavailable`
      : "Total size unavailable";

  const StatusIcon = failed
    ? AlertTriangle
    : status.stage === "idle"
      ? Download
      : active
        ? Loader2
        : ShieldCheck;

  return (
    <section
      aria-live="polite"
      aria-label="Minecraft installation"
      className={cn(
        "mt-3 min-w-0 rounded-md border bg-secondary/10 p-3",
        failed ? "border-destructive/40" : "border-border/70",
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
              failed
                ? "border-destructive/35 bg-destructive/10 text-red-300"
                : "border-primary/30 bg-primary/10 text-primary",
            )}
          >
            <StatusIcon className={cn("h-4 w-4", active && "animate-spin")} />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold leading-5">{t(STAGE_LABELS[status.stage])}</h3>
              <Badge className="h-5 max-w-full px-1.5 py-0 text-[10px]">
                {loaderLabel}
              </Badge>
              {status.overall_total > 0 && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {t("Step {a} of {b}").replace("{a}", String(step)).replace("{b}", String(status.overall_total))}
                </span>
              )}
            </div>
            <p
              role={failed ? "alert" : undefined}
              className={cn(
                "mt-0.5 max-w-3xl break-words text-xs leading-5 text-muted-foreground",
                failed && "text-red-300",
              )}
            >
              {status.message ?? (status.stage === "idle"
                ? "Install the selected Minecraft version and loader before playing."
                : "Working from local manifests and verified downloads.")}
            </p>
          </div>
        </div>

        {(status.stage === "idle" || failed) && (
          <Button
            onClick={onInstallOrRepair}
            disabled={isActionPending}
            variant={failed ? "primary" : undefined}
            className="w-full shrink-0 md:w-auto"
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
        <div className="mt-3 grid min-w-0 gap-3 border-t border-border/60 pt-3 lg:grid-cols-2">
          <ProgressTrack
            label={t("Overall progress")}
            detail={status.overall_total > 0
              ? `${status.overall_completed} / ${status.overall_total} ${t("stages complete")}`
              : t("Planning stages")}
            value={globalProgress}
          />
          <ProgressTrack label={t("Current step")} detail={countDetail} value={stageProgress} />

          <div className="min-w-0 lg:col-span-2">
            <div className="flex min-w-0 items-start gap-2 text-xs">
              <FileArchive className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                  <span className="shrink-0 font-medium text-foreground/90">
                    {status.current_category ?? "Current operation"}
                  </span>
                  {status.current_item && (
                    <span className="min-w-0 break-all font-mono text-[11px] text-muted-foreground" title={status.current_item}>
                      {status.current_item}
                    </span>
                  )}
                </div>
                {DOWNLOAD_STAGES.has(status.stage) && (
                  <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">{byteDetail}</div>
                )}
              </div>
            </div>
          </div>
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
