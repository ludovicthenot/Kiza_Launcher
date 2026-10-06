import { useEffect, useRef } from "react";
import { Toaster } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import {
  useAppConfig,
  useDownloads,
  useRunningInstances,
  useSetDownloadsPaused,
} from "../../lib/queries";
import { notify, toastPosition, type Notice } from "../../lib/notifications";
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
  const setDownloadsPaused = useSetDownloadsPaused();
  const phase = useUpdaterStore((state) => state.phase);
  const version = useUpdaterStore((state) => state.version);

  const gameRunning = Object.keys(running ?? {}).length > 0;

  // Kept in refs rather than in state: a re-render on every poll is exactly
  // what this component exists to avoid causing.
  const hadActiveDownloads = useRef(false);
  const announcedUpdate = useRef<string | null>(null);
  const runningBefore = useRef(0);

  const context = () => ({ now: new Date(), gameRunning });

  // The latest of both, for the listener below, which lives as long as the
  // window does and must not be torn down and set up again on every poll.
  const latest = useRef({ config, gameRunning, t });
  latest.current = { config, gameRunning, t };

  // What Rust has to say: a crash, a backup done. It decides only that
  // something happened; whether anybody hears of it is decided here, by the
  // same rules as everything else.
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<Notice>("kiza://notice", (event) => {
      const { config: current, gameRunning: playing, t: translate } = latest.current;
      void notify(
        { ...event.payload, title: translate(event.payload.title) },
        current,
        { now: new Date(), gameRunning: playing },
      );
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

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

  // Holding the download queue while the game runs, when that was asked for.
  // Driven from here rather than from Rust because this is where the game's
  // running state is already being watched, and two places watching it would
  // be two places to get it wrong.
  const shouldHold = Boolean(config?.pause_downloads_in_game) && gameRunning;
  const holding = useRef(false);
  useEffect(() => {
    if (holding.current === shouldHold) return;
    holding.current = shouldHold;
    setDownloadsPaused.mutate(shouldHold);
    // Deliberately not depending on the mutation object, which is new on every
    // render and would make this fire in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldHold]);

  return (
    <Toaster
      theme="dark"
      position={toastPosition(config?.notify_position)}
      // "Messages inside Kiza" governs the notices `notify` sends, and
      // `notify` already holds them back. It used to hide the toaster itself,
      // which also hid every error and every "done" in the launcher: a failed
      // install said nothing at all.
      visibleToasts={3}
      gap={10}
      // A notification is a piece of frosted glass, not a coloured slab: the
      // material is the same for every kind, and what kind it is shows in the
      // icon. The action is a pill in the theme's colour.
      toastOptions={{
        classNames: {
          toast:
            "!rounded-2xl !border-0 !bg-popover/80 !px-4 !py-3.5 !text-foreground !shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.09),0_18px_44px_hsl(242_30%_2%/0.55)] !backdrop-blur-2xl !backdrop-saturate-150",
          title: "!text-[0.8438rem] !font-semibold !tracking-[-0.01em]",
          description: "!text-[0.7812rem] !leading-snug !text-muted-foreground",
          // Sonner paints its buttons with the `background` shorthand, which
          // would erase a gradient class; a plain fill survives it.
          actionButton:
            "!rounded-full !bg-primary !px-3 !py-1.5 !text-xs !font-semibold !text-primary-foreground !shadow-[0_1px_2px_hsl(240_30%_2%/0.45)]",
          cancelButton: "!rounded-full !bg-secondary/60 !px-3 !py-1.5 !text-xs !font-medium !text-foreground",
          closeButton: "!border-0 !bg-secondary/80 !text-muted-foreground hover:!text-foreground",
          success: "[&_[data-icon]]:!text-emerald-400",
          error: "[&_[data-icon]]:!text-red-400",
          warning: "[&_[data-icon]]:!text-amber-300",
          info: "[&_[data-icon]]:!text-primary",
        },
      }}
    />
  );
}
