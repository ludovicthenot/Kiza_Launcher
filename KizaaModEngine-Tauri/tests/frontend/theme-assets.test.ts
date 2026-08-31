import { beforeEach, describe, expect, it } from "vitest";
import { assetUrl, ASSET_LIMITS, ASSET_MIME_TYPES } from "../../src/lib/theme/assets";
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
