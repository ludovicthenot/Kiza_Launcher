import { describe, expect, it } from "vitest";
import { layoutStylesheet } from "../../src/lib/theme/parts";
import { stateStylesheet, themeVariables } from "../../src/lib/theme/engine";
import { BUILT_IN_THEMES } from "../../src/lib/theme/builtin";
import { isComponentValue, isPlacementValue } from "../../src/lib/theme/values";

describe("theme values", () => {
  it("never writes a placement that is not a number into the stylesheet", () => {
    const css = layoutStylesheet({
      "library.title": { x: "0px}*{background:url(https://example.com/x)}x{", y: "12px" },
    });
    expect(css).not.toContain("url(");
    expect(css).not.toContain("}*{");
    expect(css).toContain("translate:0px 12px");
  });

  it("accepts the shapes the Maker writes and refuses the rest", () => {
    expect(isPlacementValue("x", "-12px")).toBe(true);
    expect(isPlacementValue("rotate", "15deg")).toBe(true);
    expect(isPlacementValue("scale", "1.250")).toBe(true);
    expect(isPlacementValue("x", "1e9px")).toBe(false);
    expect(isPlacementValue("size", "2px;color:red")).toBe(false);
    expect(isPlacementValue("hidden", "yes")).toBe(false);
  });

  it("puts a part on a layer, never behind the window's background", () => {
    expect(layoutStylesheet({ "library.title": { layer: "3" } })).toContain("z-index:33");
    expect(layoutStylesheet({ "library.title": { layer: "-9" } })).toContain("z-index:-9");
    expect(layoutStylesheet({ "library.title": { x: "10px" } })).toContain("z-index:30");
    expect(layoutStylesheet({ "library.title": { layer: "-10" } })).toBe("");
    expect(layoutStylesheet({ "library.footer": { layer: "2" } })).toContain(":not(.sticky)");
  });

  it("does not hide what people need", () => {
    expect(layoutStylesheet({ "library.create": { hidden: "true" } })).toBe("");
    expect(layoutStylesheet({ "library.title": { hidden: "true" } })).toContain("display:none");
  });

  it("only sets component variables the launcher offers, with values of a known shape", () => {
    expect(isComponentValue("card", "radius", "20px")).toBe(true);
    expect(isComponentValue("backdrop", "waves", "off")).toBe(true);
    expect(isComponentValue("danger", "scale", "0")).toBe(false);
    expect(isComponentValue("card", "radius", "url(https://example.com)")).toBe(false);

    const theme = {
      ...BUILT_IN_THEMES[0],
      components: { card: { radius: "20px", glow: "url(x)" }, text: { scale: "0" } },
    };
    const variables = themeVariables(theme);
    expect(variables["--kiza-card-radius"]).toBe("20px");
    expect(variables["--kiza-card-glow"]).toBeUndefined();
    expect(variables["--kiza-text-scale"]).toBeUndefined();
  });

  it("turns text, layout and motion words into CSS, and nothing else", () => {
    const theme = {
      ...BUILT_IN_THEMES[0],
      components: {
        text: { font: "georgia", "title-weight": "800", scale: "0" },
        layout: { sidebar: "right", "card-width": "240px", spacing: "compact" },
      },
    };
    const variables = themeVariables(theme);
    expect(variables["--kiza-font"]).toContain("Georgia");
    expect(variables["--kiza-title-weight"]).toBe("800");
    expect(variables["--kiza-sidebar-order"]).toBe("2");
    expect(variables["--kiza-card-width"]).toBe("240px");
    expect(variables["--kiza-library-gap-x"]).toBe("12px");
    expect(variables["--kiza-text-scale"]).toBeUndefined();
    expect(variables["--kiza-text-font"]).toBeUndefined();
  });

  it("draws a hover only for a state the theme set", () => {
    expect(stateStylesheet(BUILT_IN_THEMES[0])).toBe("");
    const css = stateStylesheet({
      ...BUILT_IN_THEMES[0],
      components: { secondary: { hover: "200 50% 30%" }, card: { lift: "6px" }, action: { hover: "url(x)" } },
    });
    expect(css).toContain(".kiza-secondary:hover");
    expect(css).toContain("translate:0 -6px");
    expect(css).not.toContain("url(");
  });
});
