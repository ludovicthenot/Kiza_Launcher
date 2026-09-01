import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { TitleBar } from "./components/layout/TitleBar";
import { LibraryView } from "./components/views/LibraryView";
import { InstanceView } from "./components/views/InstanceView";
import { SettingsView } from "./components/views/SettingsView";
import { ServerHubView } from "./components/views/ServerHubView";
import { FirstRunSetupView } from "./components/views/FirstRunSetupView";
import { useAppStore } from "./lib/store";
import { useAppSetting, useFirstRunSetup, useInstances } from "./lib/queries";
import { StartupOverlay } from "./components/common/StartupOverlay";
import { BACKGROUND_CHECK_INTERVAL_MS, useUpdaterStore } from "./lib/updater";
import { UpdateOverlay } from "./components/updater/UpdateOverlay";
import { MakerHost, MakerInspectorHost } from "./components/maker/MakerHost";
import { NotificationBridge } from "./components/common/NotificationBridge";
import { useI18n } from "./lib/i18n";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * A file dropped anywhere the launcher was not expecting one.
 *
 * The webview handles its own drag and drop, which means the default
 * behaviour is the browser's: dropping a picture on the window navigates to
 * it, and Kiza is replaced by a photograph with no way back. The drop zones
 * that want a file take it before this; everything else lands here and is
 * quietly refused.
 */
function useNoStrayDrops() {
  useEffect(() => {
    const refuse = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", refuse);
    window.addEventListener("drop", refuse);
    return () => {
      window.removeEventListener("dragover", refuse);
      window.removeEventListener("drop", refuse);
    };
  }, []);
}

function AppContent() {
  useNoStrayDrops();
  const selectedInstanceId = useAppStore((state) => state.selectedInstanceId);
  const showSettings = useAppStore((state) => state.showSettings);
  const showServerHub = useAppStore((state) => state.showServerHub);
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
    return <FirstRunSetupView />;
  }
  
  return (
    <div className="flex-1 flex overflow-hidden relative">
      {selectedInstanceId ? <InstanceView /> : <LibraryView />}
      {showServerHub && (
        <div className="absolute inset-0 z-30 flex bg-background">
          <ServerHubView />
        </div>
      )}
      {showSettings && <SettingsView />}
    </div>
  );
}

function App() {
  const { t } = useI18n();
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const checkForUpdateOnStartup = useUpdaterStore((state) => state.checkForUpdateOnStartup);
  const checkInBackground = useUpdaterStore((state) => state.checkInBackground);
  const setShowServerHub = useAppStore((state) => state.setShowServerHub);
  const setPendingJoinAddress = useAppStore((state) => state.setPendingJoinAddress);

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

  // A kiza://join link opens the server list with the address ready. It never
  // joins on its own: any web page can send one, and the player is the one who
  // decides to launch a game.
  useEffect(() => {
    if (!isTauri()) return;

    const unlisten = listen<string>("kiza://join-offer", (event) => {
      setPendingJoinAddress(event.payload);
      setShowServerHub(true);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [setPendingJoinAddress, setShowServerHub]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-[100dvh] bg-background text-foreground flex flex-col font-sans select-none overflow-hidden border border-border/50 rounded-lg shadow-2xl dark">
        <TitleBar />
        {/* A row, so the Maker can sit beside the launcher rather than over it.
            With no panel this is one child at full width and nothing about the
            launcher changes; the title bar stays across the whole window so
            dragging it still moves the window. */}
        <div className="flex min-h-0 flex-1">
          {/* `relative` so the Maker's select tool can lay a sheet over exactly
              the launcher — not over the title bar, which stays draggable, and
              not over the panel, which stays usable. */}
          <div className="relative flex min-w-0 flex-1 flex-col">
            <AppContent />
            <MakerInspectorHost />
          </div>
          <MakerHost />
        </div>
        <UpdateOverlay />
        {/* Inside the provider: it reads the configuration to know where
            messages go and which events are worth announcing. */}
        <NotificationBridge />
      </div>
    </QueryClientProvider>
  );
}

export default App;
