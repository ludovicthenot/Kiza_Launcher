import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Check, Download, ExternalLink, FolderOpen, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/primitives";
import { queryKeys, useImportProgress, type BlockedPackFile, type HandAddedFile } from "../../lib/queries";
import { useMissingMods } from "../../lib/missingMods";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { ProgressStrip } from "../ui/progress";

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
  // Mods the person added by hand, by name; they leave the "by hand" count.
  const [byHandDone, setByHandDone] = useState<Set<string>>(new Set());
  const progress = useImportProgress(phase === "installing");

  const fetchable = mods.filter((mod) => mod.modrinth_project_id);
  const byHand = mods.filter((mod) => !mod.modrinth_project_id && !byHandDone.has(mod.name));
  const open = instanceId !== null && mods.length > 0;

  const close = () => {
    dismiss();
    setPhase("ready");
    setReport(null);
    setByHandDone(new Set());
  };

  const addedByHand = (name: string) => {
    setByHandDone((current) => new Set(current).add(name));
    void queryClient.invalidateQueries({ queryKey: queryKeys.instances });
    if (instanceId) void queryClient.invalidateQueries({ queryKey: queryKeys.mods(instanceId) });
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
          // The pack's own build when Modrinth has it, the nearest otherwise;
          // never simply the newest, which is what crashed RLCraft.
          modrinth_version_id: mod.modrinth_build?.version_id ?? null,
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
          <ProgressStrip label={progress.data?.name ?? t("Starting…")} done={done} total={total} />
        )}

        <ul className="max-h-64 space-y-1.5 overflow-y-auto py-1">
          {mods.map((mod) => (
            <Row
              key={mod.project_id}
              mod={mod}
              phase={phase}
              report={report}
              instanceId={instanceId}
              addedByHand={byHandDone.has(mod.name)}
              onAddedByHand={() => addedByHand(mod.name)}
            />
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
              ? t("One mod is not on Modrinth: download it from its page, then use I have the file.")
              : t("{count} mods are not on Modrinth: download each from its page, then use I have the file.").replace(
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
  instanceId,
  addedByHand,
  onAddedByHand,
}: {
  mod: BlockedPackFile;
  phase: "ready" | "installing" | "done";
  report: Report | null;
  instanceId: string | null;
  addedByHand: boolean;
  onAddedByHand: () => void;
}) {
  const { t } = useI18n();
  const fetchable = Boolean(mod.modrinth_project_id);
  const installed = (report?.installed.includes(mod.name) ?? false) || addedByHand;
  const failure = report?.failed.find((entry) => entry.name === mod.name) ?? null;
  // The file the person picked, while the launcher checks it and, when it
  // is not the pack's own, while they decide.
  const [picked, setPicked] = useState<{ path: string; result: HandAddedFile | null; busy: boolean; error: string | null }>({
    path: "",
    result: null,
    busy: false,
    error: null,
  });

  const addFile = async (path: string, acceptMismatch: boolean) => {
    if (!instanceId) return;
    setPicked({ path, result: null, busy: true, error: null });
    try {
      const result = await invoke<HandAddedFile>("add_missing_mod_file", {
        instanceId,
        blocked: mod,
        path,
        acceptMismatch,
      });
      setPicked({ path, result, busy: false, error: null });
      if (result.status === "installed") onAddedByHand();
    } catch (error) {
      setPicked({ path, result: null, busy: false, error: String(error) });
    }
  };

  const pickFile = async () => {
    const chosen = await open({
      multiple: false,
      filters: [{ name: t("Mod file"), extensions: ["jar", "zip"] }],
      title: mod.file_name ? t("Select {file}").replace("{file}", mod.file_name) : t("Select the mod file"),
    });
    if (typeof chosen === "string") await addFile(chosen, false);
  };

  const mismatch = picked.result?.status === "mismatch" ? picked.result : null;
  const build = mod.modrinth_build ?? null;
  // Which release is coming: the pack's own, or the closest Modrinth has.
  const buildNote =
    fetchable && build
      ? build.exact
        ? build.version_number
        : t("{version} — closest to the pack's build").replace("{version}", build.version_number)
      : null;

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        {phase === "done" && installed && <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
        {phase === "done" && failure && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        )}
        <span className="min-w-0">
          <span className="block truncate font-medium">{mod.name}</span>
          {buildNote && phase !== "done" && (
            <span
              className={cn(
                "block truncate text-xs",
                build?.exact ? "text-muted-foreground" : "text-amber-300/90",
              )}
              title={mod.file_name ? t("The pack asks for {file}").replace("{file}", mod.file_name) : undefined}
            >
              {buildNote}
            </span>
          )}
          {failure && (
            <span className="block truncate text-xs text-muted-foreground">{failure.reason}</span>
          )}
          {!fetchable && !addedByHand && mod.file_name && !mismatch && !picked.error && (
            <span className="block truncate text-xs text-muted-foreground" title={mod.file_name}>
              {t("The pack asks for {file}").replace("{file}", mod.file_name)}
            </span>
          )}
          {mismatch && (
            <span className="block text-xs text-amber-300/90">
              {t("{file} is not the file the pack asks for ({expected}).")
                .replace("{file}", mismatch.file_name)
                .replace("{expected}", mismatch.expected_file_name)}{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-amber-200"
                onClick={() => void addFile(picked.path, true)}
              >
                {t("Use it anyway")}
              </button>
            </span>
          )}
          {picked.error && <span className="block truncate text-xs text-destructive">{picked.error}</span>}
          {addedByHand && picked.result?.status === "installed" && !picked.result.exact && (
            <span className="block truncate text-xs text-muted-foreground">{t("Added, not the pack's own build.")}</span>
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
        {!fetchable && addedByHand && phase !== "done" && (
          <Check className="h-4 w-4 shrink-0 text-emerald-400" />
        )}
        {!fetchable && !addedByHand && mod.page_url && (
          <button
            type="button"
            onClick={() => void openUrl(mod.page_url as string)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs transition hover:bg-secondary/40"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("Open the page")}
          </button>
        )}
        {!fetchable && !addedByHand && instanceId && (
          <button
            type="button"
            disabled={picked.busy || phase === "installing"}
            onClick={() => void pickFile()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary transition hover:bg-primary/20 disabled:opacity-60"
          >
            {picked.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
            {t("I have the file")}
          </button>
        )}
      </span>
    </li>
  );
}
