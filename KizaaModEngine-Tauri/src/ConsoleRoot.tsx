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
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="dark overflow-hidden rounded-lg border border-border/50 font-sans shadow-2xl">
        <ConsoleWindow instanceId={instanceId} />
      </div>
      <Toaster theme="dark" position="bottom-right" richColors />
    </QueryClientProvider>
  );
}
