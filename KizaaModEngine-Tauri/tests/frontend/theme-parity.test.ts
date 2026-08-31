import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BUILT_IN_THEMES } from "../../src/lib/theme/builtin";
import { COLOR_TOKENS } from "../../src/lib/theme/definition";
import { ambientImage, themeVariables } from "../../src/lib/theme/engine";

/**
 * The four bundled themes must render exactly as they did before the engine.
 *
 * Moving Nebula, Cyber, Toxic and Chinese Road out of the stylesheet and into
 * data is a migration, not a redesign. The fixture beside this file is a
 * machine-made record of every value those four rules held in `App.css` on the
 * day they were moved, and this compares what the engine produces against it.
 *
 * A change to any of the four is not forbidden — it just cannot happen by
 * accident. Deliberately restyling one means changing the fixture in the same
 * commit, which is a line in a diff somebody has to write on purpose.
 */

const before = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "fixtures", "theme-tokens-before-migration.json"),
    "utf8",
  ),
) as {
  light: Record<string, string>;
  themes: Record<
    string,
    { colors: Record<string, string>; ambient: { color: string; alpha: number }[] }
  >;
};

describe("the themes that ship with Kiza", () => {
  it("still has all four, and no others", () => {
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual([
      "nebula",
      "cyber",
      "toxic",
      "chinese-road",
    ]);
    expect(Object.keys(before.themes).sort()).toEqual(
      BUILT_IN_THEMES.map((theme) => theme.id).sort(),
    );
  });

  it.each(BUILT_IN_THEMES.map((theme) => [theme.id, theme] as const))(
    "paints %s with the values it had in the stylesheet",
    (id, theme) => {
      const original = before.themes[id];
      expect(original, `no record of ${id} before the migration`).toBeDefined();

      const painted = themeVariables(theme);
      for (const token of COLOR_TOKENS) {
        expect(painted[`--${token}`], `${id} / ${token}`).toBe(original.colors[token]);
      }
    },
  );

  it.each(BUILT_IN_THEMES.map((theme) => [theme.id, theme] as const))(
    "keeps the glow behind %s",
    (id, theme) => {
      const original = before.themes[id];
      const image = ambientImage(theme);

      for (const stop of original.ambient) {
        expect(image, `${id} lost a glow stop`).toContain(`hsl(${stop.color} / ${stop.alpha})`);
      }
      // The geometry was the same for all four and has to stay that way, or the
      // glow moves when a theme changes.
      expect(image).toContain("60rem 32rem at 12% -12%");
      expect(image).toContain("48rem 28rem at 108% 8%");
    },
  );

  /**
   * Every theme sets every colour. A theme missing one would fall through to
   * whatever the last theme left behind, which is a bug that only appears after
   * switching themes and is close to impossible to recognise as one.
   */
  it.each(BUILT_IN_THEMES.map((theme) => [theme.id, theme] as const))(
    "%s leaves no colour to chance",
    (_id, theme) => {
      for (const token of COLOR_TOKENS) {
        expect(theme.colors[token], token).toMatch(/\S/);
      }
      expect(Object.keys(theme.colors).sort()).toEqual([...COLOR_TOKENS].sort());
    },
  );

  /**
   * The stylesheet still has to carry a full set of defaults for the first
   * paint, before any JavaScript has run. Without them the window opens white
   * and then flips.
   */
  it("still has a stylesheet default for every colour the engine writes", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "src", "App.css"),
      "utf8",
    );
    const darkBlock = css.slice(css.indexOf(".dark {"), css.indexOf("}", css.indexOf(".dark {")));

    for (const token of COLOR_TOKENS) {
      expect(darkBlock, `App.css has no boot value for --${token}`).toContain(`--${token}:`);
    }
  });
});
