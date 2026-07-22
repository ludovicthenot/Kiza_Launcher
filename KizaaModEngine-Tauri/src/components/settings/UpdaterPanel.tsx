import {
  AlertCircle,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useUpdaterStore, type UpdaterPhase } from "../../lib/updater";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

const PHASE_LABELS: Record<UpdaterPhase, string> = {
  idle: "Not checked",
  checking: "Checking",
  unavailable: "Current",
  available: "Available",
  downloading: "Downloading",
  ready: "Ready",
  deferred: "Later",
  installing: "Installing",
  error: "Error",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function UpdaterPanel() {
  const { t } = useI18n();
  const {
    phase,
    version,
    notes,
    progress,
    error,
    checkForUpdate,
    downloadUpdate,
    postponeInstallation,
    installUpdate,
    retry,
  } = useUpdaterStore();

  const phaseDescription = (() => {
    switch (phase) {
      case "checking":
        return t("Checking the signed GitHub release metadata...");
      case "unavailable":
        return t("No update is available. This version is current.");
      case "available":
        return `${t("Update available")}: v${version ?? "?"}. ${t("Download it now; installation remains your choice.")}`;
      case "downloading":
        return `${t("Downloading version")} ${version ?? "?"}...`;
      case "ready":
        return t("Downloaded and ready. Nothing will be installed until you confirm.");
      case "deferred":
        return t("Installation postponed. The download stays ready while this launcher remains open.");
      case "installing":
        return t("Starting the signed installer. The launcher will close and restart.");
      case "error":
        return error ?? t("The updater could not complete the requested action.");
      default:
        return t("Check GitHub Releases for a signed launcher update.");
    }
  })();

  const percentage = progress.totalBytes
    ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
    : null;
  const statusIsPositive = phase === "unavailable" || phase === "ready" || phase === "deferred";
  const statusIsWarning = phase === "available" || phase === "downloading" || phase === "installing";

  return (
    <div className="rounded-lg border border-border/70 bg-secondary/10 p-4" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <div className="font-medium">{t("Updater")}</div>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-normal",
                statusIsPositive && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                statusIsWarning && "border-amber-500/30 bg-amber-500/10 text-amber-300",
                phase === "error" && "border-red-500/30 bg-red-500/10 text-red-300",
                !statusIsPositive && !statusIsWarning && phase !== "error" && "border-border bg-secondary/30 text-muted-foreground",
              )}
            >
              {t(PHASE_LABELS[phase])}
            </span>
          </div>
          <p className={cn("mt-1 text-sm text-muted-foreground", phase === "error" && "text-red-300")}>
            {phaseDescription}
          </p>
          {notes && (phase === "available" || phase === "ready" || phase === "deferred") && (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground/80">{notes}</p>
          )}
        </div>

        <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-end gap-2">
          {(phase === "idle" || phase === "unavailable") && (
            <button
              onClick={() => void checkForUpdate()}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.96]"
            >
              <RefreshCw className="h-4 w-4" />
              {t("Check updates")}
            </button>
          )}

          {phase === "checking" && (
            <button disabled className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground opacity-60">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("Checking")}
            </button>
          )}

          {phase === "available" && (
            <button
              onClick={() => void downloadUpdate()}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.96]"
            >
              <Download className="h-4 w-4" />
              {t("Download update")}
            </button>
          )}

          {phase === "downloading" && (
            <button disabled className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground opacity-60">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("Downloading")}
            </button>
          )}

          {phase === "ready" && (
            <button
              onClick={postponeInstallation}
              className="h-10 rounded-md border border-border bg-secondary/30 px-4 text-sm font-medium transition-colors hover:bg-secondary active:scale-[0.96]"
            >
              {t("Later")}
            </button>
          )}

          {(phase === "ready" || phase === "deferred") && (
            <button
              onClick={() => void installUpdate()}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.96]"
            >
              <RotateCcw className="h-4 w-4" />
              {t("Install and restart")}
            </button>
          )}

          {phase === "installing" && (
            <button disabled className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground opacity-60">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("Installing")}
            </button>
          )}

          {phase === "error" && (
            <button
              onClick={() => void retry()}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.96]"
            >
              <AlertCircle className="h-4 w-4" />
              {t("Retry")}
            </button>
          )}
        </div>
      </div>

      {phase === "downloading" && (
        <div className="mt-4 space-y-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn("h-full rounded-full bg-primary transition-[width] duration-200", percentage === null && "w-1/3 animate-pulse")}
              style={percentage === null ? undefined : { width: `${percentage}%` }}
            />
          </div>
          <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
            <span>{formatBytes(progress.downloadedBytes)}</span>
            <span>{progress.totalBytes ? `${percentage}% / ${formatBytes(progress.totalBytes)}` : t("Size unavailable")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
