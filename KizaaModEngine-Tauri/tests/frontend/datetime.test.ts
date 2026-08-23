import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatTime,
  formatsFromConfig,
  sample,
  SYSTEM_FORMATS,
} from "../../src/lib/datetime";

// 25 December 2026, 14:05. The day cannot be mistaken for a month, which is
// what makes day-first and month-first tellable apart.
const CHRISTMAS = new Date(2026, 11, 25, 14, 5);

describe("dates", () => {
  it("writes each order the way it is named", () => {
    expect(formatDate(CHRISTMAS, { ...SYSTEM_FORMATS, dateFormat: "dmy" })).toBe("25/12/2026");
    expect(formatDate(CHRISTMAS, { ...SYSTEM_FORMATS, dateFormat: "mdy" })).toBe("12/25/2026");
    expect(formatDate(CHRISTMAS, { ...SYSTEM_FORMATS, dateFormat: "ymd" })).toBe("2026-12-25");
  });

  it("pads single digits so a column of dates lines up", () => {
    const january = new Date(2026, 0, 5, 9, 7);
    expect(formatDate(january, { ...SYSTEM_FORMATS, dateFormat: "dmy" })).toBe("05/01/2026");
  });

  it("leaves the machine to it when nothing was chosen", () => {
    // Only that it defers — the actual shape belongs to whoever set the region.
    expect(formatDate(CHRISTMAS)).toBe(CHRISTMAS.toLocaleDateString());
  });
});

describe("clocks", () => {
  it("writes 24-hour time zero padded", () => {
    expect(formatTime(CHRISTMAS, { ...SYSTEM_FORMATS, timeFormat: "24h" })).toBe("14:05");
    const early = new Date(2026, 11, 25, 6, 3);
    expect(formatTime(early, { ...SYSTEM_FORMATS, timeFormat: "24h" })).toBe("06:03");
  });

  it("writes 12-hour time with the right half of the day", () => {
    expect(formatTime(CHRISTMAS, { ...SYSTEM_FORMATS, timeFormat: "12h" })).toBe("2:05 PM");
  });

  it("calls midnight and noon twelve rather than zero", () => {
    // The slip that reports a world last played at "0:15 AM".
    const midnight = new Date(2026, 11, 25, 0, 15);
    const noon = new Date(2026, 11, 25, 12, 30);
    expect(formatTime(midnight, { ...SYSTEM_FORMATS, timeFormat: "12h" })).toBe("12:15 AM");
    expect(formatTime(noon, { ...SYSTEM_FORMATS, timeFormat: "12h" })).toBe("12:30 PM");
  });
});

describe("bad input", () => {
  it("shows a dash rather than 'Invalid Date'", () => {
    for (const value of ["", "not a date", Number.NaN]) {
      expect(formatDate(value)).toBe("—");
      expect(formatTime(value)).toBe("—");
      expect(formatDateTime(value)).toBe("—");
    }
  });

  it("accepts what the launcher actually passes around", () => {
    const iso = CHRISTMAS.toISOString();
    const millis = CHRISTMAS.getTime();
    const formats = { timeFormat: "24h", dateFormat: "ymd" };

    expect(formatDate(iso, formats)).toBe("2026-12-25");
    expect(formatDate(millis, formats)).toBe("2026-12-25");
    expect(formatDate(CHRISTMAS, formats)).toBe("2026-12-25");
  });
});

describe("reading the configuration", () => {
  it("falls back to the system when the file predates these fields", () => {
    expect(formatsFromConfig(undefined)).toEqual(SYSTEM_FORMATS);
    expect(formatsFromConfig({})).toEqual(SYSTEM_FORMATS);
  });

  it("carries both fields through", () => {
    expect(formatsFromConfig({ time_format: "12h", date_format: "mdy" })).toEqual({
      timeFormat: "12h",
      dateFormat: "mdy",
    });
  });
});

describe("the settings preview", () => {
  it("distinguishes the two orders it exists to distinguish", () => {
    const dayFirst = sample({ timeFormat: "24h", dateFormat: "dmy" });
    const monthFirst = sample({ timeFormat: "24h", dateFormat: "mdy" });

    expect(dayFirst).not.toBe(monthFirst);
    expect(dayFirst).toBe("25/12/2026 14:05");
    expect(monthFirst).toBe("12/25/2026 14:05");
  });
});
