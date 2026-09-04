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
   * The channel this launcher follows, once read from its configuration.
   *
   * Kept here rather than fetched by whoever needs it, because two things now
   * turn on the same answer: the door decides whether to open, and the title
   * bar decides whether to offer anything but the window controls. Two reads
   * are two chances to disagree, and disagreeing means a way in.
   *
   * `null` is "not asked yet", never "stable".
   */
  channel: string | null;
  /**
   * The channel somebody asked for and could not have yet.
   *
   * Remembered across the trip to the browser: they clicked Alpha, they were
   * sent to Discord, and when they come back the thing they actually wanted
   * should happen without being asked again.
   */
  wanted: string | null;

  refresh: () => Promise<AccessStatus | null>;
  /** Reads the followed channel. Safe to call more than once. */
  resolveChannel: () => Promise<string>;
  /** Opens Discord in the browser, optionally on the way to a channel. */
  connect: (forChannel?: string) => Promise<void>;
  claim: (code: string, state: string) => Promise<AccessStatus>;
  disconnect: () => Promise<void>;
  takeWanted: () => string | null;
}

export const useAccess = create<AccessState>((set, get) => ({
  status: null,
  channel: null,
  wanted: null,

  resolveChannel: async () => {
    try {
      const config = await invoke<{ update_channel?: string }>("get_app_config");
      const channel = config?.update_channel?.trim().toLowerCase() || "stable";
      set({ channel });
      return channel;
    } catch {
      // An unreadable configuration -- or a browser, where there is no
      // launcher to ask -- must not lock somebody out of their own launcher.
      // The service still decides what they are allowed to download.
      set({ channel: "stable" });
      return "stable";
    }
  },

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

/**
 * Whether the door is shut: this build wants proof, and does not have it.
 *
 * Three answers, not two. `null` is "not known yet", and it matters: anything
 * that would reveal part of the launcher has to treat not-knowing as shut,
 * or a slow read becomes a window somebody can click through.
 */
export function doorShut(
  status: AccessStatus | null,
  channel: string | null,
): boolean | null {
  if (channel === null) return null;
  if (!isGatedChannel(channel)) return false;
  if (status === null) return null;
  if (!status.channels.includes(channel)) return true;
  // A pass the service will refuse is not a pass. Opening on one would let
  // somebody into a launcher that cannot fetch a single thing.
  if (status.expires && new Date(status.expires).getTime() <= Date.now()) return true;
  return false;
}

/** Whether the launcher may currently follow this channel. */
export function mayFollow(status: AccessStatus | null, channel: string): boolean {
  if (!isGatedChannel(channel)) return true;
  return Boolean(status?.channels.includes(channel));
}
