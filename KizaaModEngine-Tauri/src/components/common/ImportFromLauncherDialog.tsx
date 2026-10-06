import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, Check, CheckCircle2, Download, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/primitives";
import { Skeleton } from "../ui/skeleton";
import { queryKeys, useImportProgress } from "../../lib/queries";
import type { GameInstance, MinecraftLoader } from "../../lib/types";
import { MINECRAFT_LOADER_LABELS } from "../../lib/minecraftLoaders";
import { useI18n } from "../../lib/i18n";
import { cn, formatBytes } from "../../lib/utils";

/** An instance another launcher has, as the backend found it. */
export interface FoundInstance {
  source: "curse_forge_app" | "modrinth_app" | "prism" | "multi_mc" | "official_launcher";
  name: string;
  game_dir: string;
  mc_version: string;
  loader: MinecraftLoader;
  loader_version: string | null;
  mods: number;
  worlds: number;
  bytes: number;
  provenance: { file_name: string; provider: string; project_id: string; version_id: string }[];
}

const SOURCE_LABEL: Record<FoundInstance["source"], string> = {
  curse_forge_app: "CurseForge App",
  modrinth_app: "Modrinth App",
  prism: "Prism Launcher",
  multi_mc: "MultiMC",
  official_launcher: "Minecraft Launcher",
};

/**
 * Everything the other launchers on this machine have, ready to copy.
 *
 * <p>A person who tries Kiza already has a Minecraft somewhere, and the
 * fastest way to lose them is to ask for it again. This lists what the
 * CurseForge App, the Modrinth App, Prism, MultiMC and the official
 * launcher keep, with the version, loader, mods and worlds read from
 * their own records, and copies what is ticked. The other launcher is not
 * touched.
 */
export function ImportFromLauncherDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (instance: GameInstance) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [found, setFound] = useState<FoundInstance[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"scanning" | "ready" | "importing" | "done">("scanning");
  const [current, setCurrent] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ done: string[]; failed: { name: string; reason: string }[] }>({ done: [], failed: [] });
  const progress = useImportProgress(phase === "importing");

  useEffect(() => {
    if (!open) return;
    setPhase("scanning");
    setFound(null);
    setChosen(new Set());
    setOutcome({ done: [], failed: [] });
    invoke<FoundInstance[]>("scan_other_launchers")
      .then((list) => {
        setFound(list);
        setPhase("ready");
      })
      .catch(() => {
        setFound([]);
        setPhase("ready");
      });
  }, [open]);

  const toggle = (dir: string) =>
    setChosen((set) => {
      const next = new Set(set);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });

  const importChosen = async () => {
    if (!found) return;
    setPhase("importing");
    const done: string[] = [];
    const failed: { name: string; reason: string }[] = [];
    let last: GameInstance | null = null;
    for (const item of found.filter((f) => chosen.has(f.game_dir))) {
      setCurrent(item.name);
      try {
        last = await invoke<GameInstance>("import_from_other_launcher", { found: item });
        done.push(item.name);
      } catch (error) {
        failed.push({ name: item.name, reason: String(error) });
      }
    }
    setOutcome({ done, failed });
    setPhase("done");
    setCurrent(null);
    void queryClient.invalidateQueries({ queryKey: queryKeys.instances });
    if (last) onImported(last);
  };

  const totalBytes = (found ?? []).filter((f) => chosen.has(f.game_dir)).reduce((sum, f) => sum + f.bytes, 0);
  const sources = Object.keys(SOURCE_LABEL) as FoundInstance["source"][];
  const bySource = sources
    .map((source) => ({ source, items: (found ?? []).filter((item) => item.source === source) }))
    .filter((group) => group.items.length > 0);
  const importTotal = chosen.size;
  const importDone = outcome.done.length + outcome.failed.length;
  const fileFraction = progress.data?.total ? progress.data.done / progress.data.total : 0;
  const overall = importTotal > 0 ? ((importDone + (phase === "importing" ? fileFraction : 0)) / importTotal) * 100 : 0;

  const toggleGroup = (items: FoundInstance[]) =>
    setChosen((set) => {
      const next = new Set(set);
      const all = items.every((item) => next.has(item.game_dir));
      for (const item of items) {
        if (all) next.delete(item.game_dir);
        else next.add(item.game_dir);
      }
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={(next) => (next || phase === "importing" ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-0 px-6 pb-4 pt-6 pr-14">
          <div className="flex items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-primary/20 text-primary">
              <ArrowDownToLine className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-left text-xl font-semibold tracking-tight">{t("Import from another launcher")}</DialogTitle>
              <DialogDescription className="mt-0.5 text-left text-[0.8125rem]">
                {t("Copied as they are: mods, configs, worlds and packs. Nothing changes there.")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[56vh] overflow-y-auto px-6 pb-2 [mask-image:linear-gradient(to_bottom,black_calc(100%-14px),transparent)]">
          {/* Looking: every launcher it checks, each with a sheen passing,
              so the wait shows what it is waiting on. */}
          {phase === "scanning" && (
            <div className="divide-y divide-border/40 rounded-xl bg-secondary/[0.28] px-4">
              {sources.map((source, index) => (
                <div key={source} className="flex min-h-12 items-center gap-3 py-2 animate-in fade-in-0 duration-300 [animation-fill-mode:both]" style={{ animationDelay: `${index * 70}ms` }}>
                  <LauncherMark source={source} />
                  <span className="flex-1 text-[0.8438rem]">{SOURCE_LABEL[source]}</span>
                  <Skeleton className="h-2.5 w-20 rounded-full" />
                </div>
              ))}
            </div>
          )}

          {phase !== "scanning" && found && found.length === 0 && (
            <div className="flex flex-col items-center py-10 text-center animate-in fade-in-0 duration-300">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/70 text-muted-foreground">
                <Search className="h-5 w-5" />
              </span>
              <p className="mt-3 text-[0.8438rem] font-medium">{t("Nothing to import")}</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">{t("No other launcher with instances was found on this computer.")}</p>
            </div>
          )}

          {phase !== "scanning" && bySource.length > 0 && (
            <div className="space-y-5">
              {bySource.map((group, groupIndex) => {
                const allTicked = group.items.every((item) => chosen.has(item.game_dir));
                return (
                  <section
                    key={group.source}
                    className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 [animation-fill-mode:both] motion-reduce:animate-none"
                    style={{ animationDelay: `${groupIndex * 80}ms` }}
                  >
                    <div className="mb-1.5 flex items-center justify-between px-1">
                      <h3 className="flex items-center gap-2 text-[0.8125rem] font-semibold text-foreground/90">
                        {SOURCE_LABEL[group.source]}
                        <span className="font-normal text-muted-foreground">{group.items.length}</span>
                      </h3>
                      {phase === "ready" && group.items.length > 1 && (
                        <button type="button" onClick={() => toggleGroup(group.items)} className="text-xs text-primary hover:underline">
                          {allTicked ? t("Deselect all") : t("Select all")}
                        </button>
                      )}
                    </div>
                    <ul className="divide-y divide-border/40 rounded-xl bg-secondary/[0.28] px-1.5 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
                      {group.items.map((item) => {
                        const ticked = chosen.has(item.game_dir);
                        const imported = outcome.done.includes(item.name);
                        const failure = outcome.failed.find((f) => f.name === item.name);
                        const copying = current === item.name;
                        return (
                          <li key={item.game_dir}>
                            <button
                              type="button"
                              disabled={phase !== "ready"}
                              onClick={() => toggle(item.game_dir)}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-150",
                                phase === "ready" && "hover:bg-white/[0.04]",
                                phase !== "ready" && !ticked && "opacity-45",
                              )}
                            >
                              <RowState ticked={ticked} copying={copying} imported={imported} failed={!!failure} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[0.8438rem] font-medium">{item.name}</span>
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                  {failure
                                    ? <span className="text-red-300">{failure.reason}</span>
                                    : [
                                        item.mc_version,
                                        item.loader !== "vanilla"
                                          ? `${MINECRAFT_LOADER_LABELS[item.loader] ?? item.loader}${item.loader_version ? ` ${item.loader_version}` : ""}`
                                          : "Vanilla",
                                        `${item.mods} ${t("mods")}`,
                                        `${item.worlds} ${t("worlds")}`,
                                      ].join(" · ")}
                                </span>
                              </span>
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatBytes(item.bytes)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {phase === "importing" && (
          <div className="space-y-2 px-6 pt-3" aria-live="polite">
            <div className="flex items-baseline justify-between gap-3 text-[0.7812rem]">
              <span key={current ?? ""} className="min-w-0 truncate animate-in fade-in-0 duration-200">
                {t("Copying {name}…").replace("{name}", current ?? "")}
                {progress.data?.name && <span className="text-muted-foreground"> · {progress.data.name}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {Math.min(importDone + 1, importTotal)} / {importTotal}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={t("Import progress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(overall)}
              className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
            >
              <div
                className="kiza-sheen h-full rounded-full bg-primary transition-[width] duration-700 ease-drawer"
                style={{ width: `${Math.max(3, overall)}%` }}
              />
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="flex items-center gap-2 px-6 pt-3 text-[0.8125rem] animate-in fade-in-0 duration-300">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            {t("{count} imported").replace("{count}", String(outcome.done.length))}
            {outcome.failed.length > 0 && (
              <span className="text-red-300">· {t("{count} failed").replace("{count}", String(outcome.failed.length))}</span>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 px-6 pb-6 pt-4">
          {phase === "ready" && (
            <>
              <Button onClick={() => onOpenChange(false)}>{t("Not now")}</Button>
              <Button variant="primary" disabled={chosen.size === 0} onClick={() => void importChosen()}>
                <Download className="h-4 w-4" />
                {chosen.size <= 1
                  ? t("Import")
                  : t("Import {count} instances").replace("{count}", String(chosen.size))}
                {chosen.size > 0 && <span className="text-xs opacity-75">{formatBytes(totalBytes)}</span>}
              </Button>
            </>
          )}
          {phase === "done" && (
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              {t("Done")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The other launcher's initial on a tile of its own colour. */
function LauncherMark({ source }: { source: FoundInstance["source"] }) {
  const style: Record<FoundInstance["source"], string> = {
    curse_forge_app: "bg-[#f16436]/20 text-[#ff8a5c]",
    modrinth_app: "bg-[#1bd96a]/15 text-[#1bd96a]",
    prism: "bg-sky-500/20 text-sky-300",
    multi_mc: "bg-amber-500/20 text-amber-300",
    official_launcher: "bg-emerald-600/20 text-emerald-300",
  };
  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[0.8125rem] font-bold", style[source])}>
      {SOURCE_LABEL[source].charAt(0)}
    </span>
  );
}

/** A round check, which becomes a turning ring, then a tick, as it is copied. */
function RowState({ ticked, copying, imported, failed }: { ticked: boolean; copying: boolean; imported: boolean; failed: boolean }) {
  if (copying) {
    return <span className="block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />;
  }
  if (imported) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white animate-in zoom-in-50 duration-200">
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  if (failed) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/80 text-white">
        <X className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow] duration-150",
        ticked ? "bg-primary text-primary-foreground" : "shadow-[inset_0_0_0_1.5px_hsl(var(--muted-foreground)/0.5)]",
      )}
    >
      {ticked && <Check className="h-3 w-3 animate-in zoom-in-50 duration-150" strokeWidth={3} />}
    </span>
  );
}
