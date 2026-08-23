import { beforeEach, describe, expect, it } from "vitest";
import {
  applyAppearance,
  DEFAULT_APPEARANCE,
  effectiveEffects,
  getStoredAppearance,
  normalise,
} from "../../src/lib/appearance";

describe("appearance preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-density");
    document.documentElement.className = "";
  });

  it("repairs values that would make the interface unusable", () => {
    // The file is editable and survives upgrades, so an out-of-range value
    // must not be able to produce two-pixel text or a broken layout.
    expect(normalise({ textScale: 900 }).textScale).toBe(130);
    expect(normalise({ textScale: 1 }).textScale).toBe(85);
    expect(normalise({ radius: -40 }).radius).toBe(0);
    expect(normalise({ radius: 999 }).radius).toBe(20);
    expect(normalise({ density: "enormous" }).density).toBe("comfortable");
    expect(normalise({ scheme: "sepia" }).scheme).toBe("dark");
    expect(normalise(null)).toEqual(DEFAULT_APPEARANCE);
  });

  it("keeps the individual effects while they are overridden", () => {
    const appearance = {
      ...DEFAULT_APPEARANCE,
      animations: true,
      translucency: false,
      reduceEffects: true,
    };

    // Everything is off while the override is on...
    expect(effectiveEffects(appearance)).toEqual({
      animations: false,
      translucency: false,
      backgroundBlur: false,
    });

    // ...but the choices underneath survive it, so turning the override off
    // restores what the user had rather than a blanket "all on".
    expect(effectiveEffects({ ...appearance, reduceEffects: false })).toEqual({
      animations: true,
      translucency: false,
      backgroundBlur: true,
    });
  });

  it("writes the preferences where the stylesheet reads them", () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, density: "compact", textScale: 120, radius: 4 });

    const root = document.documentElement;
    expect(root.dataset.density).toBe("compact");
    expect(root.style.getPropertyValue("--kiza-text-scale")).toBe("1.2");
    expect(root.style.getPropertyValue("--radius")).toBe("4px");
    expect(root.classList.contains("dark")).toBe(true);
  });

  it("switches to a light interface only when asked", () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, scheme: "light" });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    applyAppearance({ ...DEFAULT_APPEARANCE, scheme: "dark" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("survives storage that cannot be read", () => {
    localStorage.setItem("kiza.appearance", "{ not json");
    // A launcher that fails to boot over a preference file is worse than one
    // that forgets a preference.
    expect(getStoredAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it("round-trips what it stored", () => {
    const wanted = { ...DEFAULT_APPEARANCE, density: "spacious" as const, radius: 0 };
    applyAppearance(wanted);
    expect(getStoredAppearance()).toEqual(wanted);
  });
});
