import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The launcher and the menu it draws inside Minecraft are set in one face.
 *
 * <p>They were not, and nothing said so. The CSS asked for "Segoe UI Variable
 * Text", which Windows resolves because CSS matches on the full font name; the
 * mod asked for the same string through Java, which matches on family names,
 * where it is not one — so it was skipped on every machine and the menu fell
 * through to plain Segoe UI. Two faces, a comment on each claiming they
 * matched, and no way to notice short of putting screenshots side by side.
 *
 * So the two files are compared here. A name that only one of them can resolve
 * is the whole failure, and it looks like care when you read either one alone.
 */
describe("one typeface, two renderers", () => {
  const css = readFileSync("src/App.css", "utf8");
  const java = readFileSync(
    "kiza-base-mod/src/common/java/fr/kiza/basemod/render/KizaText.java",
    "utf8",
  );

  /** The families a declaration names, in order, quotes stripped. */
  const familiesIn = (declaration: string) =>
    (declaration.match(/"[^"]+"|[A-Za-z-]+/g) ?? [])
      .map((name) => name.replace(/"/g, "").trim())
      .filter(Boolean);

  const bodyStack = () => {
    const match = css.match(/body\s*\{[^}]*font-family:([^;]+);/);
    expect(match, "the body font-family should be findable").not.toBeNull();
    return familiesIn(match![1]);
  };

  const javaStack = () => {
    const match = java.match(/FONT_FAMILIES\s*=\s*\{([^}]+)\}/);
    expect(match, "FONT_FAMILIES should be findable").not.toBeNull();
    return familiesIn(match![1]);
  };

  it("asks for the same face first in both", () => {
    expect(javaStack()[0]).toBe(bodyStack()[0]);
  });

  it("gives the headings the same face as the body", () => {
    const headings = css.match(/h1,\s*h2,\s*h3\s*\{[^}]*font-family:([^;]+);/);
    expect(headings).not.toBeNull();
    expect(familiesIn(headings![1])[0]).toBe(bodyStack()[0]);
  });

  /**
   * Measured, not assumed: in a browser "Segoe UI Variable Text" resolves and
   * "Segoe UI Variable" does not, and in Java it is the other way round. A name
   * only one side can use is how this broke, so neither side may name one.
   */
  it("names nothing only one of the two can resolve", () => {
    const onlyCssResolves = "Segoe UI Variable Text";
    const onlyJavaResolves = "Segoe UI Variable";
    for (const stack of [bodyStack(), javaStack()]) {
      expect(stack, stack.join("/")).not.toContain(onlyCssResolves);
      expect(stack, stack.join("/")).not.toContain(onlyJavaResolves);
    }
  });

  /**
   * And the heavier face has to be a real one. Java hands back a synthetic bold
   * for a family with no bold face — the same glyphs stretched sideways — which
   * at the ten pixels a menu label is set at reads as blur, not as weight.
   */
  it("asks for a named semibold rather than deriving one", () => {
    const bold = java.match(/BOLD_FAMILIES\s*=\s*\{([^}]+)\}/);
    expect(bold).not.toBeNull();
    expect(familiesIn(bold![1])[0]).toBe("Segoe UI Semibold");
  });
});
