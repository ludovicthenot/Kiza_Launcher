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
import { useBackdropSetting } from "../../lib/theme/backdrop";
import { KizaWaves } from "./KizaWaves";

export function ThemeBackdrop() {
  const themed = useThemeAsset("background");
  const waves = useBackdropSetting("waves") !== "off";

  // A theme that turned the waves off: the window's own colour, and the two
  // soft glows a theme has always carried (`ambient`), as before the waves.
  if (!themed && !waves) {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-background [background-image:var(--kiza-ambient)]"
      />
    );
  }

  // Without a theme picture, the launcher's own: slow waves in the theme's
  // colours, under a dark veil, even from the title bar down: the waves read
  // as something moving behind smoked glass rather than as a picture behind
  // the text, and no page has to add a shade of its own (two shades meeting is
  // an edge). How dark the veil is, a theme decides (`backdrop.shade`).
  if (!themed) {
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <KizaWaves />
        <div className="kiza-waves-shade absolute inset-0" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,transparent_40%,hsl(var(--background)/0.5)_100%)]" />
      </div>
    );
  }

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {isMotionAsset(themed) ? (
        <BackdropVideo src={themed} />
      ) : (
        <img src={themed} alt="" className="h-full w-full object-cover" draggable={false} />
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
