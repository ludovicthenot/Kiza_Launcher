import { useEffect, useRef } from "react";
import type { SkinViewer } from "skinview3d";
import type { SkinVariant } from "../../lib/skinQueries";

export type SkinView = "orbit" | "front" | "side" | "back";

/** The turntable's pace, and how often it is drawn while it turns. */
const ORBIT_FPS = 24;
const ORBIT_RADIANS_PER_SECOND = 0.5;

/**
 * The player in three dimensions, drawn by skinview3d.
 *
 * The library is loaded on first use rather than with the launcher: it
 * carries a WebGL renderer, and every page that is not this one should not
 * pay for it. A page that has no WebGL (a test, a headless preview) shows
 * nothing rather than throwing — the texture is still there in the library
 * strip below.
 *
 * Drawn only when something changed. The library's own loop redraws sixty
 * times a second whether or not anything moved; here the loop is ours, runs
 * at twenty-four while the figure turns, and does not run at all for a fixed
 * view, a hidden window, or a page nobody is looking at. A frame of a
 * figure that has not moved is a frame the GPU drew for nothing.
 */
export function SkinViewer3D({
  skin,
  cape,
  variant,
  view,
  zoom,
  className,
}: {
  /** Data URL of the skin PNG, or null for the default skin. */
  skin: string | null;
  cape: string | null;
  variant: SkinVariant;
  view: SkinView;
  /** 1 is the natural distance; larger is closer. */
  zoom: number;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<SkinViewer | null>(null);
  const ready = useRef<Promise<SkinViewer | null> | null>(null);
  const orbiting = useRef(false);

  // One viewer per mount, sized to its box and resized with it.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full";
    element.appendChild(canvas);

    let timer: number | null = null;
    let last = 0;

    const draw = () => {
      const instance = viewer.current;
      if (instance && !instance.disposed && !document.hidden) instance.render();
    };

    // The turntable: a timer rather than requestAnimationFrame, so the
    // pace is ours and the cost is bounded.
    const settle = () => {
      const wanted = orbiting.current && !document.hidden && !disposed;
      if (wanted && timer === null) {
        last = performance.now();
        timer = window.setInterval(() => {
          const instance = viewer.current;
          if (!instance || instance.disposed) return;
          const now = performance.now();
          instance.playerWrapper.rotation.y += ((now - last) / 1000) * ORBIT_RADIANS_PER_SECOND;
          last = now;
          draw();
        }, 1000 / ORBIT_FPS);
      } else if (!wanted && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    element.addEventListener("kiza:settle", settle);
    document.addEventListener("visibilitychange", settle);

    ready.current = import("skinview3d")
      .then(({ SkinViewer }) => {
        if (disposed) return null;
        const instance = new SkinViewer({
          canvas,
          width: element.clientWidth || 320,
          height: element.clientHeight || 360,
          // One device pixel per CSS pixel: the texture is pixel art, and a
          // 2x canvas is four times the fill for edges nobody can see.
          pixelRatio: 1,
          fov: 55,
          zoom: 0.72,
          // The library's own loop is off; every frame below is asked for.
          renderPaused: true,
        });
        instance.autoRotate = false;
        instance.fxaaPass.enabled = false;
        instance.controls.enablePan = false;
        instance.controls.enableZoom = false;
        instance.controls.addEventListener("change", draw);
        instance.globalLight.intensity = 2.6;
        instance.cameraLight.intensity = 1.4;
        viewer.current = instance;
        draw();
        settle();
        return instance;
      })
      .catch(() => null);

    const observer = new ResizeObserver(() => {
      const instance = viewer.current;
      if (instance && element.clientWidth > 0 && element.clientHeight > 0) {
        instance.setSize(element.clientWidth, element.clientHeight);
        draw();
      }
    });
    observer.observe(element);

    return () => {
      disposed = true;
      if (timer !== null) window.clearInterval(timer);
      element.removeEventListener("kiza:settle", settle);
      document.removeEventListener("visibilitychange", settle);
      observer.disconnect();
      viewer.current?.dispose();
      viewer.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    ready.current?.then(async (instance) => {
      if (!instance || cancelled) return;
      if (skin) {
        await instance.loadSkin(skin, { model: variant === "slim" ? "slim" : "default" }).catch(() => undefined);
      } else {
        instance.loadSkin(null);
      }
      if (!cancelled) instance.render();
    });
    return () => {
      cancelled = true;
    };
  }, [skin, variant]);

  useEffect(() => {
    let cancelled = false;
    ready.current?.then(async (instance) => {
      if (!instance || cancelled) return;
      if (cape) await instance.loadCape(cape).catch(() => undefined);
      else instance.loadCape(null);
      if (!cancelled) instance.render();
    });
    return () => {
      cancelled = true;
    };
  }, [cape]);

  useEffect(() => {
    orbiting.current = view === "orbit";
    ready.current?.then((instance) => {
      if (!instance) return;
      // Dragging turns the figure in every view; only the turntable is
      // the orbit's own.
      instance.controls.enableRotate = true;
      if (view !== "orbit") {
        // A fixed side: the player turns, the camera stays where it was.
        const angle = view === "front" ? 0 : view === "back" ? Math.PI : Math.PI / 2;
        instance.playerWrapper.rotation.y = angle;
        instance.resetCameraPose();
      }
      instance.render();
      host.current?.dispatchEvent(new Event("kiza:settle"));
    });
  }, [view]);

  useEffect(() => {
    ready.current?.then((instance) => {
      if (!instance) return;
      instance.zoom = 0.72 * zoom;
      instance.render();
    });
  }, [zoom]);

  return <div ref={host} className={className} />;
}
