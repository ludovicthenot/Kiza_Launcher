import { useEffect, useRef } from "react";
import type { SkinViewer } from "skinview3d";
import type { SkinVariant } from "../../lib/skinQueries";

export type SkinView = "orbit" | "front" | "side" | "back";

/**
 * The player in three dimensions, drawn by skinview3d.
 *
 * The library is loaded on first use rather than with the launcher: it
 * carries a WebGL renderer, and every page that is not this one should not
 * pay for it. A page that has no WebGL (a test, a headless preview) shows
 * nothing rather than throwing — the texture is still there in the library
 * strip below.
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

  // One viewer per mount, sized to its box and resized with it.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full";
    element.appendChild(canvas);

    ready.current = import("skinview3d")
      .then(({ SkinViewer, IdleAnimation }) => {
        if (disposed) return null;
        const instance = new SkinViewer({
          canvas,
          width: element.clientWidth || 320,
          height: element.clientHeight || 360,
          pixelRatio: "match-device",
          fov: 55,
          zoom: 0.72,
          renderPaused: false,
        });
        instance.animation = new IdleAnimation();
        instance.autoRotateSpeed = 0.8;
        instance.controls.enablePan = false;
        instance.controls.enableZoom = false;
        instance.globalLight.intensity = 2.6;
        instance.cameraLight.intensity = 1.4;
        viewer.current = instance;
        return instance;
      })
      .catch(() => null);

    const observer = new ResizeObserver(() => {
      const instance = viewer.current;
      if (instance && element.clientWidth > 0 && element.clientHeight > 0) {
        instance.setSize(element.clientWidth, element.clientHeight);
      }
    });
    observer.observe(element);

    return () => {
      disposed = true;
      observer.disconnect();
      viewer.current?.dispose();
      viewer.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    ready.current?.then((instance) => {
      if (!instance || cancelled) return;
      if (skin) {
        instance.loadSkin(skin, { model: variant === "slim" ? "slim" : "default" }).catch(() => undefined);
      } else {
        instance.loadSkin(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [skin, variant]);

  useEffect(() => {
    let cancelled = false;
    ready.current?.then((instance) => {
      if (!instance || cancelled) return;
      if (cape) instance.loadCape(cape).catch(() => undefined);
      else instance.loadCape(null);
    });
    return () => {
      cancelled = true;
    };
  }, [cape]);

  useEffect(() => {
    ready.current?.then((instance) => {
      if (!instance) return;
      instance.autoRotate = view === "orbit";
      instance.controls.enableRotate = view === "orbit";
      if (view !== "orbit") {
        // A fixed side: the player turns, the camera stays where it was.
        const angle = view === "front" ? 0 : view === "back" ? Math.PI : Math.PI / 2;
        instance.playerWrapper.rotation.y = angle;
        instance.resetCameraPose();
      } else {
        instance.playerWrapper.rotation.y = 0;
      }
    });
  }, [view]);

  useEffect(() => {
    ready.current?.then((instance) => {
      if (instance) instance.zoom = 0.72 * zoom;
    });
  }, [zoom]);

  return <div ref={host} className={className} />;
}
