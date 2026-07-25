import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast, Toaster } from "sonner";
import { TitleBar } from "./components/layout/TitleBar";
import { LibraryView } from "./components/views/LibraryView";
import { InstanceView } from "./components/views/InstanceView";
import { SettingsView } from "./components/views/SettingsView";
import { FirstRunSetupView } from "./components/views/FirstRunSetupView";
import { useAppStore } from "./lib/store";
import { useFirstRunSetup } from "./lib/queries";
import { Loader2 } from "lucide-react";
import { useUpdaterStore } from "./lib/updater";
import { UpdateOverlay } from "./components/updater/UpdateOverlay";
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
  const showSettings = useAppStore((state) => state.showSettings);
  const { data: setup, isLoading: setupLoading } = useFirstRunSetup();

  if (setupLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!setup?.setup_completed) {
    return <FirstRunSetupView />;
  }
  
  return (
    <div className="flex-1 flex overflow-hidden relative">
      {selectedInstanceId ? <InstanceView /> : <LibraryView />}
      {showSettings && <SettingsView />}
    </div>
  );
}

function App() {
  const { t } = useI18n();
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const checkForUpdateOnStartup = useUpdaterStore((state) => state.checkForUpdateOnStartup);

  // Dark mode init
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    void checkForUpdateOnStartup().then((performed) => {
      if (!performed) return;
      const { phase, version } = useUpdaterStore.getState();
      if (phase !== "available") return;

      toast.info(`${t("Update available")}: v${version ?? "?"}`, {
        description: t("Click Update next to the launcher name to install it."),
        duration: 12_000,
        action: {
          label: t("Open updater"),
          onClick: () => setShowSettings(true),
        },
      });
    });
  }, [checkForUpdateOnStartup, setShowSettings, t]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-[100dvh] bg-background text-foreground flex flex-col font-sans select-none overflow-hidden border border-border/50 rounded-lg shadow-2xl dark">
        <TitleBar />
        <AppContent />
        <UpdateOverlay />
        <Toaster theme="dark" position="bottom-right" richColors />
      </div>
    </QueryClientProvider>
  );
}

export default App;
