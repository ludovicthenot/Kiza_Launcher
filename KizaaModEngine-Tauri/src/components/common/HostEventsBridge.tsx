/**
 * What the hosted servers say, the moment they say it.
 *
 * The runtime emits one event per status change and one per burst of
 * console lines. A status lands straight in the query cache — the card, the
 * detail header and the Overview all read from there, so "Online" is on
 * screen when the server printed Done, not on the next poll. A console
 * notice bumps a counter the console hook watches, and it fetches only the
 * lines it has not seen. The polls stay as the safety net for an event
 * that was missed.
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { hostKeys, type HostedServer, type ServerStatus } from "../../lib/hostQueries";

type Notice =
  | { kind: "status"; id: string; status: ServerStatus }
  | { kind: "console"; id: string };

interface ConsoleTicks {
  ticks: Record<string, number>;
  bump: (id: string) => void;
}

/** One number per server, incremented when its console has news. */
export const useConsoleTicks = create<ConsoleTicks>((set) => ({
  ticks: {},
  bump: (id) => set((state) => ({ ticks: { ...state.ticks, [id]: (state.ticks[id] ?? 0) + 1 } })),
}));

export function HostEventsBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<Notice>("kiza://server", (event) => {
      const notice = event.payload;
      if (notice.kind === "console") {
        useConsoleTicks.getState().bump(notice.id);
        return;
      }
      queryClient.setQueryData<ServerStatus>(hostKeys.status(notice.id), notice.status);
      queryClient.setQueryData<HostedServer[]>(hostKeys.servers, (servers) =>
        servers?.map((server) => (server.id === notice.id ? { ...server, status: notice.status } : server)),
      );
      queryClient.setQueryData<HostedServer>(hostKeys.server(notice.id), (server) =>
        server ? { ...server, status: notice.status } : server,
      );
      // Installed, EULA and mod count live on the summary and can change
      // with a state — a finished install is the obvious one.
      if (notice.status.state === "offline" || notice.status.state === "crashed") {
        void queryClient.invalidateQueries({ queryKey: hostKeys.servers });
      }
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [queryClient]);

  return null;
}
