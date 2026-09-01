/**
 * What the three editions share, and what they are allowed to differ in.
 *
 * An edition is a configuration overlay merged over `tauri.conf.json` with
 * `--config`. The merge deep-merges objects and *replaces* arrays, and
 * `app.windows` is an array — so an overlay naming only the window title does
 * not rename the window, it replaces it, and everything the base said about
 * that window is gone.
 *
 * It is not a subtle failure once you have seen it: the Maker opened with a
 * native Windows title bar above Kiza's own, at a size nobody chose, with no
 * minimum. It is subtle before, because nothing warns and the launcher still
 * runs. So the overlays repeat the whole window, and this holds them to it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => JSON.parse(readFileSync(`src-tauri/${name}`, "utf8"));

const base = read("tauri.conf.json");
const editions = [
  { file: "tauri.maker.conf.json", title: "Kiza Maker", identifier: "com.kizamods.maker" },
  {
    file: "tauri.experimental.conf.json",
    title: "Kiza Experimental",
    identifier: "com.kizamods.experimental",
  },
];

describe("every edition opens the same window", () => {
  for (const edition of editions) {
    it(`${edition.title} differs from Stable only in its title`, () => {
      const overlay = read(edition.file);
      const window = overlay.app?.windows?.[0];
      expect(window, "the overlay must repeat the whole window, not just a title").toBeDefined();

      expect(window.title).toBe(edition.title);
      for (const [key, value] of Object.entries(base.app.windows[0])) {
        if (key === "title") continue;
        expect(window[key], `${edition.file} lost ${key}`).toEqual(value);
      }
      // And nothing invented along the way.
      expect(Object.keys(window).sort()).toEqual(Object.keys(base.app.windows[0]).sort());
    });

    /**
     * Separate identities, so Windows treats them as separate applications:
     * their own data folder, their own shortcut, their own uninstall entry,
     * and a single-instance lock that does not collide with Stable's.
     */
    it(`${edition.title} is its own application`, () => {
      const overlay = read(edition.file);
      expect(overlay.identifier).toBe(edition.identifier);
      expect(overlay.identifier).not.toBe(base.identifier);
      expect(overlay.productName).toBe(edition.title);
    });

    /**
     * An edition asks its own update channel, and never the release feed a
     * Stable user follows: a Maker build must not be able to hand somebody a
     * Stable update, or the other way round.
     */
    it(`${edition.title} does not follow the Stable release feed`, () => {
      const overlay = read(edition.file);
      const endpoints: string[] = overlay.plugins.updater.endpoints;
      expect(endpoints.length).toBeGreaterThan(0);
      expect(endpoints.some((endpoint) => endpoint.includes("github.com"))).toBe(false);
    });
  }
});
