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

      toast.info(`Update ${version ?? "available"}`, {
        description: "A signed update is ready to download. Installation remains your choice.",
        duration: 12_000,
        action: {
          label: "Open updater",
          onClick: () => setShowSettings(true),
        },
      });
    });
  }, [checkForUpdateOnStartup, setShowSettings]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-[100dvh] bg-background text-foreground flex flex-col font-sans select-none overflow-hidden border border-border/50 rounded-lg shadow-2xl dark">
        <TitleBar />
        <AppContent />
        <Toaster theme="dark" position="bottom-right" richColors />
      </div>
    </QueryClientProvider>
  );
}

export default App;
