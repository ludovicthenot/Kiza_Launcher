import { useState } from "react";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Download,
  FileLock2,
  FileUp,
  HelpCircle,
  Loader2,
  MinusCircle,
  PlusCircle,
  RefreshCw,
} from "lucide-react";
import {
  LockfileDiffEntry,
  LockfileVerdict,
  useApplyLockfile,
  useDiffLockfile,
  useExportLockfile,
  useReadLockfile,
  useSaveLockfile,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { Button, Panel } from "../ui/primitives";

const VERDICTS: Record<
  LockfileVerdict,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  match: { label: "Identical", icon: CheckCircle2, className: "text-emerald-400" },
  missing: { label: "Missing", icon: PlusCircle, className: "text-amber-400" },
  different: { label: "Different version", icon: RefreshCw, className: "text-amber-400" },
  extra: { label: "Not in the lockfile", icon: MinusCircle, className: "text-muted-foreground" },
};

/**
 * A lockfile: what this instance is, without any of its bytes.
 *
 * An exported instance copies files; a lockfile records identities — which
 * project, which released version, which hash. That is what makes it small
 * enough to share, and what lets a rebuild download from the original platforms
 * instead of from whoever made the archive.
 */
export function LockfilePanel({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const exportLockfile = useExportLockfile();
  const saveLockfile = useSaveLockfile();
  const readLockfile = useReadLockfile();
  const diffLockfile = useDiffLockfile();
  const applyLockfile = useApplyLockfile();

  const [loaded, setLoaded] = useState<{ name: string; raw: string } | null>(null);
  const [report, setReport] = useState<LockfileDiffEntry[] | null>(null);

  const handleExport = async () => {
    const destination = await saveFileDialog({
      title: t("Save the lockfile"),
      defaultPath: "kiza.lock.json",
      filters: [{ name: "Kiza lockfile", extensions: ["json"] }],
    });
    if (!destination) return;
    saveLockfile.mutate({ instanceId, destination });
  };

  const handleLoad = async () => {
    const selected = await openFileDialog({
      title: t("Open a lockfile"),
      multiple: false,
      filters: [{ name: "Kiza lockfile", extensions: ["json"] }],
    });
    if (typeof selected !== "string") return;

    // Read through the backend, which refuses anything that is not a lockfile
    // at the moment it is opened rather than at the moment of a rebuild.
    readLockfile.mutate(selected, {
      onSuccess: (raw) => {
        setLoaded({ name: selected.split(/[\\/]/).pop() ?? selected, raw });
        diffLockfile.mutate({ instanceId, raw }, { onSuccess: setReport });
      },
    });
  };

  const refreshDiff = () => {
    if (!loaded) return;
    diffLockfile.mutate({ instanceId, raw: loaded.raw }, { onSuccess: setReport });
  };

  const drift = (report ?? []).filter(
    (entry) => entry.verdict === "missing" || entry.verdict === "different",
  );
  const cannotFetch = drift.filter((entry) => !entry.source);
  const summary = exportLockfile.data;

  return (
    <Panel className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold">
            <FileLock2 className="h-4 w-4 text-primary" />
            {t("Kiza lockfile")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("One small file that describes this instance exactly: loader, Java, and every mod with its version and hash.")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => exportLockfile.mutate(instanceId)}
          disabled={exportLockfile.isPending}
        >
          {exportLockfile.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("Check what would be exported")}
        </Button>
        <Button onClick={handleExport} disabled={saveLockfile.isPending} variant="primary">
          {saveLockfile.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {t("Export a lockfile")}
        </Button>
        <Button onClick={handleLoad} disabled={readLockfile.isPending || diffLockfile.isPending}>
          {readLockfile.isPending || diffLockfile.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileUp className="h-4 w-4" />
          )}
          {t("Compare with a lockfile")}
        </Button>
      </div>

      {summary && (
        <div className="mt-4 rounded-md border border-border/60 bg-secondary/20 p-3 text-xs">
          <div>
            {summary.fileCount} {t("files would be locked.")}
          </div>
          {summary.unreproducible.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1.5 text-amber-400">
                <HelpCircle className="h-3 w-3" />
                {/* Saying this up front is the difference between a lockfile
                    someone can trust and one that quietly rebuilds something
                    else on their machine. */}
                {t("{count} of them came from nowhere Kiza knows, so nobody else could fetch them:")
                  .replace("{count}", String(summary.unreproducible.length))}
              </div>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
                {summary.unreproducible.slice(0, 8).map((path) => (
                  <li key={path}>{path}</li>
                ))}
                {summary.unreproducible.length > 8 && (
                  <li>
                    +{summary.unreproducible.length - 8} {t("more")}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {loaded && report && (
        <div className="mt-4 border-t border-border/50 pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 text-xs">
              <span className="font-medium">{loaded.name}</span>
              <span className="ml-2 text-muted-foreground">
                {drift.length === 0
                  ? t("This instance already matches it.")
                  : t("{count} differences").replace("{count}", String(drift.length))}
              </span>
            </div>
            {drift.length > 0 && (
              <div className="flex gap-2">
                <Button onClick={refreshDiff} disabled={diffLockfile.isPending}>
                  <RefreshCw className="h-4 w-4" />
                  {t("Re-check")}
                </Button>
                <Button
                  onClick={() =>
                    applyLockfile.mutate(
                      { instanceId, raw: loaded.raw },
                      { onSuccess: refreshDiff },
                    )
                  }
                  disabled={applyLockfile.isPending || drift.length === cannotFetch.length}
                  variant="primary"
                  title={
                    drift.length === cannotFetch.length
                      ? t("None of the differences can be downloaded")
                      : t("Download what is missing or outdated")
                  }
                >
                  {applyLockfile.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {t("Rebuild from it")}
                </Button>
              </div>
            )}
          </div>

          {cannotFetch.length > 0 && (
            <p className="mb-2 text-xs text-amber-400">
              {t("{count} files cannot be downloaded — the lockfile does not say where they came from. Rebuilding will not fully match it.")
                .replace("{count}", String(cannotFetch.length))}
            </p>
          )}

          <div className="max-h-72 space-y-1 overflow-y-auto">
            {report.map((entry) => {
              const verdict = VERDICTS[entry.verdict];
              const Icon = verdict.icon;
              return (
                <div
                  key={`${entry.verdict}:${entry.path}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-xs odd:bg-secondary/15"
                >
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${verdict.className}`} />
                  <span className="min-w-0 flex-1 truncate font-mono">{entry.path}</span>
                  <span className="shrink-0 text-muted-foreground">{t(verdict.label)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {applyLockfile.data && applyLockfile.data.failed.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-destructive">
          {applyLockfile.data.failed.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
