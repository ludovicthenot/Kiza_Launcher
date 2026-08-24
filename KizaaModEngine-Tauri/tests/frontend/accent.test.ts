import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  foregroundFor,
  hexToHslTriple,
  normalise,
} from "../../src/lib/appearance";

describe("turning a hex into what the stylesheet expects", () => {
  it("produces a bare H S% L% triple, not a finished colour", () => {
    // The theme variables hold bare numbers so Tailwind can build
    // `hsl(var(--primary) / 0.5)` from them. A finished `hsl(...)` here would
    // break every translucent use of the accent while the solid ones looked
    // perfectly fine.
    expect(hexToHslTriple("#8B5CF6")).toMatch(/^\d+ \d+% \d+%$/);
  });

  it("converts the primaries correctly", () => {
    expect(hexToHslTriple("#ff0000")).toBe("0 100% 50%");
    expect(hexToHslTriple("#00ff00")).toBe("120 100% 50%");
    expect(hexToHslTriple("#0000ff")).toBe("240 100% 50%");
  });

  it("accepts the short form and the missing hash", () => {
    expect(hexToHslTriple("#f00")).toBe("0 100% 50%");
    expect(hexToHslTriple("ff0000")).toBe("0 100% 50%");
    expect(hexToHslTriple("  #F00  ")).toBe("0 100% 50%");
  });

  it("gives a grey no hue rather than an arbitrary one", () => {
    // Otherwise the hue jumps somewhere random the moment someone picks white.
    expect(hexToHslTriple("#ffffff")).toBe("0 0% 100%");
    expect(hexToHslTriple("#000000")).toBe("0 0% 0%");
    expect(hexToHslTriple("#808080")).toBe("0 0% 50%");
  });

  it("refuses anything that is not a colour", () => {
    expect(hexToHslTriple("")).toBeNull();
    expect(hexToHslTriple("purple")).toBeNull();
    expect(hexToHslTriple("#12345")).toBeNull();
    expect(hexToHslTriple("#gggggg")).toBeNull();
  });
});

describe("choosing readable text for an accent", () => {
  it("puts dark text on a light accent and light text on a dark one", () => {
    expect(foregroundFor("#FFFFFF")).toBe("0 0% 8%");
    expect(foregroundFor("#000000")).toBe("0 0% 100%");
  });

  it("uses luminance rather than lightness", () => {
    // A saturated yellow and a saturated blue share an HSL lightness of 50%
    // and need opposite text on top of them.
    expect(foregroundFor("#FFFF00")).toBe("0 0% 8%");
    expect(foregroundFor("#0000FF")).toBe("0 0% 100%");
  });

  it("falls back to white rather than failing on a bad value", () => {
    expect(foregroundFor("nonsense")).toBe("0 0% 100%");
  });
});

describe("reading a stored accent", () => {
  it("keeps a real colour", () => {
    expect(normalise({ accent: "#22C55E" }).accent).toBe("#22C55E");
  });

  it("drops one that is not a colour", () => {
    // The preferences survive upgrades and are editable by hand; a bad value
    // must fall back to the theme rather than blank the interface.
    expect(normalise({ accent: "chartreuse" }).accent).toBeNull();
    expect(normalise({ accent: 42 }).accent).toBeNull();
  });

  it("defaults to following the theme", () => {
    expect(normalise({}).accent).toBeNull();
    expect(DEFAULT_APPEARANCE.accent).toBeNull();
  });
});
