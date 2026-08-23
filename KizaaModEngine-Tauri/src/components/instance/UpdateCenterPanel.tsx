import { useState } from "react";
import {
  ArrowUpCircle,
  FileText,
  Fingerprint,
  History,
  Loader2,
  Pin,
  PinOff,
  RefreshCw,
} from "lucide-react";
import {
  AvailableVersion,
  UpdateCandidate,
  useApplyInstanceUpdates,
  useBackfillContentOrigins,
  useContentVersions,
  useInstanceUpdates,
  useSetContentPinned,
  useSetContentVersion,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { Button, Panel } from "../ui/primitives";
import { Checkbox } from "../ui/checkbox";
import { cn } from "../../lib/utils";

/**
 * Lists what can be updated and applies the selection.
 *
 * A file whose origin was never recorded is absent from this list entirely:
 * without knowing which project a jar belongs to, an update would be a guess.
 */
export function UpdateCenterPanel({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const check = useInstanceUpdates(instanceId);
  const apply = useApplyInstanceUpdates();
  const setPinned = useSetContentPinned();
  const backfill = useBackfillContentOrigins();
  const listVersions = useContentVersions();
  const setVersion = useSetContentVersion();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openChangelog, setOpenChangelog] = useState<string | null>(null);
  const [versionsFor, setVersionsFor] = useState<string | null>(null);
  const [versions, setVersions] = useState<AvailableVersion[]>([]);

  const candidates = check.data ?? [];
  const available = candidates.filter((candidate) => candidate.status === "available");
  const blocked = candidates.filter(
    (candidate) => candidate.status === "no_compatible_release",
  );
  const pinned = candidates.filter((candidate) => candidate.status === "pinned");
  const upToDate = candidates.filter((candidate) => candidate.status === "up_to_date");

  /**
   * Opens the version list for one file.
   *
   * This is the only route to an *older* release: the check above never
   * proposes one, on purpose. A mod that broke in its latest version otherwise
   * leaves the player with nothing to do but uninstall it by hand.
   */
  const openVersions = (path: string) => {
    if (versionsFor === path) {
      setVersionsFor(null);
      return;
    }
    setVersionsFor(path);
    setVersions([]);
    listVersions.mutate({ instanceId, relativePath: path }, { onSuccess: setVersions });
  };

  const versionPicker = (path: string, currentVersionId: string) =>
    versionsFor === path ? (
      <div className="mt-1 space-y-1 rounded-md border border-border/70 bg-background/60 p-2">
        {listVersions.isPending && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        {!listVersions.isPending && versions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("No release of this project runs on this instance.")}
          </p>
        )}
        {versions.map((version) => {
          const isCurrent = version.version_id === currentVersionId;
          return (
            <button
              key={version.version_id}
              type="button"
              disabled={isCurrent || setVersion.isPending}
              onClick={() =>
                setVersion.mutate(
                  { instanceId, relativePath: path, versionId: version.version_id },
                  {
                    onSuccess: () => {
                      setVersionsFor(null);
                      runCheck();
                    },
                  },
                )
              }
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition",
                isCurrent
                  ? "cursor-default text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{version.version_name}</span>
              <span className="shrink-0 opacity-60">{version.released_at.slice(0, 10)}</span>
              {isCurrent && <span className="shrink-0">{t("installed")}</span>}
            </button>
          );
        })}
      </div>
    ) : null;

  const toggle = (path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const runCheck = () => {
    setSelected(new Set());
    check.mutate();
  };

  const statusLabel = (candidate: UpdateCandidate) => {
    switch (candidate.status) {
      case "available":
        return t("New version available");
      case "pinned":
        return t("Pinned");
      case "no_compatible_release":
        return t("No compatible release");
      case "up_to_date":
        return t("Up to date");
    }
  };

  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("Updates")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Only content installed from Modrinth or CurseForge can be tracked.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => backfill.mutate(instanceId, { onSuccess: () => runCheck() })}
            disabled={backfill.isPending}
            title={t("Identify files installed before Kiza tracked their origin")}
          >
            {backfill.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Fingerprint className="h-4 w-4" />}
            {t("Identify content")}
          </Button>
          <Button onClick={runCheck} disabled={check.isPending}>
            {check.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />}
            {t("Check for updates")}
          </Button>
          <Button
            onClick={() =>
              apply.mutate(
                { instanceId, paths: Array.from(selected) },
                { onSuccess: () => runCheck() },
              )
            }
            disabled={selected.size === 0 || apply.isPending}
            variant="primary"
          >
            {apply.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <ArrowUpCircle className="h-4 w-4" />}
            {t("Update selected")} ({selected.size})
          </Button>
        </div>
      </div>

      {check.isSuccess && candidates.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("Nothing here was installed from a platform Kiza can track.")}
        </p>
      )}

      {available.length > 0 && (
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() =>
              setSelected(
                selected.size === available.length
                  ? new Set()
                  : new Set(available.map((candidate) => candidate.path)),
              )
            }
            className="text-xs font-medium text-primary hover:underline"
          >
            {selected.size === available.length ? t("Clear selection") : t("Select all")}
          </button>

          {available.map((candidate) => (
            <label
              key={candidate.path}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md border p-3 transition",
                selected.has(candidate.path)
                  ? "border-primary bg-primary/10"
                  : "border-border/70 bg-secondary/15 hover:border-primary/40",
              )}
            >
              <Checkbox
                checked={selected.has(candidate.path)}
                onChange={() => toggle(candidate.path)}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{candidate.path}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {candidate.provider} · {t("to")} {candidate.target?.version_name}
                </div>
              </div>
              {candidate.target?.changelog && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    setOpenChangelog(
                      openChangelog === candidate.path ? null : candidate.path,
                    );
                  }}
                  title={t("Show changelog")}
                  className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <FileText className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  openVersions(candidate.path);
                }}
                title={t("Choose a version")}
                className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <History className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  setPinned.mutate(
                    { instanceId, relativePath: candidate.path, pinned: true },
                    { onSuccess: () => runCheck() },
                  );
                }}
                title={t("Pin to the current version")}
                className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <Pin className="h-4 w-4" />
              </button>
            </label>
          ))}

          {available
            .filter((candidate) => candidate.path === versionsFor)
            .map((candidate) => (
              <div key={candidate.path}>
                {versionPicker(candidate.path, candidate.current_version_id)}
              </div>
            ))}

          {openChangelog && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-background/80 p-3 text-[11px] leading-relaxed text-muted-foreground">
              {/* Platforms return HTML or Markdown; shown as-is rather than
                  half-rendered, which would misrepresent the author's text. */}
              {available.find((candidate) => candidate.path === openChangelog)?.target
                ?.changelog}
            </pre>
          )}
        </div>
      )}

      {(pinned.length > 0 || blocked.length > 0 || upToDate.length > 0) && (
        <div className="mt-4 space-y-1.5 border-t border-border/50 pt-3">
          {[...pinned, ...blocked, ...upToDate].map((candidate) => (
            <div key={candidate.path}>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{candidate.path}</span>
              <span className="shrink-0">{statusLabel(candidate)}</span>
              {/* Every tracked file can be moved to another release, including
                  one that is already on the newest. */}
              <button
                type="button"
                onClick={() => openVersions(candidate.path)}
                title={t("Choose a version")}
                className="shrink-0 rounded-md p-1 transition hover:bg-secondary hover:text-foreground"
              >
                <History className="h-3.5 w-3.5" />
              </button>
              {candidate.status === "pinned" && (
                <button
                  type="button"
                  onClick={() =>
                    setPinned.mutate(
                      { instanceId, relativePath: candidate.path, pinned: false },
                      { onSuccess: () => runCheck() },
                    )
                  }
                  title={t("Unpin")}
                  className="shrink-0 rounded-md p-1 transition hover:bg-secondary hover:text-foreground"
                >
                  <PinOff className="h-3.5 w-3.5" />
                </button>
              )}
              </div>
              {versionPicker(candidate.path, candidate.current_version_id)}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
