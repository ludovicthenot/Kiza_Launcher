import { useEffect, useState } from "react";
import { Activity, CloudDownload, FolderOpen, Gauge, Gamepad2, RotateCcw } from "lucide-react";
import {
  AppConfig,
  useAppConfig,
  useDownloadConcurrencyRange,
  useDownloads,
  useOpenKizaFolder,
  useSaveAppConfig,
} from "../../lib/queries";
import { useStorageUnits } from "../../lib/useStorageUnits";
import { useI18n } from "../../lib/i18n";
import { ActionButton, ConfigGate, Row, Section, Toggle } from "./controls";

/**
 * How Kiza fetches things.
 *
 * The one number here is real: it is applied to the live queue the moment it
 * changes, and again at every launch — see `download_manager::set_concurrency`.
 * Raising it takes effect at once; lowering it frees the slots nobody is using
 * and takes the rest back as the downloads already running finish, which is
 * said on the page rather than left to be discovered.
 */
export function DownloadSettings() {
  const { t } = useI18n();
  const { data: config, isLoading, error } = useAppConfig();
  const { data: range } = useDownloadConcurrencyRange();
  const saveConfig = useSaveAppConfig();
  const openFolder = useOpenKizaFolder();
  const { data: jobs } = useDownloads();
  const formatBytes = useStorageUnits();

  const [draft, setDraft] = useState<AppConfig | null>(null);
  useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  const [minimum, maximum] = range ?? [1, 8];

  const update = (patch: Partial<AppConfig>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    saveConfig.mutate(next);
  };

  return (
    <ConfigGate
      ready={!!draft}
      loading={isLoading}
      error={error}
      message={t("Kiza could not read its settings file.")}
    >
      {draft && (
        <div className="space-y-6">
          <Section icon={Gauge} title={t("Speed")}>
            <div className="py-3">
              <Row
                label={t("Files downloaded at the same time")}
                hint={t("More is not always faster: past a point the same connection is only cut into more, slower streams.")}
              >
                <span className="w-8 text-right text-lg font-semibold tabular-nums">
                  {draft.download_concurrency}
                </span>
              </Row>
              <input
                type="range"
                min={minimum}
                max={maximum}
                step={1}
                value={draft.download_concurrency}
                aria-label={t("Files downloaded at the same time")}
                onChange={(event) =>
                  update({ download_concurrency: Number(event.target.value) })
                }
                className="mt-1 w-full accent-[hsl(var(--primary))]"
              />
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{minimum}</span>
                <span>{t("Recommended: 3")}</span>
                <span>{maximum}</span>
              </div>
              {/* Said here because the alternative is a user watching the
                  number change and nothing happening for a minute. */}
              <p className="mt-3 text-xs text-muted-foreground">
                {t("Lowering it applies as the downloads already running finish. Raising it takes effect at once.")}
              </p>
            </div>
          </Section>

          <Section
            icon={RotateCcw}
            title={t("When a transfer fails")}
            hint={t("A dropped connection is retried with a growing pause between tries, so a server having a bad minute does not cost you the file.")}
          >
            <div className="py-3">
              <Row
                label={t("Attempts per file")}
                hint={t("One means try once and report it. The pause grows with each try, up to sixteen seconds.")}
              >
                <span className="w-8 text-right text-lg font-semibold tabular-nums">
                  {draft.download_attempts}
                </span>
              </Row>
              <input
                type="range"
                min={1}
                max={6}
                step={1}
                value={draft.download_attempts}
                aria-label={t("Attempts per file")}
                onChange={(event) => update({ download_attempts: Number(event.target.value) })}
                className="mt-1 w-full accent-[hsl(var(--primary))]"
              />
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>1</span>
                <span>{t("Recommended: 4")}</span>
                <span>6</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("A file already retrying keeps the budget it started with; the change applies to the next one that fails.")}
              </p>
            </div>
          </Section>

          <Section icon={Gamepad2} title={t("While you are playing")}>
            <Row
              label={t("Hold the queue while the game runs")}
              hint={t("Transfers already running finish rather than being torn down — abandoning one halfway throws away what it had already fetched. Queued files wait for you to quit.")}
            >
              <Toggle
                label={t("Hold the queue while the game runs")}
                checked={draft.pause_downloads_in_game}
                onChange={(value) => update({ pause_downloads_in_game: value })}
              />
            </Row>
          </Section>

          <Section icon={Activity} title={t("Right now")}>
            {(() => {
              const list = jobs ?? [];
              const active = list.filter(
                (job) =>
                  typeof job.state === "string" &&
                  ["Queued", "Resolving", "Downloading", "Retrying", "Finalizing", "Installing"].includes(
                    job.state,
                  ),
              );

              if (active.length === 0) {
                const last = list[list.length - 1];
                return (
                  <Row
                    label={t("Nothing is downloading")}
                    hint={
                      last
                        ? t("Last file: {name}").replace("{name}", last.file_name_display || last.mod_name)
                        : t("Files you install from Discover appear here while they arrive.")
                    }
                  />
                );
              }

              return (
                <>
                  {active.slice(0, 4).map((job) => (
                    <Row
                      key={job.id}
                      label={job.file_name_display || job.mod_name}
                      hint={
                        job.total_bytes
                          ? `${formatBytes(job.progress_bytes)} / ${formatBytes(job.total_bytes)}`
                          : formatBytes(job.progress_bytes)
                      }
                    >
                      <span className="text-xs text-muted-foreground">{t(String(job.state))}</span>
                    </Row>
                  ))}
                  {active.length > 4 && (
                    <Row
                      label={t("and {count} more")
                        .replace("{count}", String(active.length - 4))}
                    />
                  )}
                </>
              );
            })()}
          </Section>

          <Section
            icon={CloudDownload}
            title={t("What Kiza does not do")}
            hint={t("Worth stating, because most launchers offer both and Kiza deliberately does not.")}
          >
            <Row
              label={t("No bandwidth limit")}
              hint={t("A cap would be enforced per file, so three downloads at once would exceed it threefold. A number that lies is worse than no number.")}
            />
            <Row
              label={t("Every file is checked, always")}
              hint={t("Hashes are verified on arrival and it cannot be switched off. A mod that arrived corrupted is a crash three days later that nobody connects to this page.")}
            />
          </Section>

          <Section icon={FolderOpen} title={t("Where they land")}>
            <Row
              label={t("Downloads folder")}
              hint={t("A staging area. Files are copied into the instance and can be cleared from Storage.")}
            >
              <ActionButton onClick={() => openFolder.mutate("downloads")} icon={FolderOpen}>
                {t("Open")}
              </ActionButton>
            </Row>
          </Section>
        </div>
      )}
    </ConfigGate>
  );
}
