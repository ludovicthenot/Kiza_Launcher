/**
 * The rule for when a settings change reaches the disk.
 *
 * Every settings page used to write the whole configuration file on every
 * keystroke and every pixel of slider movement, and each write also refetched
 * the configuration, refetched the list of API connections — which makes
 * network requests — and raised a toast. Dragging the "files at the same time"
 * slider from 1 to 8 fired that sequence dozens of times, and the window
 * stopped responding for as long as the drag lasted.
 *
 * So the draft moves at once and the write waits. This module is the deciding
 * part, kept pure so the timing can be tested against a fake clock rather than
 * by dragging a slider and watching.
 */

/** How long the launcher waits for the changes to stop before writing. */
export const SAVE_DELAY_MS = 400;

export interface PendingSave<T> {
  /** What would be written if the timer fired now. */
  value: T;
  /** When the write is due, in milliseconds on the same clock as `now`. */
  dueAt: number;
}

/**
 * Folds a change into whatever is already waiting to be written.
 *
 * The patch is applied to the pending value rather than to the last saved one,
 * so a slider dragged through six positions writes the sixth — not the first,
 * and not six times.
 */
export function schedule<T extends object>(
  pending: PendingSave<T> | null,
  current: T,
  patch: Partial<T>,
  now: number,
  delay: number = SAVE_DELAY_MS,
): PendingSave<T> {
  return {
    value: { ...(pending?.value ?? current), ...patch },
    dueAt: now + delay,
  };
}

/** Whether the write is due. */
export function isDue<T>(pending: PendingSave<T> | null, now: number): boolean {
  return pending !== null && now >= pending.dueAt;
}

/**
 * Whether a freshly loaded configuration should replace the draft on screen.
 *
 * It should not while a write is still pending: the value coming back is the
 * one from before the change, and letting it win makes a switch flick back to
 * where it was a moment after being pressed.
 */
export function shouldAdopt<T>(pending: PendingSave<T> | null, hasDraft: boolean): boolean {
  return pending === null || !hasDraft;
}
