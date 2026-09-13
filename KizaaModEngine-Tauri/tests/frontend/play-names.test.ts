import { describe, expect, it } from "vitest";
import { slugName, validName } from "../../cloudflare/src/play.js";

describe("a Kiza address name", () => {
  it("is a DNS label anyone can type, and never an infrastructure word", () => {
    expect(validName("survie")).toBe(true);
    expect(validName("survie-des-potes")).toBe(true);
    expect(validName("Survie")).toBe(false);
    expect(validName("-survie")).toBe(false);
    expect(validName("su")).toBe(false);
    expect(validName("www")).toBe(false);
    expect(validName("a".repeat(33))).toBe(false);
  });

  it("comes from the server's name when nobody chose one", () => {
    expect(slugName("Survie des potes")).toBe("survie-des-potes");
    expect(slugName("Ab")).toBe("ab-server");
    expect(validName(slugName("Été — survie !!"))).toBe(true);
  });
});
