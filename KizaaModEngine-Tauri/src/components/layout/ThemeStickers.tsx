/**
 * A theme's decorations: snow on the library, a garland over the title, a
 * pumpkin in a corner.
 *
 * Each one is a picture or an animated GIF/WebP the theme carries in a slot of
 * its own (`sticker-1` … `sticker-12`), drawn over the launcher and placed
 * like any other element under the part `sticker.N`: moved, sized, turned,
 * put in front or behind, hidden, or shown on one page only. They start in
 * the middle of the window, at a modest size, and the designer drags them
 * where they belong.
 *
 * They never take a click: a decoration over a button must not stop the
 * button working. While the Maker's pick tool is on they can be pointed at
 * (`html[data-kiza-picking]`), which is the only time anybody needs to.
 */

import { useEffect, useSyncExternalStore } from "react";
import { useAppStore } from "../../lib/store";
import { activeTheme, subscribe } from "../../lib/theme/engine";
import { STICKER_SLOTS, stickerPart, type StickerSlot } from "../../lib/theme/definition";
import { part } from "../../lib/theme/parts";

/** The decorations of the theme on screen, as `slot url` lines. */
function stickers(): string {
  const assets = activeTheme()?.assets ?? {};
  return STICKER_SLOTS.filter((slot) => assets[slot])
    .map((slot) => `${slot} ${assets[slot]}`)
    .join("\n");
}

export function ThemeStickers() {
  const list = useSyncExternalStore(subscribe, stickers, () => "");
  const page = useAppStore((state) =>
    state.showSettings
      ? "settings"
      : state.selectedInstanceId
        ? "instance"
        : state.libraryMode === "host"
          ? "servers"
          : "library",
  );

  // Which page is on screen, for decorations that only belong on one.
  useEffect(() => {
    document.documentElement.dataset.kizaPage = page;
  }, [page]);

  if (!list) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {list.split("\n").map((line) => {
        const [slot, url] = line.split(" ") as [StickerSlot, string];
        return (
          <img
            key={slot}
            {...part(stickerPart(slot))}
            src={url}
            alt=""
            draggable={false}
            className="kiza-sticker absolute left-1/2 top-[45%] w-40 max-w-none -translate-x-1/2 -translate-y-1/2 select-none"
          />
        );
      })}
    </div>
  );
}
