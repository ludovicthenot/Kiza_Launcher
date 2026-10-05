/**
 * Whether Kiza Maker's editor is out in a window of its own (`detach.ts`).
 *
 * Its own small file so the launcher's host can read it without carrying the
 * rest of the Maker's machinery into every edition.
 */

import { create } from "zustand";

export const useMakerWindow = create<{ detached: boolean }>(() => ({ detached: false }));
