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
  maxTotalBytes: 32 * 1024 * 1024,
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
  /**
   * A video background, which is a different bargain from an animated picture.
   *
   * A GIF is a stack of whole frames and is decoded as one; a video is
   * compressed between frames and is decoded by the same hardware that decodes
   * everything else on the machine. That is why the ceiling here is higher than
   * the one above even though the thing on screen moves more: twenty seconds of
   * WebM at this size is a few megabytes, where the same twenty seconds as a
   * GIF would be sixty and would cost far more to play.
   */
  maxVideoBytes: 24 * 1024 * 1024,
  /**
   * How long a background may run.
   *
   * A background loops, so length buys nothing after the first pass — it only
   * costs bytes to download and frames to decode. Twenty seconds is a long
   * loop; a minute is a film nobody watches.
   */
  maxVideoSeconds: 30,
} as const;

/** Picture formats a theme may carry, and what an importer should accept. */
export const ASSET_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/**
 * Moving formats, and the one slot that may hold them.
 *
 * A logo is drawn in a header forty pixels tall and next to text; a video
 * there would be a decoder running for something nobody can see moving. The
 * background is the whole window, which is the only place where motion is the
 * point. Refused in the backend as well — this list and `kizatheme.rs` are the
 * same list, and a test holds them together.
 */
export const VIDEO_MIME_TYPES = ["video/webm", "video/mp4"] as const;
export const VIDEO_EXTENSIONS = ["webm", "mp4"] as const;
export const MOTION_SLOT: AssetSlot = "background";

/**
 * Whether a slot's URL points at something that plays rather than something
 * that is drawn.
 *
 * Read off the address, because that is the one thing every route agrees on: a
 * staged file keeps its name, `convertFileSrc` keeps the path, and a picture
 * that ships with Kiza is a path Vite wrote. Nothing has to carry a MIME type
 * around beside the URL for this to be answerable.
 */
export function isMotionAsset(url: string): boolean {
  const address = url.split(/[?#]/, 1)[0].toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => address.endsWith(`.${extension}`));
}

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
