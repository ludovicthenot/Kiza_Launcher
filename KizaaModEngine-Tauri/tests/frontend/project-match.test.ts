import { describe, expect, it } from "vitest";
import { isSameProject, projectKey } from "../../src/lib/projectMatch";

describe("projectMatch", () => {
  it("recognises the same project across the two catalogues", () => {
    // The catalogues punctuate, space and capitalise differently.
    expect(isSameProject("Just Enough Items (JEI)", "Just Enough Items")).toBe(true);
    expect(isSameProject("Fabric API", "Fabric  api")).toBe(true);
    expect(isSameProject("Cloth Config API", "cloth-config-api")).toBe(true);
    expect(isSameProject("Iris Shaders", "IRIS SHADERS")).toBe(true);
  });

  it("never merges two different mods", () => {
    // The dangerous case: merging hides one mod behind the other's name and
    // would install the wrong file. A visible duplicate is the safer failure.
    //
    // Each pair below is two genuinely different projects whose names overlap.
    expect(isSameProject("Iris", "Iris Shaders")).toBe(false);
    expect(isSameProject("Fabric", "Fabric API")).toBe(false);
    expect(isSameProject("Sodium", "Sodium Extra")).toBe(false);
    expect(isSameProject("Jade", "Jade Addons")).toBe(false);
    expect(isSameProject("EMI", "EMI Loot")).toBe(false);
  });

  it("refuses to merge when there is no title to compare", () => {
    expect(projectKey("")).toBe("");
    expect(projectKey("   ---   ")).toBe("");
    expect(isSameProject("", "")).toBe(false);
    expect(isSameProject("  ", "Sodium")).toBe(false);
  });

  it("ignores an acronym one catalogue adds and the other does not", () => {
    expect(projectKey("Just Enough Items (JEI)")).toBe(projectKey("Just Enough Items"));
    // A name that is only an acronym still identifies itself.
    expect(projectKey("JEI")).toBe("jei");
  });
});
