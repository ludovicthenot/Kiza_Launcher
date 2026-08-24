import { useEffect, useState } from "react";
import { FolderOpen, HardDrive, Loader2, RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AppConfig,
  StorageEntry,
  useAppConfig,
  useOpenKizaFolder,
  usePruneCache,
  useReclaimStorage,
  useSaveAppConfig,
  useStorageUsage,
  useSystemReport,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { useStorageUnits } from "../../lib/useStorageUnits";
import { cn } from "../../lib/utils";
import { LauncherOptionPicker } from "../ui/launcher-option-picker";
import { ActionButton, Row, Section, Toggle } from "./controls";

/** The label and the one-line explanation for each measured folder. */
const DESCRIPTIONS: Record<string, { label: string; hint: string }> = {
  instances: {
    label: "Instances",
    hint: "Your worlds, mods and configuration files.",
  },
  versions: { label: "Game versions", hint: "The Minecraft builds you have played." },
  libraries: { label: "Libraries", hint: "What Minecraft needs to start." },
  assets: { label: "Game assets", hint: "Sounds, languages and textures." },
  java: { label: "Java runtimes", hint: "The Java versions Kiza installed for you." },
  "world-backups": {
    label: "World backups",
    hint: "Snapshots taken by the World Vault.",
  },
  "restore-points": {
    label: "Restore points",
    hint: "Taken before a risky change so it can be undone.",
  },
  cache: { label: "Cache", hint: "Fetched again the next time it is needed." },
  downloads: { label: "Downloads", hint: "Files already installed into instances." },
  logs: { label: "Logs", hint: "Kept for the crash report." },
};

/** How long an untouched cached file is kept. Zero is "for ever". */
const CACHE_DAYS = [7, 14, 30, 90, 0];

/**
 * The drive, with Kiza's share of it marked out.
 *
 * Shown above everything else because it is the figure that decides whether
 * any of the rest matters: 18 GB is nothing on a 2 TB drive and a crisis on one
 * that is nearly full. The storage page used to show only what Kiza occupied,
 * which is half of the sentence someone came here to read.
 */
function DiskBar({
  mount,
  total,
  free,
  kiza,
}: {
  mount: string;
  total: number;
  free: number;
  kiza: number;
}) {
  const { t } = useI18n();
  const formatBytes = useStorageUnits();
  const used = Math.max(total - free, 0);
  const others = Math.max(used - kiza, 0);
  const pct = (value: number) => (total > 0 ? (value / total) * 100 : 0);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-secondary/10 p-4">
      <HardDrive className="h-8 w-8 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium">{mount}</span>
          <span className="text-xs text-muted-foreground">
            {t("{free} free of {total}")
              .replace("{free}", formatBytes(free))
              .replace("{total}", formatBytes(total))}
          </span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-secondary/60">
          <div className="bg-primary" style={{ width: `${pct(kiza)}%` }} />
          <div className="bg-muted-foreground/40" style={{ width: `${pct(others)}%` }} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" />
            {t("Kiza")} {formatBytes(kiza)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
            {t("Everything else")} {formatBytes(others)}
          </span>
        </div>
      </div>
    </div>
  );
}

function StorageRow({
  entry,
  total,
  selected,
  onToggle,
}: {
  entry: StorageEntry;
  total: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const formatBytes = useStorageUnits();
  const description = DESCRIPTIONS[entry.id] ?? { label: entry.id, hint: "" };
  const share = total > 0 ? (entry.bytes / total) * 100 : 0;

  return (
    <div className="flex flex-wrap items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm">{t(description.label)}</span>
          {!entry.reclaimable && (
            // Said plainly rather than left to a missing checkbox: the reason
            // there is nothing to click here is the point.
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("Kept")}
            </span>
          )}
        </div>
        {description.hint && (
          <div className="text-xs text-muted-foreground">{t(description.hint)}</div>
        )}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary/60">
          <div
            className={cn("h-full rounded-full", entry.reclaimable ? "bg-amber-500" : "bg-primary")}
            style={{ width: `${Math.max(share, entry.bytes > 0 ? 1 : 0)}%` }}
          />
        </div>
      </div>

      <div className="w-20 shrink-0 text-right text-sm tabular-nums">
        {formatBytes(entry.bytes)}
      </div>

      <div className="w-6 shrink-0">
        {entry.reclaimable && entry.bytes > 0 && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`${t("Clear")} ${t(description.label)}`}
            className="h-4 w-4 accent-[hsl(var(--primary))]"
          />
        )}
      </div>
    </div>
  );
}

/**
 * What Kiza is using on disk, what the drive has left, and what is safe to go.
 *
 * Every figure is measured by walking the folders that exist — see
 * `storage_report.rs`. Worlds, instances and backups are shown but never
 * offered for deletion: they are the only things here that cannot be
 * downloaded again.
 */
export function StorageSettings() {
  const { t } = useI18n();
  const formatBytes = useStorageUnits();
  const { data: report, isLoading, error, refetch } = useStorageUsage();
  const { data: system } = useSystemReport();
  const { data: config } = useAppConfig();
  const saveConfig = useSaveAppConfig();
  const reclaim = useReclaimStorage();
  const pruneCache = usePruneCache();
  const openFolder = useOpenKizaFolder();
  const [selected, setSelected] = useState<string[]>([]);

  const [draft, setDraft] = useState<AppConfig | null>(null);
  useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  const update = (patch: Partial<AppConfig>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    saveConfig.mutate(next);
  };

  if (!report) {
    if (isLoading) return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
    return (
      <p className="text-sm text-destructive">
        {t("Kiza could not measure its folders.")} {error ? String(error) : null}
      </p>
    );
  }

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const selectedBytes = report.entries
    .filter((entry) => selected.includes(entry.id))
    .reduce((sum, entry) => sum + entry.bytes, 0);

  const clear = () => {
    const freeing = selectedBytes;
    reclaim.mutate(selected, {
      onSuccess: (freed) => {
        setSelected([]);
        // The figure comes back from Rust rather than from what was selected:
        // a file that was locked stays, and saying otherwise would be a lie
        // the user could check.
        toast.success(`${formatBytes(freed)} ${t("freed")}`);
        if (freed < freeing) {
          toast.info(t("Some files were in use and stayed where they are."));
        }
      },
    });
  };

  const cacheLabel = (days: number) =>
    days === 0 ? t("Keep it all") : t("{days} days").replace("{days}", String(days));

  return (
    <div className="space-y-6">
      {system?.disk && (
        <DiskBar
          mount={system.disk.mount}
          total={system.disk.total_bytes}
          free={system.disk.free_bytes}
          kiza={report.total_bytes}
        />
      )}

      <Section
        icon={HardDrive}
        title={t("What Kiza is using")}
        hint={t("Measured now, by walking the folders. Nothing here is an estimate.")}
      >
        {report.entries.map((entry) => (
          <StorageRow
            key={entry.id}
            entry={entry}
            total={report.total_bytes}
            selected={selected.includes(entry.id)}
            onToggle={() => toggle(entry.id)}
          />
        ))}
        <div className="flex flex-wrap items-center justify-between gap-4 py-3 text-sm font-semibold">
          <span>{t("Total")}</span>
          <span className="tabular-nums">{formatBytes(report.total_bytes)}</span>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          onClick={clear}
          busy={reclaim.isPending}
          disabled={selected.length === 0}
          icon={Trash2}
          tone="destructive"
        >
          {selected.length === 0
            ? t("Nothing selected")
            : `${t("Free")} ${formatBytes(selectedBytes)}`}
        </ActionButton>
        <ActionButton onClick={() => refetch()} icon={HardDrive}>
          {t("Measure again")}
        </ActionButton>
        <p className="text-xs text-muted-foreground">
          {t("Instances, worlds and backups are never offered: they cannot be downloaded again.")}
        </p>
      </div>

      {draft && (
        <Section
          icon={RefreshCcw}
          title={t("Automatic cleanup")}
          hint={t("Runs when Kiza starts. It only ever touches the cache and finished downloads — never a world, an instance or a backup.")}
        >
          <Row
            label={t("Keep cached files for")}
            hint={t("A cached file that has not been touched in this long is deleted, and fetched again if it is wanted.")}
          >
            <div className="w-56">
              <LauncherOptionPicker
                ariaLabel={t("Keep cached files for")}
                options={CACHE_DAYS.map((days) => ({
                  value: String(days),
                  label: cacheLabel(days),
                }))}
                value={String(draft.cache_retention_days)}
                onValueChange={(value) => {
                  const days = Number(value);
                  update({ cache_retention_days: days });
                  pruneCache.mutate(days, {
                    onSuccess: (freed) => {
                      if (freed > 0) {
                        toast.success(`${formatBytes(freed)} ${t("freed")}`);
                      }
                    },
                  });
                }}
                placeholder={t("30 days")}
              />
            </div>
          </Row>
          <Row
            label={t("Delete a download once it is installed")}
            hint={t("The file is already inside the instance by then; the copy in Downloads is a second one.")}
          >
            <Toggle
              label={t("Delete a download once it is installed")}
              checked={draft.clear_finished_downloads}
              onChange={(value) => update({ clear_finished_downloads: value })}
            />
          </Row>
        </Section>
      )}

      <Section icon={FolderOpen} title={t("Where things are")}>
        <Row
          label={t("Kiza folder")}
          hint={t("Everything below lives inside it. Moving it is not offered: the paths are written into instances, and a half-moved install is worse than a full one.")}
        >
          <ActionButton onClick={() => openFolder.mutate("root")} icon={FolderOpen}>
            {t("Open")}
          </ActionButton>
        </Row>
        <div className="flex flex-wrap gap-2 py-3">
          {[
            { id: "instances", label: "Instances" },
            { id: "world-backups", label: "World backups" },
            { id: "logs", label: "Logs" },
            { id: "downloads", label: "Downloads" },
          ].map((folder) => (
            <ActionButton
              key={folder.id}
              onClick={() => openFolder.mutate(folder.id)}
              icon={FolderOpen}
            >
              {t(folder.label)}
            </ActionButton>
          ))}
        </div>
      </Section>
    </div>
  );
}
