import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  declarationsFor,
  isPartName,
  layoutStylesheet,
  partLabel,
  PART_ATTRIBUTE,
} from "../../src/lib/theme/parts";
import { apply, hasUnsavedChanges, sameTheme, useThemeStore } from "../../src/lib/theme/store";
import { themeById } from "../../src/lib/theme";

/**
 * Placing one element rather than styling every element of its kind.
 *
 * The interesting property is the one that is easy to lose: a theme may move
 * anything anywhere, and the launcher must still lay itself out at a window
 * size the designer never tried. That holds only while placement is an offset
 * applied with a transform — the moment it becomes `position: absolute` and a
 * pair of coordinates, the layout stops being the launcher's and starts being
 * the theme's, at one resolution.
 */
describe("placing one element", () => {
  it("moves it without taking it out of the layout", () => {
    const css = declarationsFor({ x: "40px", y: "-12px" });
    expect(css).toContain("translate:40px -12px");
    // The two ways of doing this that would break every other window size.
    expect(css).not.toContain("position:absolute");
    expect(css).not.toContain("left:");
    expect(css).not.toContain("top:");
  });

  /**
   * As properties in their own right, not as one `transform`.
   *
   * The launcher's entrance animation is GSAP, which writes `transform`
   * inline — and inline beats a stylesheet, so a placement written as a
   * `transform` was recorded, applied, and invisible. These three compose with
   * it instead of colliding, which is the difference between a theme that
   * moves something and a theme that only says it did.
   */
  it("carries size and angle without taking over the transform", () => {
    const css = declarationsFor({ scale: "1.5", rotate: "-15deg" });
    expect(css).toContain("rotate:-15deg");
    expect(css).toContain("scale:1.5");
    expect(css).toContain("transform-origin:center");
    expect(css).not.toContain("transform:");
  });

  it("says nothing at all about an element nobody moved", () => {
    expect(declarationsFor({})).toBe("");
    expect(layoutStylesheet(undefined)).toBe("");
    expect(layoutStylesheet({ "library.title": {} })).toBe("");
  });

  it("takes an element off the page when asked", () => {
    expect(declarationsFor({ hidden: "true" })).toContain("display:none");
  });

  /**
   * The name ends up inside a selector, so it is checked rather than escaped.
   *
   * A theme is a file somebody downloaded. If a name could close the string it
   * sits in, a theme could write any rule it liked into the launcher — which
   * is a stylesheet written by whoever wrote the file.
   */
  it("refuses a name that could write its own rule", () => {
    expect(isPartName("library.title")).toBe(true);
    expect(isPartName("library.header-row")).toBe(true);
    for (const bad of [
      'x"]{display:none}[data-kiza-part="y',
      "library.title;",
      "Library.Title",
      "library title",
      "",
    ]) {
      expect(isPartName(bad), bad).toBe(false);
    }
    // And a refused name produces no rule rather than a broken one.
    expect(layoutStylesheet({ 'a"]{}': { x: "10px" } })).toBe("");
  });

  it("writes one rule per part", () => {
    const css = layoutStylesheet({
      "library.title": { x: "10px" },
      "library.icon": { hidden: "true" },
    });
    expect(css).toContain(`[${PART_ATTRIBUTE}="library.title"]{`);
    expect(css).toContain(`[${PART_ATTRIBUTE}="library.icon"]{display:none}`);
  });

  it("reads a name back as something a person would say", () => {
    expect(partLabel("library.count")).toBe("Count");
    expect(partLabel("library.header-row")).toBe("Header row");
    expect(partLabel(null)).toBe("Element");
  });
});

describe("placement as an edit", () => {
  it("goes through the store, so Undo takes it back", () => {
    const start = themeById("nebula");
    const moved = apply(start, { kind: "layout", part: "library.title", property: "x", value: "24px" });
    expect(moved.layout?.["library.title"]).toEqual({ x: "24px" });
    // Never in place: the history holds the theme before and the theme after.
    expect(start.layout).toBeUndefined();

    const back = apply(moved, {
      kind: "layout",
      part: "library.title",
      property: "x",
      value: undefined,
    });
    // An element with nothing left to say about it is dropped, so "this theme
    // places the title" and "this theme mentions the title" cannot differ.
    expect(back.layout?.["library.title"]).toBeUndefined();
  });

  /**
   * A drag is one thing somebody did, whatever it cost in frames.
   *
   * Four hundred edits recorded as four hundred history entries would make
   * Undo mean "take back one pixel of that", which is worse than useless.
   */
  it("collapses a drag into one history entry", () => {
    const store = readFileSync("src/lib/theme/store.ts", "utf8");
    expect(store).toContain("case \"layout\":");
    expect(store).toContain("return `layout:${edit.part}`");
  });
});

describe("what a designer can reach", () => {
  it("names the things that are not one of anything", () => {
    const library = readFileSync("src/components/views/LibraryView.tsx", "utf8");
    // The cube, and the line of small print under the title: no class themes
    // them as a group, so without a name they could not be pointed at at all.
    for (const named of ["library.icon", "library.title", "library.count"]) {
      expect(library, `${named} is not declared`).toContain(named);
    }
  });

  it("lets the tool pick an element that only has a name", () => {
    const inspector = readFileSync("src/components/maker/Inspector.tsx", "utf8");
    expect(inspector).toContain("PART_ATTRIBUTE");
    expect(inspector).toContain("if (kind || named)");
  });

  /** And the launcher applies it, so a theme is not a Maker-only trick. */
  it("is applied by the engine rather than by the tools", () => {
    const engine = readFileSync("src/lib/theme/engine.ts", "utf8");
    expect(engine).toContain("layoutStylesheet");
    const parts = readFileSync("src/lib/theme/parts.ts", "utf8");
    expect(parts).not.toContain("IS_MAKER");
  });
});

/**
 * A move has to reach the draft, which is where the first version failed.
 *
 * Every edit is dropped before it is applied if it would not change the theme,
 * and the comparison that decides was written before placement existed — so it
 * did not look at it, so every move compared equal, so every move was thrown
 * away. The handles worked, the sliders worked, the theme never moved. These
 * are the two tests that would have caught it.
 */
describe("a move actually changes the theme", () => {
  it("counts as a difference", () => {
    const start = themeById("nebula");
    const moved = apply(start, {
      kind: "layout",
      part: "library.icon",
      property: "x",
      value: "80px",
    });
    expect(sameTheme(start, moved)).toBe(false);
  });

  it("reaches the draft through the store", () => {
    const store = useThemeStore.getState();
    store.beginSession(themeById("nebula"));
    useThemeStore
      .getState()
      .edit({ kind: "layout", part: "library.icon", property: "x", value: "80px" });

    const session = useThemeStore.getState().session;
    expect(session?.draft.layout?.["library.icon"]).toEqual({ x: "80px" });
    // And a theme somebody has rearranged is a theme with unsaved work in it.
    expect(hasUnsavedChanges(session!)).toBe(true);
  });
});
