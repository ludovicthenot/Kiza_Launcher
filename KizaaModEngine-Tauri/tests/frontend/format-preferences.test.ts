import { afterEach, describe, expect, it } from "vitest";
import { formatBytes, preferUnits } from "../../src/lib/units";
import { formatDate, preferFormats, SYSTEM_FORMATS } from "../../src/lib/datetime";

/**
 * The settings are the default, not an option a page has to remember.
 *
 * Sixteen places printed a size without passing the units, and so printed
 * "auto" whatever Settings said. These pin the rule that fixed it: a caller
 * that passes nothing gets what was chosen.
 */
describe("the chosen formats are what a bare call prints", () => {
  afterEach(() => {
    preferUnits("auto");
    preferFormats(SYSTEM_FORMATS);
  });

  it("prints a size in the chosen units", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    preferUnits("binary");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    preferUnits("decimal");
    expect(formatBytes(1536)).toBe("1.5 kB");
  });

  it("still lets a caller ask for other units", () => {
    preferUnits("binary");
    expect(formatBytes(1536, "decimal")).toBe("1.5 kB");
  });

  it("prints a date in the chosen order", () => {
    const christmas = new Date(2026, 11, 25, 14, 5);
    preferFormats({ dateFormat: "ymd", timeFormat: "24h" });
    expect(formatDate(christmas)).toBe("2026-12-25");
    preferFormats({ dateFormat: "dmy", timeFormat: "24h" });
    expect(formatDate(christmas)).toBe("25/12/2026");
  });
});
