import { describe, expect, it } from "vitest";
import { layoutStylesheet } from "../../src/lib/theme/parts";
import { themeVariables } from "../../src/lib/theme/engine";
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

  it("does not hide what people need", () => {
    expect(layoutStylesheet({ "library.create": { hidden: "true" } })).toBe("");
    expect(layoutStylesheet({ "library.title": { hidden: "true" } })).toContain("display:none");
  });

  it("only sets component variables the launcher offers, with values of a known shape", () => {
    expect(isComponentValue("card", "radius", "20px")).toBe(true);
    expect(isComponentValue("backdrop", "waves", "off")).toBe(true);
    expect(isComponentValue("text", "scale", "0")).toBe(false);
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
});
