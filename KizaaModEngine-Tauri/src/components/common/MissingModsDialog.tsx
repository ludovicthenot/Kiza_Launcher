import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, ExternalLink, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/primitives";
import { queryKeys, useImportProgress, type BlockedPackFile } from "../../lib/queries";
import { useMissingMods } from "../../lib/missingMods";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

/** What the launcher said once it had tried. */
interface Report {
  installed: string[];
  failed: { name: string; reason: string }[];
}

/**
 * The mods a pack could not bring, and one button to go and get them.
 *
 * <p>There was a list before this, with a button beside each entry. Five
 * missing mods was five clicks and five separate waits, and the person doing
 * the clicking was doing what a loop does. So the list is the same, and the
 * button is one: it asks the launcher to fetch everything it can, shows which
 * one it is on and how many are done, and says at the end what it got and
 * what it could not.
 *
 * <p>Two kinds of entry, told apart on sight. A mod the launcher can fetch
 * -- one the same author also publishes on Modrinth, where downloads are
 * allowed -- is counted into the button. One nobody can fetch for the person
 * stays in the list with its page, because the honest thing to do with a mod
 * that has to be downloaded by hand is say so, not hide it behind a button
 * that would do nothing.
 */
export function MissingModsDialog() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { instanceId, mods, dismiss } = useMissingMods();
  const [phase, setPhase] = useState<"ready" | "installing" | "done">("ready");
  const [report, setReport] = useState<Report | null>(null);
  const progress = useImportProgress(phase === "installing");

  const fetchable = mods.filter((mod) => mod.modrinth_project_id);
  const byHand = mods.filter((mod) => !mod.modrinth_project_id);
  const open = instanceId !== null && mods.length > 0;

  const close = () => {
    dismiss();
    setPhase("ready");
    setReport(null);
  };

  const installAll = async () => {
    if (!instanceId || fetchable.length === 0) return;
    setPhase("installing");
    try {
      const result = await invoke<Report>("install_missing_mods", {
        instanceId,
        mods: fetchable.map((mod) => ({
          name: mod.name,
          modrinth_project_id: mod.modrinth_project_id,
        })),
      });
      setReport(result);
    } catch (error) {
      setReport({ installed: [], failed: [{ name: t("Everything"), reason: String(error) }] });
    } finally {
      setPhase("done");
      void queryClient.invalidateQueries({ queryKey: queryKeys.instances });
      void queryClient.invalidateQueries({ queryKey: ["minecraftContent", instanceId] });
    }
  };

  const done = progress.data?.done ?? 0;
  const total = progress.data?.total ?? fetchable.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : phase !== "installing" && close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {phase === "done"
              ? t("Done")
              : t("{count} mods could not be downloaded").replace("{count}", String(mods.length))}
          </DialogTitle>
          <DialogDescription>
            {phase === "done"
              ? summary(report, t)
              : fetchable.length > 0
                ? t(
                    "The instance is ready without them. These authors do not let launchers download from CurseForge, but the same mods are on Modrinth, where they can be fetched in one go.",
                  )
                : t(
                    "The instance is ready without them. These authors do not let launchers download their mods, and none of them is published elsewhere: open each page, download the file, and add it with Add a mod.",
                  )}
          </DialogDescription>
        </DialogHeader>

        {phase === "installing" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                <span className="truncate text-muted-foreground">
                  {progress.data?.name ?? t("Starting…")}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {done} / {total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary/40">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        <ul className="max-h-64 space-y-1.5 overflow-y-auto py-1">
          {mods.map((mod) => (
            <Row key={mod.project_id} mod={mod} phase={phase} report={report} />
          ))}
        </ul>

        <DialogFooter className="gap-2">
          {phase === "ready" && (
            <>
              <Button variant="ghost" onClick={close}>
                {t("Not now")}
              </Button>
              {fetchable.length > 0 && (
                <Button variant="primary" onClick={() => void installAll()}>
                  <Download className="h-4 w-4" />
                  {fetchable.length === 1
                    ? t("Install it")
                    : t("Install {count} mods").replace("{count}", String(fetchable.length))}
                </Button>
              )}
            </>
          )}
          {phase === "done" && (
            <Button variant="primary" onClick={close}>
              <Check className="h-4 w-4" />
              {t("Got it")}
            </Button>
          )}
        </DialogFooter>

        {byHand.length > 0 && phase !== "installing" && (
          <p className="text-xs text-muted-foreground">
            {byHand.length === 1
              ? t("One mod is not on Modrinth and has to be downloaded by hand.")
              : t("{count} mods are not on Modrinth and have to be downloaded by hand.").replace(
                  "{count}",
                  String(byHand.length),
                )}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function summary(report: Report | null, t: (key: string) => string): string {
  if (!report) return "";
  const got = report.installed.length;
  const lost = report.failed.length;
  if (lost === 0) {
    return got === 1
      ? t("The mod is installed.")
      : t("{count} mods are installed.").replace("{count}", String(got));
  }
  return t("{got} installed, {lost} could not be fetched.")
    .replace("{got}", String(got))
    .replace("{lost}", String(lost));
}

/**
 * One mod, and what became of it.
 *
 * The state is read off the report rather than kept per row: the launcher is
 * the one that knows, and asking it once is asking it truthfully.
 */
function Row({
  mod,
  phase,
  report,
}: {
  mod: BlockedPackFile;
  phase: "ready" | "installing" | "done";
  report: Report | null;
}) {
  const { t } = useI18n();
  const fetchable = Boolean(mod.modrinth_project_id);
  const installed = report?.installed.includes(mod.name) ?? false;
  const failure = report?.failed.find((entry) => entry.name === mod.name) ?? null;

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        {phase === "done" && installed && <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
        {phase === "done" && failure && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        )}
        <span className="min-w-0">
          <span className="block truncate font-medium">{mod.name}</span>
          {failure && (
            <span className="block truncate text-xs text-muted-foreground">{failure.reason}</span>
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {fetchable && phase !== "done" && (
          <span
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px] font-medium",
              "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
            )}
          >
            Modrinth
          </span>
        )}
        {!fetchable && mod.page_url && (
          <button
            type="button"
            onClick={() => void openUrl(mod.page_url as string)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs transition hover:bg-secondary/40"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("Open the page")}
          </button>
        )}
      </span>
    </li>
  );
}
