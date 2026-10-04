import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ConsoleWindow } from "./components/console/ConsoleWindow";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

/** Entry point for the separate Kiza Manager log window (hash #/console/<id>). */
export function ConsoleRoot({ instanceId }: { instanceId: string }) {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    // The window is the frame: nothing in it scrolls the page, only the log
    // and the activity scroll inside their own panel.
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="dark h-screen overflow-hidden rounded-lg border border-border/50 font-sans shadow-2xl">
        <ConsoleWindow instanceId={instanceId} />
      </div>
      <Toaster theme="dark" position="bottom-right" richColors />
    </QueryClientProvider>
  );
}
