import { describe, expect, it } from "vitest";
import type { MinecraftVersionEntry } from "../../src/lib/queries";
import { filterMinecraftVersions } from "../../src/lib/minecraftVersions";
import {
  filterMinecraftVersionsByJava,
  javaMajorForMinecraftVersion,
} from "../../src/lib/minecraftJava";

function version(id: string, type: string, releaseTime: string): MinecraftVersionEntry {
  return { id, type, releaseTime, time: releaseTime, url: `https://example.test/${id}` };
}

const catalog = [
  version("26.2", "release", "2026-03-01T00:00:00Z"),
  version("26.3-snapshot-1", "snapshot", "2026-04-01T00:00:00Z"),
  version("1.20.5", "release", "2024-04-23T00:00:00Z"),
  version("1.20.4", "release", "2023-12-07T00:00:00Z"),
  version("1.17.1", "release", "2021-07-06T00:00:00Z"),
  version("1.16.5", "release", "2021-01-15T00:00:00Z"),
  version("1.7.10", "release", "2014-06-26T00:00:00Z"),
  version("1.7.2", "release", "2013-10-25T00:00:00Z"),
  version("1.6.4", "release", "2013-09-19T00:00:00Z"),
];

describe("Minecraft version catalog", () => {
  it("keeps releases down to Minecraft 1.7 and excludes older entries", () => {
    expect(filterMinecraftVersions(catalog, true).map((entry) => entry.id)).toEqual([
      "26.2",
      "1.20.5",
      "1.20.4",
      "1.17.1",
      "1.16.5",
      "1.7.10",
      "1.7.2",
    ]);
  });

  it("shows snapshots only when the preference allows them", () => {
    expect(filterMinecraftVersions(catalog, false).map((entry) => entry.id)).toContain(
      "26.3-snapshot-1",
    );
    expect(filterMinecraftVersions(catalog, true).map((entry) => entry.id)).not.toContain(
      "26.3-snapshot-1",
    );
  });

  it("limits Java 8 to Minecraft 1.7 through 1.16", () => {
    const supported = filterMinecraftVersions(catalog, false);
    expect(filterMinecraftVersionsByJava(supported, "8").map((entry) => entry.id)).toEqual([
      "1.16.5",
      "1.7.10",
      "1.7.2",
    ]);
  });

  it("maps modern Minecraft releases to their required Java major", () => {
    expect(javaMajorForMinecraftVersion(catalog.find((entry) => entry.id === "1.17.1")!)).toBe(17);
    expect(javaMajorForMinecraftVersion(catalog.find((entry) => entry.id === "1.20.4")!)).toBe(17);
    expect(javaMajorForMinecraftVersion(catalog.find((entry) => entry.id === "1.20.5")!)).toBe(21);
    expect(javaMajorForMinecraftVersion(catalog.find((entry) => entry.id === "26.2")!)).toBe(25);
  });
});
