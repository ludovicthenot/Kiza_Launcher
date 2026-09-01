/**
 * The picture a theme puts behind the launcher.
 *
 * The `background` slot existed in the theme format, in the archive reader and
 * in the Maker's asset list, and nothing drew it: a designer could pick a
 * picture, watch it stage, export it, and never see it. This is the layer that
 * was missing.
 *
 * It sits inside the window's own frame at a negative z-index, which puts it
 * over the window's flat background and under every piece of interface — so
 * nothing else had to move or learn about it. With no picture it renders
 * nothing at all, which is the state Stable is in unless somebody chose a
 * theme that carries one.
 *
 * A veil over the picture, not a filter on it: the launcher's text has to stay
 * readable over a photograph somebody chose for looking good rather than for
 * contrast, and a theme decides how heavy that veil is.
 */

import { useEffect, useRef } from "react";
import { isMotionAsset, useThemeAsset } from "../../lib/theme/assets";

export function ThemeBackdrop() {
  const url = useThemeAsset("background");
  if (!url) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {isMotionAsset(url) ? (
        <BackdropVideo src={url} />
      ) : (
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      )}
      <div className="kiza-backdrop-veil absolute inset-0" />
    </div>
  );
}

/**
 * A moving background, and the two times it must stop moving.
 *
 * A launcher is usually left open behind whatever the person is actually
 * doing, and a video that keeps decoding behind a game is a video that costs
 * frames somebody paid for. So it stops when the window is not being looked at
 * — and it stops when the launcher has been told to hold still, because
 * "reduce motion" cannot mean everything except the largest moving thing on
 * screen.
 *
 * Paused rather than unmounted: the first frame stays, so the theme still
 * looks like itself.
 */
function BackdropVideo({ src }: { src: string }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return;

    const settle = () => {
      const wanted =
        document.visibilityState === "visible" &&
        document.documentElement.dataset.animations !== "off";
      if (wanted) {
        // Autoplay can still be refused; a still first frame is the failure
        // that nobody has to be told about.
        void element.play().catch(() => {});
      } else {
        element.pause();
      }
    };

    settle();
    document.addEventListener("visibilitychange", settle);
    // The appearance settings write onto <html>; this is how the video hears
    // about "reduce motion" being switched on while it is playing.
    const watcher = new MutationObserver(settle);
    watcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-animations"],
    });

    return () => {
      document.removeEventListener("visibilitychange", settle);
      watcher.disconnect();
    };
  }, [src]);

  return (
    <video
      ref={video}
      src={src}
      className="h-full w-full object-cover"
      muted
      loop
      playsInline
      autoPlay
      preload="auto"
      disablePictureInPicture
    />
  );
}
