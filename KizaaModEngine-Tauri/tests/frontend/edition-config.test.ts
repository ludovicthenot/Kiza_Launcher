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

/**
 * The pictures a theme brings with it are served by Tauri's asset protocol,
 * and on Windows that protocol answers on `http://asset.localhost` rather than
 * on an `asset:` URL. The `asset:` keyword in a policy does not cover it, and
 * neither does `https:` — so with only those two, every picture a designer
 * chose was blocked before it could be drawn, with nothing in the interface to
 * say why. It cost a build to find; this is here so it costs nobody another.
 */
describe("what the window is allowed to load", () => {
  it("lets the asset protocol's own host serve pictures", () => {
    const config = read("tauri.conf.json");
    const csp: string = config.app.security.csp;
    const images = csp
      .split(";")
      .map((part: string) => part.trim())
      .find((part: string) => part.startsWith("img-src"));

    expect(images).toBeDefined();
    expect(images).toContain("asset:");
    expect(images).toContain("http://asset.localhost");
  });

  /** And the protocol is only allowed to read the launcher's own themes. */
  it("keeps the asset protocol pointed at the theme folder", () => {
    const config = read("tauri.conf.json");
    expect(config.app.security.assetProtocol.enable).toBe(true);
    expect(config.app.security.assetProtocol.scope).toEqual(["$APPDATA/themes/**"]);
  });
});

/**
 * An edition is named in four places: the bundler's environment variable, the
 * interface's own constant, the Rust crate, and the folder its releases are
 * handed out from. They have to agree — a build that calls itself `maker` and
 * files itself under `stable` would put the launcher with the theme tools in
 * it in front of somebody who asked for the launcher.
 */
describe("the editions, named the same everywhere", () => {
  it("agrees between the release folders and the interface", async () => {
    const { EDITIONS } = await import("../../scripts/channels.mjs");
    const source = readFileSync("src/lib/edition.ts", "utf8");

    for (const name of EDITIONS) {
      expect(source, `the interface has no edition "${name}"`).toContain(`"${name}"`);
    }
    // And the interface knows of no edition the releases have no home for.
    const declared = /export type Edition =([^;]+);/.exec(source)?.[1] ?? "";
    const named = [...declared.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
    expect(named.sort()).toEqual([...EDITIONS].sort());
  });

  it("puts each edition's releases in its own folder", async () => {
    const { releaseDir, EDITIONS } = await import("../../scripts/channels.mjs");
    const { sep } = await import("node:path");
    const folders = EDITIONS.map((name: string) =>
      releaseDir("/somewhere/project", "1.2.3", name).split(sep).join("/"),
    );

    // Compared by their tail: `path.resolve` puts a drive letter on the front
    // on Windows and does not on anything else, and neither is the point.
    expect(folders.map((folder: string) => folder.split("/").slice(-3).join("/"))).toEqual([
      "releases/stable/1.2.3",
      "releases/maker/1.2.3",
      "releases/experimental/1.2.3",
    ]);
    // Beside the project, never inside it.
    for (const folder of folders) expect(folder).not.toContain("/project/");
  });
});
