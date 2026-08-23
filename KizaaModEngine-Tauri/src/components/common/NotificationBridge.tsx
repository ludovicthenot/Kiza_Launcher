import { useEffect, useRef } from "react";
import { Toaster } from "sonner";
import { useAppConfig, useDownloads, useRunningInstances } from "../../lib/queries";
import { notify, toastPosition } from "../../lib/notifications";
import { useUpdaterStore } from "../../lib/updater";
import { useI18n } from "../../lib/i18n";

const ACTIVE_STATES = ["Queued", "Resolving", "Downloading", "Retrying", "Finalizing", "Installing"];

/**
 * Watches for the moments worth telling someone about, and shows the toaster.
 *
 * Two of the switches on the Notifications page used to govern nothing: they
 * were saved to the configuration file and read by no code at all. The
 * conditions they described — an update finishing its download, a download
 * queue emptying — were never observed anywhere, so there was nothing for them
 * to switch off.
 *
 * This is where they are observed. Each trigger fires on a transition rather
 * than on a state, and remembers what it last announced, because these hooks
 * re-run on every poll: without that, "your downloads have finished" would
 * arrive every five seconds for as long as the launcher stayed open.
 */
export function NotificationBridge() {
  const { t } = useI18n();
  const { data: config } = useAppConfig();
  const { data: downloads } = useDownloads();
  const { data: running } = useRunningInstances();
  const phase = useUpdaterStore((state) => state.phase);
  const version = useUpdaterStore((state) => state.version);

  const gameRunning = Object.keys(running ?? {}).length > 0;

  // Kept in refs rather than in state: a re-render on every poll is exactly
  // what this component exists to avoid causing.
  const hadActiveDownloads = useRef(false);
  const announcedUpdate = useRef<string | null>(null);
  const runningBefore = useRef(0);

  const context = () => ({ now: new Date(), gameRunning });

  // An update that has finished downloading and is waiting to be installed.
  useEffect(() => {
    if (phase !== "ready" || !version) return;
    if (announcedUpdate.current === version) return;
    announcedUpdate.current = version;

    void notify(
      {
        kind: "update_ready",
        title: t("Kiza is ready to update"),
        body: t("Version {version} has finished downloading.").replace("{version}", version),
      },
      config,
      context(),
    );
  }, [phase, version, config, gameRunning, t]);

  // The download queue going from busy to empty.
  useEffect(() => {
    const jobs = downloads ?? [];
    const active = jobs.some(
      (job) => typeof job.state === "string" && ACTIVE_STATES.includes(job.state),
    );

    if (active) {
      hadActiveDownloads.current = true;
      return;
    }
    // Only when it was busy a moment ago. A launcher opened with an empty
    // queue has not just finished anything.
    if (!hadActiveDownloads.current) return;
    hadActiveDownloads.current = false;

    void notify(
      {
        kind: "downloads_finished",
        title: t("Downloads finished"),
        body: t("Nothing is left in the queue."),
      },
      config,
      context(),
    );
  }, [downloads, config, gameRunning, t]);

  // The game appearing. Announced on the way up only, so quitting one instance
  // of two does not read as a launch.
  useEffect(() => {
    const count = Object.keys(running ?? {}).length;
    const before = runningBefore.current;
    runningBefore.current = count;

    if (count <= before) return;
    void notify(
      { kind: "game_started", title: t("Minecraft is running"), body: t("The game has started.") },
      config,
      // Deliberately not the shared context: the game is what just started, so
      // the do-not-disturb-while-playing rule would swallow the one notice
      // that announces it.
      { now: new Date(), gameRunning: false },
    );
  }, [running, config, t]);

  return (
    <Toaster
      theme="dark"
      position={toastPosition(config?.notify_position)}
      richColors
      // A toaster that keeps rendering while the setting says otherwise would
      // make the switch look broken.
      visibleToasts={config?.notify_in_app === false ? 0 : 3}
    />
  );
}
