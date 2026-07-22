import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, getStoredTheme, THEMES } from "../../src/lib/theme";

describe("launcher themes", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("includes the Toxic and Chinese Road palettes", () => {
    expect(THEMES.find((theme) => theme.id === "toxic")?.swatches).toEqual([
      "#181918",
      "#00ff43",
      "#484c51",
    ]);
    expect(THEMES.find((theme) => theme.id === "chinese-road")?.swatches).toEqual([
      "#121312",
      "#ad0013",
      "#a67d43",
    ]);
  });

  it("persists the selected theme", () => {
    applyTheme("chinese-road");

    expect(document.documentElement.dataset.theme).toBe("chinese-road");
    expect(getStoredTheme()).toBe("chinese-road");
  });
});
