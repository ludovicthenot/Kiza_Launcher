import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Package,
  PackageCheck,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  DependencyInstallResult,
  DependencyNotice,
  DependencyResolution,
  InstallationStatus,
  ResolvedArtifact,
} from "../../../lib/queries";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Button } from "../../ui/primitives";
import { Group } from "../../ui/grouped";
import { ProviderBadge, providerLabel } from "../../common/ProviderBadge";

interface DependencyInstallDialogProps {
  open: boolean;
  plan: DependencyResolution | null;
  result: DependencyInstallResult | null;
  installing: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/** What a mentioned project is called: its name when the catalogue gave one. */
function targetLabel(notice: DependencyNotice): string {
  return (
    notice.name ??
    notice.target.projectId ??
    notice.target.versionId ??
    String(notice.target.fileId ?? "Unknown")
  );
}

function resultTitle(status: InstallationStatus): string {
  switch (status) {
    case "installed":
      return "Installation complete";
    case "no_changes":
      return "Already installed";
    case "blocked":
      return "Installation blocked";
    case "rolled_back":
      return "Installation rolled back";
    case "rollback_incomplete":
      return "Rollback incomplete";
  }
}

function ResultStatusIcon({ status }: { status: InstallationStatus }) {
  const ok = status === "installed" || status === "no_changes";
  const Icon = ok ? CheckCircle2 : status === "rolled_back" ? RotateCcw : AlertTriangle;
  return (
    <div
      className={cn(
        "flex h-14 w-14 items-center justify-center rounded-full",
        ok ? "bg-emerald-500/15 text-emerald-400" : status === "rolled_back" ? "bg-amber-500/15 text-amber-400" : "bg-destructive/15 text-red-300",
      )}
    >
      <Icon className="h-7 w-7" />
    </div>
  );
}

/** A small square icon for a mod, or a package mark when it has none. */
function ModIcon({ url, size = "h-9 w-9" }: { url: string | null | undefined; size?: string }) {
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-[9px] bg-secondary/50 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.08)]", size)}>
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <Package className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

function ItemRow({
  icon,
  title,
  detail,
  trailing,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-2.5">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium">{title}</div>
        {detail && <div className="truncate text-xs text-muted-foreground">{detail}</div>}
      </div>
      {trailing && <div className="shrink-0 text-xs">{trailing}</div>}
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function DependencyInstallDialog({
  open,
  plan,
  result,
  installing,
  onOpenChange,
  onConfirm,
}: DependencyInstallDialogProps) {
  const { t } = useI18n();
  const pendingRequired = plan?.required.filter((item) => !item.alreadyInstalled) ?? [];
  const installedRequired = plan?.required.filter((item) => item.alreadyInstalled) ?? [];
  const installCount = plan?.installOrder.length ?? 0;
  const root: ResolvedArtifact | undefined = plan?.root?.artifact;
  const filesLabel = (count: number) =>
    (count === 1 ? t("{count} file") : t("{count} files")).replace("{count}", String(count));

  const summary = plan
    ? [
        installCount > 0 ? t("{files} to install").replace("{files}", filesLabel(installCount)) : null,
        installedRequired.length > 0
          ? t("{count} already there").replace("{count}", String(installedRequired.length))
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !installing && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[82vh] max-w-xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        {root?.coverUrl && !result && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-36 overflow-hidden [mask-image:linear-gradient(to_bottom,black,transparent)]"
          >
            <img src={root.coverUrl} alt="" className="h-full w-full scale-150 object-cover opacity-25 blur-3xl saturate-150" />
          </div>
        )}

        <DialogHeader className="relative space-y-0 px-6 pb-2 pt-7 pr-14">
          {result ? (
            <DialogTitle className="sr-only">{t("Installation result")}</DialogTitle>
          ) : (
            <div className="flex items-center gap-4">
              <ModIcon url={root?.coverUrl} size="h-14 w-14 rounded-[14px]" />
              <div className="min-w-0">
                <DialogTitle className="truncate text-left text-lg font-semibold tracking-tight">
                  {root?.name ?? t("Mod installation")}
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-left text-[13px]">
                  {plan
                    ? `Minecraft ${plan.context.minecraftVersion} · ${capitalize(plan.context.loader)}`
                    : t("Checking compatible files and dependencies")}
                </DialogDescription>
              </div>
            </div>
          )}
        </DialogHeader>

        <div className="relative min-h-0 overflow-y-auto px-6 pb-2 pt-4">
          {!plan && (
            <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              {t("Resolving dependencies")}
            </div>
          )}

          {plan && !result && (
            <div className="space-y-6">
              {summary && <p className="px-1 text-[13px] text-muted-foreground">{summary}</p>}

              <Group title={t("Required")}>
                {pendingRequired.length === 0 && installedRequired.length === 0 ? (
                  <div className="py-3 text-[13px] text-muted-foreground">{t("No required dependencies.")}</div>
                ) : (
                  [...pendingRequired, ...installedRequired].map((item) => (
                    <ItemRow
                      key={`${item.artifact.project.provider}:${item.artifact.project.project_id}`}
                      icon={<ModIcon url={item.artifact.coverUrl} />}
                      title={item.artifact.name}
                      detail={item.artifact.fileName || item.artifact.version}
                      trailing={
                        item.alreadyInstalled ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {t("Installed")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t("Will be installed")}</span>
                        )
                      }
                    />
                  ))
                )}
              </Group>

              {plan.optional.length > 0 && (
                <Group title={t("Optional")}>
                  {plan.optional.map((notice) => (
                    <ItemRow
                      key={`${notice.requiredBy.project_id}:${targetLabel(notice)}`}
                      icon={<ModIcon url={null} />}
                      title={targetLabel(notice)}
                      detail={
                        <span className="inline-flex items-center gap-1.5">
                          <ProviderBadge provider={notice.target.provider} variant="mark" />
                          {t("Suggested by {name}").replace(
                            "{name}",
                            notice.requiredByName ?? providerLabel(notice.target.provider),
                          )}
                        </span>
                      }
                      trailing={
                        <span className="text-muted-foreground">
                          {notice.installed ? t("Installed") : t("Not added")}
                        </span>
                      }
                    />
                  ))}
                </Group>
              )}

              {(plan.incompatible.length > 0 || plan.unresolvedRequired.length > 0) && (
                <Group title={t("Compatibility")}>
                  {plan.incompatible.map((notice) => (
                    <ItemRow
                      key={`${notice.requiredBy.project_id}:${targetLabel(notice)}`}
                      icon={
                        <ShieldAlert
                          className={cn("h-5 w-5 shrink-0", notice.installed ? "text-red-300" : "text-muted-foreground")}
                        />
                      }
                      title={targetLabel(notice)}
                      detail={
                        notice.installed
                          ? t("Installed, and does not work with this mod.")
                          : t("Does not work with this mod. Not installed, so nothing to do.")
                      }
                    />
                  ))}
                  {plan.unresolvedRequired.map((item, index) => (
                    <ItemRow
                      key={`${item.target.projectId ?? item.target.versionId}:${index}`}
                      icon={<XCircle className="h-5 w-5 shrink-0 text-red-300" />}
                      title={<span className="text-red-300">{t("Required file unavailable")}</span>}
                      detail={item.reason}
                    />
                  ))}
                </Group>
              )}

              {!plan.canInstall && (
                <div className="flex gap-3 rounded-xl bg-destructive/[0.12] p-3.5 text-[13px] text-red-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {t("Installation is blocked until required files and incompatibilities are resolved.")}
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-6">
              <div className="flex flex-col items-center gap-3 pt-2 text-center">
                <ResultStatusIcon status={result.after.status} />
                <div>
                  <div className="text-lg font-semibold tracking-tight">{t(resultTitle(result.after.status))}</div>
                  {result.after.failure && (
                    <div className="mt-1 text-[13px] text-muted-foreground">{result.after.failure.message}</div>
                  )}
                  <div className="mt-1 text-[13px] text-muted-foreground">
                    {[
                      [t("Installed"), result.after.installed.length],
                      [t("Reused"), result.after.skipped.length],
                      [t("Rolled back"), result.after.rolledBack.length],
                      [t("Rollback errors"), result.after.rollbackFailures.length],
                    ]
                      .filter(([, value]) => Number(value) > 0)
                      .map(([label, value]) => `${label} ${value}`)
                      .join(" · ")}
                  </div>
                </div>
              </div>

              {result.after.installed.length > 0 && (
                <Group>
                  {result.after.installed.map((item) => (
                    <ItemRow
                      key={item.modId}
                      icon={<CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />}
                      title={item.name}
                      trailing={
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <ProviderBadge provider={item.project.provider} variant="mark" />
                          {providerLabel(item.project.provider)}
                        </span>
                      }
                    />
                  ))}
                </Group>
              )}

              {result.after.rollbackFailures.map((failure, index) => (
                <div
                  key={`${failure.project?.project_id ?? "rollback"}:${index}`}
                  className="rounded-xl bg-destructive/[0.12] p-3.5 text-[13px] text-red-300"
                >
                  {failure.message}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="relative px-6 pb-6 pt-4">
          <Button onClick={() => onOpenChange(false)} disabled={installing}>
            {result ? t("Close") : t("Cancel")}
          </Button>
          {!result && plan && (
            <Button variant="primary" onClick={onConfirm} disabled={!plan.canInstall || installing}>
              {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              {t("Install {files}").replace("{files}", filesLabel(installCount))}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
