import { useMemo, useState } from "react";
import {
  Boxes,
  Check,
  FolderOpen,
  Globe2,
  Image,
  Loader2,
  Server,
  Settings2,
  Share2,
  Sparkles,
} from "lucide-react";
import {
  ExportReport,
  ExportSelection,
  useExportInstance,
  useExportPlan,
  WorldSummary,
} from "../../lib/queries";
import { useStorageUnits } from "../../lib/useStorageUnits";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

/**
 * Choosing what leaves with an instance.
 *
 * There was no choosing before: export wrote the mods and the config and
 * nothing else — no worlds, no resource packs, no shaderpacks, no options — and
 * never said so. What arrived somewhere else was a pack that looked complete
 * and was not the instance.
 *
 * Nothing starts ticked. An archive is a thing people share, and worlds are the
 * one item in here that is private; the cost of an extra click is smaller than
 * the cost of finding out afterwards that a save travelled with a modpack.
 */

const EMPTY: ExportSelection = {
  mods: false,
  // Off by default, like everything else here. A server pack is a deliberate
  // thing to make, and an export that quietly dropped half somebody's mods
  // because a checkbox remembered its last state would be worse than one that
  // asks every time.
  serverOnly: false,
  config: false,
  resourcepacks: false,
  shaderpacks: false,
  options: false,
  worlds: [],
  // A pack anybody can open is the useful default; the other one is the answer
  // to a specific worry, and the worry comes with knowing you have it.
  format: "curseForge",
};

function Line({
  icon: Icon,
  label,
  detail,
  checked,
  onChange,
  disabled,
}: {
  icon: typeof Boxes;
  label: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 transition",
        disabled
          ? "cursor-not-allowed opacity-45"
          : "cursor-pointer hover:border-primary/35 hover:bg-secondary/25",
        checked && !disabled && "border-primary/45 bg-primary/[0.06]",
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
      />
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}

export function ExportInstanceDialog({
  instanceId,
  open,
  onOpenChange,
}: {
  instanceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const formatBytes = useStorageUnits();
  const { data: plan, isLoading } = useExportPlan(open ? instanceId : null);
  const exportInstance = useExportInstance();

  const [selection, setSelection] = useState<ExportSelection>(EMPTY);
  const [report, setReport] = useState<ExportReport | null>(null);

  const set = (patch: Partial<ExportSelection>) =>
    setSelection((current) => ({ ...current, ...patch }));

  const toggleWorld = (folder: string) =>
    setSelection((current) => ({
      ...current,
      worlds: current.worlds.includes(folder)
        ? current.worlds.filter((name) => name !== folder)
        : [...current.worlds, folder],
    }));

  const chosenWorldBytes = useMemo(() => {
    if (!plan) return 0;
    return plan.worlds
      .filter((world) => selection.worlds.includes(world.folder))
      .reduce((total, world) => total + world.size_bytes, 0);
  }, [plan, selection.worlds]);

  /**
   * What the archive is likely to weigh.
   *
   * Referenced mods are a line each, so they are left out of the estimate
   * entirely — that difference is the whole reason the format works this way,
   * and hiding it would make the two kinds of mod look alike.
   */
  const estimate = useMemo(() => {
    if (!plan) return 0;
    return (
      (selection.mods
        ? selection.format === "selfContained"
          ? plan.mods.everyJarBytes
          : plan.mods.bundledBytes
        : 0) +
      (selection.config ? plan.config.sizeBytes : 0) +
      (selection.resourcepacks ? plan.resourcepacks.sizeBytes : 0) +
      (selection.shaderpacks ? plan.shaderpacks.sizeBytes : 0) +
      (selection.options ? plan.options.sizeBytes : 0) +
      chosenWorldBytes
    );
  }, [plan, selection, chosenWorldBytes]);

  const nothingChosen =
    !selection.mods &&
    !selection.config &&
    !selection.resourcepacks &&
    !selection.shaderpacks &&
    !selection.options &&
    selection.worlds.length === 0;

  const close = (next: boolean) => {
    if (!next) {
      setSelection(EMPTY);
      setReport(null);
    }
    onOpenChange(next);
  };

  const run = () => {
    exportInstance.mutate(
      { instanceId, selection },
      { onSuccess: (result) => setReport(result) },
    );
  };

  const worldDetail = (world: WorldSummary) => {
    const parts = [formatBytes(world.size_bytes)];
    if (world.version_name) parts.push(world.version_name);
    if (world.hardcore) parts.push(t("Hardcore"));
    return parts.join(" • ");
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[86vh] w-[min(620px,calc(100vw-32px))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Export this instance")}</DialogTitle>
          <DialogDescription>
            {t("Choose what travels. Nothing is included until you say so.")}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !plan ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : report ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Check className="h-4 w-4 text-emerald-400" />
              {t("Exported — {size}").replace("{size}", formatBytes(report.sizeBytes))}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("{referenced} mods travel as a reference and {bundled} are carried in the archive. {worlds} worlds are inside it.")
                .replace("{referenced}", String(report.modsReferenced))
                .replace("{bundled}", String(report.modsBundled))
                .replace("{worlds}", String(report.worlds))}
            </p>
            <p className="break-all rounded-lg border border-border/60 bg-secondary/20 p-2 font-mono text-[11px] text-muted-foreground">
              {report.path}
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {/* Asked first, because it changes every size below it. */}
            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("Archive format")}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    {
                      value: "curseForge",
                      title: t("CurseForge pack"),
                      detail: t(
                        "CurseForge mods are listed rather than copied. Any launcher opens it, and it stays small.",
                      ),
                    },
                    {
                      value: "selfContained",
                      title: t("Self-contained"),
                      detail: t(
                        "Every jar is inside. Works with no network and no key, and only Kiza reads it as an instance.",
                      ),
                    },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selection.format === option.value}
                    onClick={() => set({ format: option.value })}
                    className={cn(
                      "rounded-xl border p-3 text-left transition",
                      selection.format === option.value
                        ? "border-primary/55 bg-primary/10"
                        : "border-border/70 bg-secondary/20 hover:border-primary/25",
                    )}
                  >
                    <span className="block text-sm font-semibold">{option.title}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {option.detail}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("The instance")}
              </h3>
              <Line
                icon={Boxes}
                label={t("Mods")}
                detail={
                  plan.mods.count === 0
                    ? t("None installed")
                    : selection.format === "selfContained"
                      ? t("{count} mods, all carried ({size})")
                          .replace("{count}", String(plan.mods.count))
                          .replace("{size}", formatBytes(plan.mods.everyJarBytes))
                      : t("{count} mods — {referenced} by reference, {bundled} carried ({size})")
                          .replace("{count}", String(plan.mods.count))
                          .replace("{referenced}", String(plan.mods.referenced))
                          .replace("{bundled}", String(plan.mods.bundled))
                          .replace("{size}", formatBytes(plan.mods.bundledBytes))
                }
                checked={selection.mods}
                disabled={plan.mods.count === 0}
                onChange={(value) => set({ mods: value, serverOnly: value && selection.serverOnly })}
              />
              {/* Under the mods and only while they are going, because it is a
                  question about them rather than a thing of its own. */}
              {selection.mods && (
                <label
                  className={cn(
                    "ml-9 flex cursor-pointer items-start gap-3 rounded-xl border border-border/50",
                    "bg-secondary/15 px-4 py-3 transition-colors hover:bg-secondary/25",
                  )}
                >
                  <Checkbox
                    checked={selection.serverOnly}
                    onChange={(event) => set({ serverOnly: event.target.checked })}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      {t("Only what a server needs")}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t(
                        "Client-only mods are left out. Anything nothing could classify is kept.",
                      )}
                    </span>
                  </span>
                </label>
              )}
              <Line
                icon={Settings2}
                label={t("Mod configuration")}
                detail={
                  plan.config.present
                    ? `${plan.config.fileCount} ${t("files")} — ${formatBytes(plan.config.sizeBytes)}`
                    : t("Nothing there")
                }
                checked={selection.config}
                disabled={!plan.config.present}
                onChange={(value) => set({ config: value })}
              />
              <Line
                icon={Image}
                label={t("Resource packs")}
                detail={
                  plan.resourcepacks.present
                    ? `${plan.resourcepacks.fileCount} — ${formatBytes(plan.resourcepacks.sizeBytes)}`
                    : t("Nothing there")
                }
                checked={selection.resourcepacks}
                disabled={!plan.resourcepacks.present}
                onChange={(value) => set({ resourcepacks: value })}
              />
              <Line
                icon={Sparkles}
                label={t("Shader packs")}
                detail={
                  plan.shaderpacks.present
                    ? `${plan.shaderpacks.fileCount} — ${formatBytes(plan.shaderpacks.sizeBytes)}`
                    : t("Nothing there")
                }
                checked={selection.shaderpacks}
                disabled={!plan.shaderpacks.present}
                onChange={(value) => set({ shaderpacks: value })}
              />
              <Line
                icon={Settings2}
                label={t("Game options")}
                detail={
                  plan.options.present
                    ? t("Keys, video settings and volumes — {size}").replace(
                        "{size}",
                        formatBytes(plan.options.sizeBytes),
                      )
                    : t("Nothing there")
                }
                checked={selection.options}
                disabled={!plan.options.present}
                onChange={(value) => set({ options: value })}
              />
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("Worlds")}
              </h3>
              {plan.worlds.length === 0 ? (
                <p className="rounded-lg border border-border/60 px-3 py-2.5 text-xs text-muted-foreground">
                  {t("This instance has no world yet.")}
                </p>
              ) : (
                <>
                  {/* Listed one by one on purpose. A single "include worlds"
                      switch is a decision nobody can make without knowing which
                      ones, and how much they weigh. */}
                  {plan.worlds.map((world) => (
                    <Line
                      key={world.folder}
                      icon={Globe2}
                      label={world.display_name || world.folder}
                      detail={worldDetail(world)}
                      checked={selection.worlds.includes(world.folder)}
                      onChange={() => toggleWorld(world.folder)}
                    />
                  ))}
                </>
              )}
            </section>
          </div>
        )}

        {!report && plan && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
            <p className="text-xs text-muted-foreground">
              {nothingChosen
                ? t("Nothing chosen yet.")
                : t("About {size}").replace("{size}", formatBytes(estimate))}
            </p>
            <button
              type="button"
              onClick={run}
              disabled={nothingChosen || exportInstance.isPending}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition",
                nothingChosen || exportInstance.isPending
                  ? "cursor-not-allowed bg-secondary/40 text-muted-foreground"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {exportInstance.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
              {t("Export")}
            </button>
          </div>
        )}

        {report && (
          <div className="flex justify-end border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => close(false)}
              className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-secondary/30 px-4 py-2.5 text-sm transition hover:border-primary/40"
            >
              <FolderOpen className="h-4 w-4" />
              {t("Done")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
