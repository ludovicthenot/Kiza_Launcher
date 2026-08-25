import { describe, expect, it } from "vitest";
import { hexToHsl, hslToHex, isHex, normaliseHex } from "../../src/lib/colour";

describe("reading a hex colour", () => {
  it("reads the primaries", () => {
    expect(hexToHsl("#ff0000")).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl("#00ff00")).toEqual({ h: 120, s: 100, l: 50 });
    expect(hexToHsl("#0000ff")).toEqual({ h: 240, s: 100, l: 50 });
  });

  it("accepts the short form and a missing hash", () => {
    expect(hexToHsl("#f00")).toEqual(hexToHsl("#ff0000"));
    expect(hexToHsl("ff0000")).toEqual(hexToHsl("#ff0000"));
  });

  it("gives a grey no hue", () => {
    // Otherwise the picker's hue bar jumps somewhere arbitrary the moment
    // someone drags the pad into the white corner.
    expect(hexToHsl("#ffffff")).toEqual({ h: 0, s: 0, l: 100 });
    expect(hexToHsl("#000000")).toEqual({ h: 0, s: 0, l: 0 });
  });

  it("refuses what is not a colour", () => {
    expect(hexToHsl("")).toBeNull();
    expect(hexToHsl("#12345")).toBeNull();
    expect(hexToHsl("rebeccapurple")).toBeNull();
  });
});

describe("writing a hex colour", () => {
  it("writes the primaries", () => {
    expect(hslToHex(0, 100, 50)).toBe("#FF0000");
    expect(hslToHex(120, 100, 50)).toBe("#00FF00");
    expect(hslToHex(240, 100, 50)).toBe("#0000FF");
  });

  it("clamps rather than refusing values outside their range", () => {
    // The pad clamps its own output, but a hue that wrapped past 360 during a
    // drag must land somewhere sensible rather than producing "#NaNNaNNaN".
    expect(hslToHex(360, 100, 50)).toBe("#FF0000");
    expect(hslToHex(-60, 100, 50)).toBe(hslToHex(300, 100, 50));
    expect(hslToHex(0, 500, 50)).toBe("#FF0000");
    expect(hslToHex(0, 100, -10)).toBe("#000000");
  });
});

describe("the round trip", () => {
  // A conversion that loses a degree each way turns into an accent that drifts
  // every time the picker is reopened.
  const colours = ["#8B5CF6", "#3B82F6", "#06B6D4", "#22C55E", "#F59E0B", "#EF4444", "#EC4899"];

  it.each(colours)("survives %s", (hex) => {
    const hsl = hexToHsl(hex)!;
    const back = hslToHex(hsl.h, hsl.s, hsl.l);
    // Rounding to whole degrees and percents costs at most a step per channel.
    const original = hexToHsl(hex)!;
    const returned = hexToHsl(back)!;
    expect(Math.abs(returned.h - original.h)).toBeLessThanOrEqual(1);
    expect(Math.abs(returned.s - original.s)).toBeLessThanOrEqual(1);
    expect(Math.abs(returned.l - original.l)).toBeLessThanOrEqual(1);
  });

  it("does not drift when repeated", () => {
    // Opening the picker ten times must not walk the colour away.
    let hex = "#EC4899";
    for (let index = 0; index < 10; index += 1) {
      const hsl = hexToHsl(hex)!;
      hex = hslToHex(hsl.h, hsl.s, hsl.l);
    }
    const first = hexToHsl("#EC4899")!;
    const last = hexToHsl(hex)!;
    expect(Math.abs(last.h - first.h)).toBeLessThanOrEqual(1);
    expect(Math.abs(last.s - first.s)).toBeLessThanOrEqual(1);
    expect(Math.abs(last.l - first.l)).toBeLessThanOrEqual(1);
  });
});

describe("normalising what someone typed", () => {
  it("expands, upper-cases and adds the hash", () => {
    expect(normaliseHex("f00")).toBe("#FF0000");
    expect(normaliseHex("#ec4899")).toBe("#EC4899");
    expect(normaliseHex("  #EC4899  ")).toBe("#EC4899");
  });

  it("returns nothing for a half-typed colour", () => {
    // The field applies as it is typed; "#EC48" must not reach the stylesheet.
    expect(normaliseHex("#EC48")).toBeNull();
    expect(isHex("#EC48")).toBe(false);
  });
});
