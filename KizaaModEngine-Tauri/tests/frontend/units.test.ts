import { describe, expect, it } from "vitest";
import { formatBytes, unitsFromConfig } from "../../src/lib/units";

describe("the default, which matches what Explorer shows", () => {
  it("uses 1024 steps under the familiar names", () => {
    // Deliberately not the SI meaning of those names. Someone comparing this
    // against the properties dialogue in Windows needs the two to agree.
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("drops the decimal once the figure is big enough not to need it", () => {
    expect(formatBytes(1024 ** 3 * 12.4)).toBe("12 GB");
    expect(formatBytes(1024 ** 3 * 1.4)).toBe("1.4 GB");
  });

  it("never puts a decimal on a count of bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });
});

describe("binary units", () => {
  it("names them the way the standard does", () => {
    expect(formatBytes(1024, "binary")).toBe("1.0 KiB");
    expect(formatBytes(1024 ** 3, "binary")).toBe("1.0 GiB");
  });
});

describe("decimal units", () => {
  it("steps by 1000, which is what a drive is sold as", () => {
    expect(formatBytes(1000, "decimal")).toBe("1.0 kB");
    expect(formatBytes(1_000_000_000, "decimal")).toBe("1.0 GB");
  });

  it("differs from the default on the same number, which is the point", () => {
    // A 500 GB drive holds 500,000,000,000 bytes and Windows calls it 466 GB.
    expect(formatBytes(500_000_000_000, "decimal")).toBe("500 GB");
    expect(formatBytes(500_000_000_000, "auto")).toBe("466 GB");
  });
});

describe("edges", () => {
  it("writes zero without a unit prefix", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("refuses to invent a figure for what is not a number", () => {
    // A size that failed to load should read as absent, not as "0 B" — which
    // would say the folder is empty.
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });

  it("stops at the largest unit it knows rather than running past it", () => {
    expect(formatBytes(1024 ** 6)).toMatch(/TB$/);
  });

  it("honours an explicit number of decimals", () => {
    expect(formatBytes(1024 ** 3 * 12.4, "auto", 2)).toBe("12.40 GB");
  });
});

describe("reading the setting", () => {
  it("takes the two explicit choices", () => {
    expect(unitsFromConfig({ storage_units: "binary" })).toBe("binary");
    expect(unitsFromConfig({ storage_units: "decimal" })).toBe("decimal");
  });

  it("falls back rather than passing an unknown value through", () => {
    // A hand-edited config, or a value from a build that offered something
    // else, must not reach the formatter.
    expect(unitsFromConfig({ storage_units: "cubits" })).toBe("auto");
    expect(unitsFromConfig({})).toBe("auto");
    expect(unitsFromConfig(undefined)).toBe("auto");
  });
});
