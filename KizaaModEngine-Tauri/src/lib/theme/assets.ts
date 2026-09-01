/**
 * Where the launcher's pictures come from.
 *
 * One way to ask, whatever the answer turns out to be. A slot is asked for by
 * name — `assetUrl("logo")` — and the resolver decides whether that resolves to
 * the picture bundled with Kiza or to one a theme brought with it. Nothing that
 * draws a logo knows or cares which, exactly as nothing that paints a colour
 * knows whether the theme came from the bundle or from a file.
 *
 * Without this, replacing a logo would mean editing every component that draws
 * one, and a theme could only ever change the pictures somebody had remembered
 * to make replaceable.
 */

import { useSyncExternalStore } from "react";
import { activeTheme, subscribe } from "./engine";
import type { AssetSlot } from "./definition";
import bundledLogo from "../../assets/kiza-header.png";

/**
 * What each slot shows when no theme replaces it.
 *
 * These are the pictures that ship with Kiza. A slot with no default is one a
 * theme may add and the launcher does not require.
 */
const BUNDLED: Partial<Record<AssetSlot, string>> = {
  logo: bundledLogo,
  logoCompact: bundledLogo,
};

/**
 * How big a themed picture is allowed to be.
 *
 * Enforced where a theme is opened — see `kizatheme.rs`, which is the only
 * thing that can refuse one — and repeated here so the two cannot disagree
 * about what a valid theme is. A launcher that has to stay light cannot let a
 * theme hand it a forty-megabyte animation.
 */
export const ASSET_LIMITS = {
  /** Any single picture. */
  maxBytes: 8 * 1024 * 1024,
  /** Everything a theme carries, together. */
  maxTotalBytes: 24 * 1024 * 1024,
  /** Longest edge. Beyond this a picture costs more to decode than it shows. */
  maxDimension: 4096,
  /**
   * Animated formats are allowed, and cost more than a still.
   *
   * An animated WebP or GIF is decoded frame by frame for as long as it is on
   * screen, so a theme with a large one is a theme that keeps a core busy while
   * somebody reads a settings page. The lower ceiling is what keeps "animated
   * background" from meaning "the launcher is now the heaviest thing running".
   */
  maxAnimatedBytes: 4 * 1024 * 1024,
  maxAnimatedDimension: 1920,
} as const;

/** Formats a theme may carry, and what an importer should accept. */
export const ASSET_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/** The picture for a slot right now. */
/**
 * What Kiza ships for a slot, ignoring any theme.
 *
 * The Maker needs this to show a designer what they are replacing, and to say
 * honestly that a slot is back to the default rather than empty.
 */
export function bundledAsset(slot: AssetSlot): string | undefined {
  return BUNDLED[slot];
}

export function assetUrl(slot: AssetSlot): string | undefined {
  return activeTheme()?.assets?.[slot] ?? BUNDLED[slot];
}

/**
 * The picture for a slot, kept up to date.
 *
 * `useSyncExternalStore` rather than an effect and a piece of state: it does not
 * rerender when the answer has not changed, which matters because the Maker
 * will be changing themes on every drag of a colour picker.
 */
export function useThemeAsset(slot: AssetSlot): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => assetUrl(slot),
    () => BUNDLED[slot],
  );
}
