/**
 * What a theme says about the layer behind the launcher.
 *
 * Stored with the components — `components.backdrop` — because that is
 * already a bag of values every Kiza reads and every older one ignores, and
 * because most of these are custom properties anyway: the engine writes
 * `--kiza-backdrop-shade`, `--kiza-backdrop-glow` and the rest, and the
 * stylesheet and the waves read them. The one exception is whether there are
 * waves at all, which decides what is rendered rather than how it is painted,
 * so React has to hear about it.
 *
 * The keys in use:
 *
 * - `waves`     "off" for a still window, with the theme's ambient glow
 * - `glow`      the bands' light (an HSL triple); the primary when unset
 * - `depth`     their body; a deep shade of the glow when unset
 * - `shade`     how dark the veil over them is, 0 to 1 (0.86)
 * - `movement`  0 to 1, how fast they turn (1)
 * - `veil`      how dark the veil over a theme's own picture is (0.62)
 */

import { useSyncExternalStore } from "react";
import { activeTheme, subscribe } from "./engine";

export type BackdropKey = "waves" | "glow" | "depth" | "shade" | "movement" | "veil";

/** One backdrop setting of the theme on screen, if it has one. */
export function backdropSetting(key: BackdropKey): string | undefined {
  return activeTheme()?.components?.backdrop?.[key];
}

/** The same, kept up to date as the theme changes. */
export function useBackdropSetting(key: BackdropKey): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => backdropSetting(key),
    () => undefined,
  );
}
