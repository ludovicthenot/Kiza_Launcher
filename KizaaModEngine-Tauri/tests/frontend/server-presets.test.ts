import { describe, expect, it } from "vitest";
import { MINECRAFT_LOADER_LABELS } from "../../src/lib/minecraftLoaders";
import { SERVER_PRESETS, presetById } from "../../src/lib/serverPresets";

describe("the Host page's presets", () => {
  it("each name a loader the launcher can install", () => {
    for (const preset of SERVER_PRESETS) {
      expect(Object.keys(MINECRAFT_LOADER_LABELS)).toContain(preset.loader);
    }
  });

  it("are told apart by id, which is what a server remembers", () => {
    const ids = SERVER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(presetById("modded")?.loader).toBe("neoforge");
    expect(presetById("nope")).toBeUndefined();
    expect(presetById(null)).toBeUndefined();
  });

  it("fill the reference grid: three narrow cards, then two wide", () => {
    // Six columns: 2+2+2 on the first row, 3+3 on the second.
    const widths = SERVER_PRESETS.map((preset) => (preset.wide ? 3 : 2));
    expect(widths).toEqual([2, 2, 2, 3, 3]);
  });
});
