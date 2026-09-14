import { describe, expect, it } from "vitest";
import { detectVariant, frontParts, pngDataUrl } from "../../src/lib/skinTexture";

/** A blank texture with alpha 255 everywhere except the given regions. */
function texture(width: number, height: number, clear: Array<[number, number, number, number]>) {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x, y, w, h] of clear) {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        pixels[(row * width + col) * 4 + 3] = 0;
      }
    }
  }
  return pixels;
}

describe("skin textures", () => {
  it("reads slim arms from the strips a three-pixel arm never paints", () => {
    const classic = texture(64, 64, []);
    expect(detectVariant(classic, 64, 64)).toBe("classic");

    const slim = texture(64, 64, [
      [50, 16, 2, 4],
      [54, 20, 2, 12],
      [42, 48, 2, 4],
      [46, 52, 2, 12],
    ]);
    expect(detectVariant(slim, 64, 64)).toBe("slim");

    // Only the right arm cleared: a classic skin with a hole, not a slim one.
    const half = texture(64, 64, [
      [50, 16, 2, 4],
      [54, 20, 2, 12],
    ]);
    expect(detectVariant(half, 64, 64)).toBe("classic");
  });

  it("a 64x32 skin has no left arm to check", () => {
    const slim = texture(64, 32, [
      [50, 16, 2, 4],
      [54, 20, 2, 12],
    ]);
    expect(detectVariant(slim, 64, 32)).toBe("slim");
    expect(detectVariant(texture(128, 128, []), 128, 128)).toBe("classic");
  });

  it("lays the figure out sixteen wide and thirty-two tall", () => {
    for (const [legacy, slim] of [
      [false, false],
      [false, true],
      [true, false],
    ] as const) {
      const parts = frontParts(legacy, slim);
      const right = Math.max(...parts.map((p) => p.at[0] + p.base[2]));
      const bottom = Math.max(...parts.map((p) => p.at[1] + p.base[3]));
      expect(right).toBe(16 - (slim ? 1 : 0));
      expect(bottom).toBe(32);
      // Nothing reads outside the texture.
      for (const part of parts) {
        for (const rect of [part.base, part.overlay]) {
          if (!rect) continue;
          expect(rect[0] + rect[2]).toBeLessThanOrEqual(64);
          expect(rect[1] + rect[3]).toBeLessThanOrEqual(legacy ? 32 : 64);
        }
      }
    }
    // The old layout mirrors the right limbs; the new one has its own.
    expect(frontParts(true, false).filter((p) => p.mirror)).toHaveLength(2);
    expect(frontParts(false, false).filter((p) => p.mirror)).toHaveLength(0);
    expect(frontParts(false, false).every((p) => p.overlay)).toBe(true);
  });

  it("wraps base64 as a PNG data URL", () => {
    expect(pngDataUrl("AAAA")).toBe("data:image/png;base64,AAAA");
  });
});
