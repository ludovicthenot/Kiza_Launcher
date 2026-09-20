import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { Boxes, Check, Download, Globe, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/primitives";
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

  return (
    <Dialog open={open} onOpenChange={(next) => (next || phase === "importing" ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Import from another launcher")}</DialogTitle>
          <DialogDescription>
            {t("Instances found in the CurseForge App, the Modrinth App, Prism, MultiMC and the Minecraft Launcher. Copied as they are — mods, configs, worlds, packs — and nothing is changed there.")}
          </DialogDescription>
        </DialogHeader>

        {phase === "scanning" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Search className="h-4 w-4 animate-pulse" />
            {t("Looking through the other launchers…")}
          </div>
        )}

        {phase !== "scanning" && found && found.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("No other launcher with instances was found on this computer.")}</p>
        )}

        {phase !== "scanning" && found && found.length > 0 && (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto py-1">
            {found.map((item) => {
              const ticked = chosen.has(item.game_dir);
              const imported = outcome.done.includes(item.name);
              const failure = outcome.failed.find((f) => f.name === item.name);
              return (
                <li key={item.game_dir}>
                  <button
                    type="button"
                    disabled={phase !== "ready"}
                    onClick={() => toggle(item.game_dir)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                      ticked ? "border-primary/50 bg-primary/10" : "border-border/60 bg-card/40 hover:border-primary/30",
                      phase !== "ready" && "opacity-80",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        ticked ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                    >
                      {ticked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{item.name}</span>
                        <span className="rounded border border-border/60 bg-secondary/40 px-1.5 text-[10px] text-muted-foreground">
                          {SOURCE_LABEL[item.source]}
                        </span>
                        {imported && <Check className="h-4 w-4 text-emerald-400" />}
                        {current === item.name && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        Minecraft {item.mc_version}
                        {item.loader !== "vanilla" && ` · ${MINECRAFT_LOADER_LABELS[item.loader] ?? item.loader}${item.loader_version ? ` ${item.loader_version}` : ""}`}
                        {" · "}
                        <Boxes className="mb-0.5 inline h-3 w-3" /> {item.mods} {t("mods")}
                        {" · "}
                        <Globe className="mb-0.5 inline h-3 w-3" /> {item.worlds} {t("worlds")}
                        {" · "}
                        {formatBytes(item.bytes)}
                      </span>
                      {failure && <span className="mt-0.5 block text-xs text-destructive">{failure.reason}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {phase === "importing" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate">{t("Copying {name}…").replace("{name}", current ?? "")} {progress.data?.name ? `— ${progress.data.name}` : ""}</span>
              <span className="tabular-nums">{progress.data ? `${progress.data.done} / ${progress.data.total}` : ""}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary/40">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${progress.data?.total ? Math.round((progress.data.done / progress.data.total) * 100) : 5}%` }}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {phase === "ready" && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("Not now")}</Button>
              <Button variant="primary" disabled={chosen.size === 0} onClick={() => void importChosen()}>
                <Download className="h-4 w-4" />
                {chosen.size <= 1
                  ? t("Import")
                  : t("Import {count} instances").replace("{count}", String(chosen.size))}
                {chosen.size > 0 && <span className="text-xs opacity-70">({formatBytes(totalBytes)})</span>}
              </Button>
            </>
          )}
          {phase === "done" && (
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              <Check className="h-4 w-4" />
              {t("Got it")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
