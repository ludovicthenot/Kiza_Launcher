import { create } from "zustand";
import type { BlockedPackFile } from "./queries";

/**
 * The mods a pack arrived without, waiting to be shown.
 *
 * A store rather than a piece of state in the view that imported the pack,
 * because two views import packs -- the library from a zip, the discover tab
 * from CurseForge -- and both end in the same place: an instance that is
 * missing the same kind of thing for the same reason. One dialog, mounted
 * once, fed from wherever the import happened.
 */
interface MissingModsState {
  instanceId: string | null;
  mods: BlockedPackFile[];
  /** Puts the list up for an instance. Nothing happens when it is empty. */
  show: (instanceId: string, mods: BlockedPackFile[]) => void;
  dismiss: () => void;
}

export const useMissingMods = create<MissingModsState>((set) => ({
  instanceId: null,
  mods: [],
  show: (instanceId, mods) => {
    if (mods.length === 0) return;
    set({ instanceId, mods });
  },
  dismiss: () => set({ instanceId: null, mods: [] }),
}));
