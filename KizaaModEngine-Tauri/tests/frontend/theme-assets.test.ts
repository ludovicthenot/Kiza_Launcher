import { beforeEach, describe, expect, it } from "vitest";
import {
  assetUrl,
  ASSET_LIMITS,
  ASSET_MIME_TYPES,
  isMotionAsset,
  VIDEO_MIME_TYPES,
} from "../../src/lib/theme/assets";
import { readFileSync } from "node:fs";
import { applyTheme as paint } from "../../src/lib/theme/engine";
import { themeById } from "../../src/lib/theme";
import type { ThemeDefinition } from "../../src/lib/theme/definition";

/**
 * A picture is asked for by slot, and the resolver decides where it comes from.
 *
 * The point is that a component drawing a logo cannot tell whether it got the
 * one bundled with Kiza or one a theme brought — the same property the colours
 * have. Without it, a theme could only replace the pictures somebody had
 * remembered to make replaceable.
 */
describe("theme assets", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    paint(themeById("nebula"));
  });

  it("falls back to what Kiza ships when a theme replaces nothing", () => {
    expect(assetUrl("logo")).toBeTruthy();
    // Nothing in the bundle for this slot, and no theme offering one.
    expect(assetUrl("background")).toBeUndefined();
  });

  it("takes the theme's picture when there is one", () => {
    const bundled = assetUrl("logo");
    const themed: ThemeDefinition = {
      ...themeById("nebula"),
      id: "themed",
      assets: { logo: "blob:kiza/logo", background: "blob:kiza/background" },
    };

    paint(themed);
    expect(assetUrl("logo")).toBe("blob:kiza/logo");
    expect(assetUrl("background")).toBe("blob:kiza/background");

    // And gives it back when a theme without one is applied, rather than
    // leaving the last theme's picture behind.
    paint(themeById("cyber"));
    expect(assetUrl("logo")).toBe(bundled);
    expect(assetUrl("background")).toBeUndefined();
  });

  /**
   * The ceilings are the reason a theme cannot make the launcher heavy. They
   * are enforced in Rust, where a `.kizatheme` is opened; these are the same
   * numbers, and `kizatheme.rs` has a test that reads this file so the two
   * cannot drift into disagreeing about what a valid theme is.
   */
  it("keeps a ceiling on what a theme may weigh", () => {
    expect(ASSET_LIMITS.maxBytes).toBeLessThanOrEqual(ASSET_LIMITS.maxTotalBytes);
    // An animation costs while it is on screen, not once, so it gets less room.
    expect(ASSET_LIMITS.maxAnimatedBytes).toBeLessThan(ASSET_LIMITS.maxBytes);
    expect(ASSET_LIMITS.maxAnimatedDimension).toBeLessThan(ASSET_LIMITS.maxDimension);
  });

  it("accepts the still and animated formats a designer actually has", () => {
    expect(ASSET_MIME_TYPES).toContain("image/png");
    expect(ASSET_MIME_TYPES).toContain("image/webp");
    expect(ASSET_MIME_TYPES).toContain("image/gif");
    // SVG is absent on purpose: it is a document that can carry script and
    // fetch remote things, and a theme is not allowed to do either.
    expect(ASSET_MIME_TYPES as readonly string[]).not.toContain("image/svg+xml");
  });
});

/**
 * The background slot was in the format, in the archive reader and in the
 * Maker's asset list, and nothing drew it: a designer could choose a picture,
 * watch it stage, export it, and never see it anywhere. These hold the layer
 * that draws it in place.
 */
describe("the background a theme brings", () => {
  it("is drawn behind the launcher", () => {
    const backdrop = readFileSync("src/components/layout/ThemeBackdrop.tsx", "utf8");
    expect(backdrop).toContain('useThemeAsset("background")');
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain("<ThemeBackdrop />");
  });

  it("tells a moving background from a still one by its address", () => {
    expect(isMotionAsset("http://asset.localhost/C%3A/themes/background-17.webm")).toBe(true);
    expect(isMotionAsset("http://asset.localhost/C%3A/themes/background-17.mp4")).toBe(true);
    expect(isMotionAsset("/assets/kiza-header.png")).toBe(false);
    // An animated GIF is still a picture: an <img> plays it.
    expect(isMotionAsset("/assets/loop.gif")).toBe(false);
  });

  it("stops a video that nobody is looking at", () => {
    const backdrop = readFileSync("src/components/layout/ThemeBackdrop.tsx", "utf8");
    expect(backdrop).toContain("visibilitychange");
    // "Reduce motion" cannot mean everything except the largest moving thing
    // on screen.
    expect(backdrop).toContain("data-animations");
  });

  it("lets the window load one at all", () => {
    // `convertFileSrc` serves from http://asset.localhost on Windows, and a
    // video is governed by media-src, not img-src. Without this the picture
    // works and the video is blocked with nothing said.
    const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const csp: string = config.app.security.csp;
    const media = csp.split(";").find((rule) => rule.trim().startsWith("media-src")) ?? "";
    for (const source of ["http://asset.localhost", "'self'"]) {
      expect(media, "media-src is missing " + source).toContain(source);
    }
    expect(VIDEO_MIME_TYPES.length).toBeGreaterThan(0);
  });
});
