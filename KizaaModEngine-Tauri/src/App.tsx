import { Suspense, lazy, useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { TitleBar } from "./components/layout/TitleBar";
import { ThemeBackdrop } from "./components/layout/ThemeBackdrop";
import { ArchiveDropOverlay } from "./components/common/ArchiveDropOverlay";
import { TrayBridge } from "./components/common/TrayBridge";
import { LibraryView } from "./components/views/LibraryView";
// The library is what opens first, so it is in the first chunk; the rest
// of the launcher is fetched the moment it is asked for. Together these
// were half the script the window had to parse before it could draw
// anything, on a page most launches never leave.
const HostView = lazy(() => import("./components/views/HostView").then((m) => ({ default: m.HostView })));
const InstanceView = lazy(() => import("./components/views/InstanceView").then((m) => ({ default: m.InstanceView })));
const SettingsView = lazy(() => import("./components/views/SettingsView").then((m) => ({ default: m.SettingsView })));
const FirstRunSetupView = lazy(() =>
  import("./components/views/FirstRunSetupView").then((m) => ({ default: m.FirstRunSetupView })),
);
import { useAppStore } from "./lib/store";
import { useAppSetting, useFirstRunSetup, useInstances } from "./lib/queries";
import { StartupOverlay } from "./components/common/StartupOverlay";
import { BACKGROUND_CHECK_INTERVAL_MS, useUpdaterStore } from "./lib/updater";
import { UpdateOverlay } from "./components/updater/UpdateOverlay";
import { ChannelNotice } from "./components/updater/ChannelNotice";
import { MakerHost, MakerInspectorHost } from "./components/maker/MakerHost";
import { NotificationBridge } from "./components/common/NotificationBridge";
import { AccessBridge } from "./components/common/AccessBridge";
import { HostEventsBridge } from "./components/common/HostEventsBridge";
import { AccessGate } from "./components/access/AccessGate";
import { ReleaseNotesDialog } from "./components/common/ReleaseNotesDialog";
import { MissingModsDialog } from "./components/common/MissingModsDialog";
import { useI18n } from "./lib/i18n";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AppContent() {
  const selectedInstanceId = useAppStore((state) => state.selectedInstanceId);
  const libraryMode = useAppStore((state) => state.libraryMode);
  const showSettings = useAppStore((state) => state.showSettings);
  const { data: setup, isLoading: setupLoading } = useFirstRunSetup();
  // Instances are fetched here only so the boot screen can wait for the real
  // work; the views read the same cached query.
  const { isLoading: instancesLoading } = useInstances();
  // One field, not the whole configuration: reading the object here made every
  // settings change re-render the entire application behind the dialogue.
  const autoDownloadUpdates = useAppSetting("auto_download_updates");
  const updaterPhase = useUpdaterStore((state) => state.phase);

  // "Download updates automatically", from General.
  //
  // The setting was stored and read by nothing: an available update sat there
  // until someone pressed Update, whatever it said. Installing stays a
  // decision — this only fetches, which is what the switch promises.
  useEffect(() => {
    if (!isTauri()) return;
    if (!autoDownloadUpdates) return;
    if (updaterPhase !== "available") return;
    void useUpdaterStore.getState().downloadUpdate();
  }, [autoDownloadUpdates, updaterPhase]);


  // The first launch after installation has to create the data folder and read
  // the configuration, so show what is happening instead of a bare spinner.
  if (setupLoading) return <StartupOverlay step="setup" />;
  if (setup?.setup_completed && instancesLoading) return <StartupOverlay step="library" />;

  if (!setup?.setup_completed) {
    return (
      <Suspense fallback={<StartupOverlay step="setup" />}>
        <FirstRunSetupView />
      </Suspense>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden relative">
      <Suspense fallback={null}>
        {selectedInstanceId ? <InstanceView /> : libraryMode === "host" ? <HostView /> : <LibraryView />}
        {showSettings && <SettingsView />}
      </Suspense>
    </div>
  );
}

function App() {
  const { t } = useI18n();
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const checkForUpdateOnStartup = useUpdaterStore((state) => state.checkForUpdateOnStartup);
  const checkInBackground = useUpdaterStore((state) => state.checkInBackground);

  // Dark mode init
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    const announce = () => {
      // The store decides whether this version has already been announced, so a
      // recurring check never repeats itself.
      const version = useUpdaterStore.getState().takeAnnouncement();
      if (!version) return;

      toast.info(`${t("Update available")}: v${version}`, {
        description: t("Click Update next to the launcher name to install it."),
        duration: 12_000,
        action: {
          label: t("Open updater"),
          onClick: () => setShowSettings(true),
        },
      });
    };

    void checkForUpdateOnStartup().then(announce);

    // A launcher left open all evening would otherwise never learn about a
    // release published while it was running.
    const timer = window.setInterval(() => {
      void checkInBackground().then(announce);
    }, BACKGROUND_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [checkForUpdateOnStartup, checkInBackground, setShowSettings, t]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="relative isolate h-[100dvh] bg-background text-foreground flex flex-col font-sans select-none overflow-hidden border border-border/50 rounded-lg shadow-2xl dark">
        {/* Behind the interface and over the window's own colour. `isolate`
            keeps that layer inside this frame: a negative z-index with nothing
            to sit against would slide behind the window and never be drawn. */}
        <ThemeBackdrop />
        {/* Over the pages rather than above them: the bar is glass, and glass
            wants something behind it. Each page keeps its first line clear of
            the bar with `kiza-under-bar` and scrolls the rest beneath it. */}
        <TitleBar />
        {/* A row, so the Maker can sit beside the launcher rather than over it.
            With no panel this is one child at full width and nothing about the
            launcher changes; the title bar stays across the whole window so
            dragging it still moves the window. */}
        {/* The door, on a build that has one. It sits inside the window frame
            rather than over it, so the title bar keeps working: somebody who
            cannot get in must still be able to close the window. */}
        <AccessGate>
          <div className="flex min-h-0 flex-1">
            {/* `relative` so the Maker's select tool can lay a sheet over
                exactly the launcher — not over the title bar, which stays
                draggable, and not over the panel, which stays usable. */}
            <div className="relative flex min-w-0 flex-1 flex-col">
              <AppContent />
              <MakerInspectorHost />
              {/* Inside the gate: a pack dropped on a locked launcher has
                  nowhere to go. */}
              <ArchiveDropOverlay />
            </div>
            <MakerHost />
          </div>
        </AccessGate>
        <UpdateOverlay />
        <ChannelNotice />
        {/* A sibling of the gate rather than a child: the dialog decides for
            itself whether there is anything to say, and says nothing on a
            launcher that has not moved. */}
        <ReleaseNotesDialog />
        <MissingModsDialog />
        {/* Inside the provider: it reads the configuration to know where
            messages go and which events are worth announcing. */}
        <NotificationBridge />
        {/* The answer to a Discord sign-in arrives as a link and can land at
            any moment; it is caught here rather than on whichever page
            happened to ask for it. */}
        <AccessBridge />
        {/* Hosted servers report their state as it changes; this puts it in
            the cache the Host page reads. */}
        <HostEventsBridge />
        {/* Choices made in the tray menu, another window, land here. */}
        <TrayBridge />
      </div>
    </QueryClientProvider>
  );
}

export default App;
