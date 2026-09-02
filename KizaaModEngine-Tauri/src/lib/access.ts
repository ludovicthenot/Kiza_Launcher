/**
 * What this launcher may receive, and how it asks.
 *
 * One store rather than a piece of state in each page, because two pages need
 * the same answer for different reasons: the Connections page shows it, and
 * the channel picker refuses to switch without it. Two copies would be two
 * copies that disagree the moment somebody connects on one and looks at the
 * other.
 *
 * The launcher never decides anything here. The service does, on every
 * request. What this holds is the proof and a label for it.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface AccessStatus {
  connected: boolean;
  channels: string[];
  expires: string | null;
  account: string | null;
  has_setup_key: boolean;
}

/** Channels the service will not serve without proof. */
export const GATED_CHANNELS = ["beta", "alpha", "experimental"] as const;

export function isGatedChannel(channel: string): boolean {
  return (GATED_CHANNELS as readonly string[]).includes(channel);
}

interface AccessState {
  status: AccessStatus | null;
  /**
   * The channel somebody asked for and could not have yet.
   *
   * Remembered across the trip to the browser: they clicked Alpha, they were
   * sent to Discord, and when they come back the thing they actually wanted
   * should happen without being asked again.
   */
  wanted: string | null;

  refresh: () => Promise<AccessStatus | null>;
  /** Opens Discord in the browser, optionally on the way to a channel. */
  connect: (forChannel?: string) => Promise<void>;
  claim: (code: string, state: string) => Promise<AccessStatus>;
  disconnect: () => Promise<void>;
  takeWanted: () => string | null;
}

export const useAccess = create<AccessState>((set, get) => ({
  status: null,
  wanted: null,

  refresh: async () => {
    try {
      const status = await invoke<AccessStatus>("access_status");
      set({ status });
      return status;
    } catch {
      set({ status: null });
      return null;
    }
  },

  connect: async (forChannel) => {
    set({ wanted: forChannel ?? null });
    await invoke("access_begin");
  },

  claim: async (code, state) => {
    const status = await invoke<AccessStatus>("access_claim", { code, state });
    set({ status });
    return status;
  },

  disconnect: async () => {
    const status = await invoke<AccessStatus>("access_disconnect");
    set({ status, wanted: null });
  },

  // Taken rather than read: whatever was waiting happens once.
  takeWanted: () => {
    const { wanted } = get();
    if (wanted) set({ wanted: null });
    return wanted;
  },
}));

/** Whether the launcher may currently follow this channel. */
export function mayFollow(status: AccessStatus | null, channel: string): boolean {
  if (!isGatedChannel(channel)) return true;
  return Boolean(status?.channels.includes(channel));
}
