import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Loader2,
  PackageCheck,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type {
  DependencyInstallResult,
  DependencyNotice,
  DependencyResolution,
  InstallationStatus,
} from "../../../lib/queries";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Badge, Button } from "../../ui/primitives";

interface DependencyInstallDialogProps {
  open: boolean;
  plan: DependencyResolution | null;
  result: DependencyInstallResult | null;
  installing: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

function targetLabel(notice: DependencyNotice): string {
  return notice.target.projectId ?? notice.target.versionId ?? String(notice.target.fileId ?? "Unknown");
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
  if (status === "installed" || status === "no_changes") {
    return <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />;
  }
  if (status === "rolled_back") {
    return <RotateCcw className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />;
  }
  return <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />;
}

export function DependencyInstallDialog({
  open,
  plan,
  result,
  installing,
  onOpenChange,
  onConfirm,
}: DependencyInstallDialogProps) {
  const pendingRequired = plan?.required.filter((item) => !item.alreadyInstalled) ?? [];
  const installedRequired = plan?.required.filter((item) => item.alreadyInstalled) ?? [];
  const installCount = plan?.installOrder.length ?? 0;
  const rootName = plan?.root?.artifact.name ?? "Mod installation";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !installing && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[82vh] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 pb-4 pt-6 pr-12">
          <DialogTitle className="text-balance">{result ? "Installation result" : rootName}</DialogTitle>
          <DialogDescription className="text-pretty">
            {plan
              ? `Minecraft ${plan.context.minecraftVersion} / ${plan.context.loader}`
              : "Checking compatible files and dependencies"}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-6 py-5">
          {!plan && (
            <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Resolving dependencies
            </div>
          )}

          {plan && !result && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="text-foreground">
                  <PackageCheck className="h-3.5 w-3.5" /> {installCount} file{installCount === 1 ? "" : "s"} to install
                </Badge>
                {installedRequired.length > 0 && (
                  <Badge>{installedRequired.length} already present</Badge>
                )}
                {plan.cycles.length > 0 && (
                  <Badge><GitBranch className="h-3.5 w-3.5" /> {plan.cycles.length} cycle handled</Badge>
                )}
              </div>

              <section aria-labelledby="required-dependencies">
                <h3 id="required-dependencies" className="text-sm font-semibold">Required</h3>
                <div className="mt-2 divide-y divide-border/60 border-y border-border/60">
                  {pendingRequired.length === 0 && installedRequired.length === 0 ? (
                    <div className="py-3 text-sm text-muted-foreground">No required dependencies.</div>
                  ) : (
                    [...pendingRequired, ...installedRequired].map((item) => (
                      <div key={`${item.artifact.project.provider}:${item.artifact.project.project_id}`} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{item.artifact.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{item.artifact.version}</div>
                        </div>
                        <Badge className={item.alreadyInstalled ? "text-emerald-400" : "text-foreground"}>
                          {item.alreadyInstalled ? "Installed" : "Required"}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {plan.optional.length > 0 && (
                <section aria-labelledby="optional-dependencies">
                  <h3 id="optional-dependencies" className="text-sm font-semibold">Optional</h3>
                  <div className="mt-2 divide-y divide-border/60 border-y border-border/60">
                    {plan.optional.map((notice) => (
                      <div key={`${notice.requiredBy.project_id}:${targetLabel(notice)}`} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm">{targetLabel(notice)}</div>
                          <div className="truncate text-xs text-muted-foreground">Requested by {notice.requiredBy.project_id}</div>
                        </div>
                        <Badge>{notice.installed ? "Already installed" : "Not selected"}</Badge>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {(plan.incompatible.length > 0 || plan.unresolvedRequired.length > 0) && (
                <section aria-labelledby="dependency-warnings">
                  <h3 id="dependency-warnings" className="text-sm font-semibold">Compatibility</h3>
                  <div className="mt-2 space-y-2">
                    {plan.incompatible.map((notice) => (
                      <div key={`${notice.requiredBy.project_id}:${targetLabel(notice)}`} className="flex gap-3 rounded-md bg-secondary/30 p-3 text-sm">
                        <ShieldAlert className={notice.installed ? "mt-0.5 h-4 w-4 shrink-0 text-destructive" : "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"} />
                        <div>
                          <div className="font-medium">{targetLabel(notice)}</div>
                          <div className="text-xs text-muted-foreground">
                            {notice.installed ? "Installed and marked incompatible." : "Marked incompatible, but not installed."}
                          </div>
                        </div>
                      </div>
                    ))}
                    {plan.unresolvedRequired.map((item, index) => (
                      <div key={`${item.target.projectId ?? item.target.versionId}:${index}`} className="flex gap-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <div className="font-medium">Required file unavailable</div>
                          <div className="text-xs opacity-80">{item.reason}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {!plan.canInstall && (
                <div className="flex gap-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Installation is blocked until required files and incompatibilities are resolved.
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <ResultStatusIcon status={result.after.status} />
                <div>
                  <div className="font-semibold">{resultTitle(result.after.status)}</div>
                  {result.after.failure && (
                    <div className="mt-1 text-sm text-muted-foreground">{result.after.failure.message}</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border sm:grid-cols-4">
                {[
                  ["Installed", result.after.installed.length],
                  ["Reused", result.after.skipped.length],
                  ["Rolled back", result.after.rolledBack.length],
                  ["Rollback errors", result.after.rollbackFailures.length],
                ].map(([label, value]) => (
                  <div key={label} className="bg-popover px-3 py-3">
                    <div className="text-xl font-semibold tabular-nums">{value}</div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              {result.after.installed.length > 0 && (
                <div className="divide-y divide-border/60 border-y border-border/60">
                  {result.after.installed.map((item) => (
                    <div key={item.modId} className="flex items-center justify-between gap-3 py-3">
                      <span className="truncate text-sm font-medium">{item.name}</span>
                      <Badge>{item.project.provider}</Badge>
                    </div>
                  ))}
                </div>
              )}

              {result.after.rollbackFailures.map((failure, index) => (
                <div key={`${failure.project?.project_id ?? "rollback"}:${index}`} className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {failure.message}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border/70 px-6 py-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={installing}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && plan && (
            <Button variant="primary" onClick={onConfirm} disabled={!plan.canInstall || installing}>
              {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              Install {installCount} file{installCount === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
