import { useState } from "react";
import { FolderOpen, HardDrive, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  StorageEntry,
  useOpenKizaFolder,
  useReclaimStorage,
  useStorageUsage,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { ActionButton, Section } from "./controls";

/** Binary units, because that is what Windows shows for the same folders. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

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
 * What Kiza is using on disk, and what is safe to delete.
 *
 * Every figure is measured by walking the folders that exist — see
 * `storage_report.rs`. Worlds, instances and backups are shown but never
 * offered for deletion: they are the only things here that cannot be
 * downloaded again.
 */
export function StorageSettings() {
  const { t } = useI18n();
  const { data: report, isLoading, error, refetch } = useStorageUsage();
  const reclaim = useReclaimStorage();
  const openFolder = useOpenKizaFolder();
  const [selected, setSelected] = useState<string[]>([]);

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

  return (
    <div className="space-y-6">
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

      <Section icon={FolderOpen} title={t("Open a folder")}>
        <div className="flex flex-wrap gap-2 py-3">
          {[
            { id: "root", label: "Kiza folder" },
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
