import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTheme, getStoredTheme, themeById, THEMES } from "../../src/lib/theme";
import { BUILT_IN_THEMES } from "../../src/lib/theme/builtin";
import { COLOR_TOKENS } from "../../src/lib/theme/definition";
import { startPainting, useThemeStore } from "../../src/lib/theme/store";

/**
 * Choosing a theme and painting one are two steps now: `applyTheme` says which
 * theme is chosen and the store paints whatever should be on screen, which may
 * be a draft somebody is editing instead. These tests exercise that whole path
 * rather than the engine on its own.
 */
let stopPainting: (() => void) | null = null;

function paintFromTheStore() {
  useThemeStore.setState({ appliedId: "nebula", available: [...BUILT_IN_THEMES], session: null });
  stopPainting?.();
  stopPainting = startPainting();
}

describe("launcher themes", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.removeAttribute("style");
    paintFromTheStore();
  });

  afterEach(() => {
    stopPainting?.();
    stopPainting = null;
  });

  it("offers every theme that ships with Kiza", () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(
      BUILT_IN_THEMES.map((theme) => theme.id),
    );
  });

  /**
   * The swatches on a theme card are read out of the theme rather than written
   * beside it. They used to be hand-converted hex values kept in a second list,
   * which is a copy that can drift from the palette it is supposed to show —
   * and had, by a point or two per channel.
   */
  it.each(BUILT_IN_THEMES.map((theme) => [theme.id] as const))(
    "shows %s its own colours on its card",
    (id) => {
      const theme = themeById(id);
      const card = THEMES.find((entry) => entry.id === id);

      expect(card?.swatches).toEqual([
        `hsl(${theme.colors.background})`,
        `hsl(${theme.colors.primary})`,
        `hsl(${theme.colors.accent})`,
      ]);
    },
  );

  it("persists the selected theme", () => {
    applyTheme("chinese-road");

    expect(document.documentElement.dataset.theme).toBe("chinese-road");
    expect(getStoredTheme()).toBe("chinese-road");
  });

  /**
   * Applying a theme writes its whole palette onto the document. That is the
   * one mechanism: a `.kizatheme` will be painted by this exact call, so a
   * theme that only half-applied would half-apply for everybody.
   */
  it("paints every colour of the theme it applies", () => {
    applyTheme("toxic");
    const painted = document.documentElement.style;
    const toxic = themeById("toxic");

    for (const token of COLOR_TOKENS) {
      expect(painted.getPropertyValue(`--${token}`), token).toBe(toxic.colors[token]);
    }
    expect(painted.getPropertyValue("--kiza-ambient")).toContain("radial-gradient");
  });

  /**
   * Moving between themes must not leave anything of the previous one behind.
   * A property the next theme does not set would otherwise survive, and a bug
   * that only appears after switching twice is close to unrecognisable.
   */
  it("leaves nothing of the last theme behind", () => {
    applyTheme("cyber");
    applyTheme("nebula");

    const painted = document.documentElement.style;
    const nebula = themeById("nebula");
    for (const token of COLOR_TOKENS) {
      expect(painted.getPropertyValue(`--${token}`), token).toBe(nebula.colors[token]);
    }
  });
});

describe("a theme and the settings painted over it", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.theme;
    paintFromTheStore();
  });

  afterEach(() => {
    stopPainting?.();
    stopPainting = null;
  });

  /**
   * Letting go of a custom accent has to put the *current* theme's primary
   * back, not the stylesheet's.
   *
   * While a theme was a stylesheet rule, deleting the inline property revealed
   * it. The engine writes the theme onto the document instead, so deleting now
   * reveals the default dark block that sits under every theme — and would have
   * put Nebula's violet on Cyber, Toxic and Chinese Road.
   */
  it("returns to the theme's own primary when a custom accent is removed", async () => {
    const { applyAppearance, DEFAULT_APPEARANCE } = await import("../../src/lib/appearance");

    applyTheme("cyber");
    const cyan = themeById("cyber").colors.primary;

    applyAppearance({ ...DEFAULT_APPEARANCE, accent: "#ff0000" });
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("0 100% 50%");

    applyAppearance({ ...DEFAULT_APPEARANCE, accent: null });
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(cyan);
    expect(document.documentElement.style.getPropertyValue("--ring")).toBe(
      themeById("cyber").colors.ring,
    );
  });

  it("keeps a custom accent when the theme changes underneath it", async () => {
    const { applyAppearance, DEFAULT_APPEARANCE } = await import("../../src/lib/appearance");

    applyTheme("nebula");
    applyAppearance({ ...DEFAULT_APPEARANCE, accent: "#ff0000" });
    applyTheme("toxic");
    applyAppearance({ ...DEFAULT_APPEARANCE, accent: "#ff0000" });

    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("0 100% 50%");
    // and the rest of Toxic came with it
    expect(document.documentElement.style.getPropertyValue("--background")).toBe(
      themeById("toxic").colors.background,
    );
  });
});
