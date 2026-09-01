/**
 * What the Component Inspector is, as data.
 *
 * The interesting half of the inspector is a browser: a sheet over the
 * launcher, `elementsFromPoint`, two outlines. What can be checked here is the
 * half that decides whether any of that means anything — that a component only
 * offers properties the stylesheet actually reads, that editing one writes
 * where the engine looks, and that Stable carries none of it.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { CATALOGUE, variableFor } from "../../src/lib/maker/catalogue";
import { COMPONENT_KINDS, EDITABLE_ATTRIBUTE } from "../../src/lib/maker/editable";
import { apply, useThemeStore } from "../../src/lib/theme/store";
import { themeVariables } from "../../src/lib/theme/engine";
import { BUILT_IN_THEMES } from "../../src/lib/theme/builtin";

const nebula = () => BUILT_IN_THEMES.find((theme) => theme.id === "nebula")!;

describe("what a component offers a designer", () => {
  /**
   * A property nothing reads is a slider that does nothing, and a designer who
   * finds one stops trusting the rest of the panel. Every property has to
   * appear in the stylesheet, and with the same fallback the catalogue claims.
   */
  it("only offers properties the stylesheet actually reads", () => {
    const css = readFileSync("src/App.css", "utf8");

    for (const kind of COMPONENT_KINDS) {
      for (const property of CATALOGUE[kind].properties) {
        const variable = variableFor(kind, property.key);
        expect(css, `nothing reads ${variable}`).toContain(variable);
        expect(
          css,
          `${variable} falls back to something other than ${property.fallback}`,
        ).toContain(`${variable}, ${property.fallback}`);
      }
    }
  });

  /** Every kind a component can declare is a kind the panel can explain. */
  it("has a catalogue entry for every kind a component may declare", () => {
    for (const kind of COMPONENT_KINDS) {
      expect(CATALOGUE[kind].name).toBeTruthy();
      expect(CATALOGUE[kind].scope).toBeTruthy();
      expect(CATALOGUE[kind].properties.length).toBeGreaterThan(0);
    }
    expect(Object.keys(CATALOGUE).sort()).toEqual([...COMPONENT_KINDS].sort());
  });

  /**
   * The launcher marks its components with a string and nothing more. If this
   * ever grew into "the launcher imports the catalogue", Stable would start
   * shipping the Maker's vocabulary.
   */
  it("is declared by components without them knowing what it means", () => {
    const marker = readFileSync("src/lib/maker/editable.ts", "utf8");
    expect(marker, "the marker imports the Maker's vocabulary").not.toMatch(
      /^import .*catalogue/m,
    );
    expect(marker).toContain("IS_MAKER");

    for (const file of [
      "src/components/common/InstancePoster.tsx",
      "src/components/views/LibraryView.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('from "../../lib/maker/editable"');
      expect(source, `${file} reaches into the Maker's catalogue`).not.toMatch(
        /^import .*maker\/catalogue/m,
      );
    }
  });
});

describe("editing a component", () => {
  beforeEach(() => {
    useThemeStore.setState({ appliedId: "nebula", available: [...BUILT_IN_THEMES], session: null });
  });

  it("writes where the engine looks for it", () => {
    const edited = apply(nebula(), {
      kind: "component",
      component: "card",
      property: "radius",
      value: "24px",
    });

    expect(edited.components).toEqual({ card: { radius: "24px" } });
    expect(themeVariables(edited)["--kiza-card-radius"]).toBe("24px");

    // And the theme it came from is untouched, as every edit here is.
    expect(nebula().components).toBeUndefined();
  });

  /**
   * Putting a property back to the default removes it rather than storing the
   * default, so a later Kiza is free to change what the default is — and so a
   * theme file says only what its designer actually decided.
   */
  it("forgets a property put back to its default", () => {
    let theme = apply(nebula(), {
      kind: "component",
      component: "card",
      property: "radius",
      value: "24px",
    });
    theme = apply(theme, {
      kind: "component",
      component: "card",
      property: "glow",
      value: "0.4",
    });
    expect(theme.components?.card).toEqual({ radius: "24px", glow: "0.4" });

    theme = apply(theme, {
      kind: "component",
      component: "card",
      property: "radius",
      value: undefined,
    });
    expect(theme.components?.card).toEqual({ glow: "0.4" });

    // The last one leaves no empty shell behind.
    theme = apply(theme, {
      kind: "component",
      component: "card",
      property: "glow",
      value: undefined,
    });
    expect(theme.components).toEqual({});
  });

  /** A gesture on one property is one step, as everywhere else in the Maker. */
  it("collapses a run on the same property into one history step", () => {
    const store = useThemeStore.getState();
    store.beginSession(nebula());
    for (const radius of [10, 12, 14, 16]) {
      store.edit({ kind: "component", component: "card", property: "radius", value: `${radius}px` });
    }
    expect(useThemeStore.getState().session!.past).toHaveLength(1);

    // A different property is a different intention.
    store.edit({ kind: "component", component: "card", property: "glow", value: "0.2" });
    expect(useThemeStore.getState().session!.past).toHaveLength(2);
  });
});

describe("what Stable is left holding", () => {
  /**
   * A launcher component says it is editable and that is all it does. In
   * Stable the attribute is not even emitted — `IS_MAKER` is a literal by the
   * time the bundler sees it, so the whole thing folds to an empty object.
   */
  it("marks nothing when the edition is not the Maker", async () => {
    const { editable } = await import("../../src/lib/maker/editable");
    const marked = editable("card");

    // The test build is Stable, which is the case worth holding.
    expect(marked).toEqual({});
    expect(EDITABLE_ATTRIBUTE).toBe("data-kiza-editable");
  });
});

describe("what a selection has to know", () => {
  /**
   * Styling a card styles every card; moving one will move that one. The
   * second needs the name of the card that was picked up, and the only moment
   * that name is known for certain is when the component renders itself — so
   * the marker carries it, rather than the inspector trying to work it out
   * afterwards from a node in a list that has re-rendered.
   */
  it("can say which one, for a component there are several of", async () => {
    const { INSTANCE_ATTRIBUTE } = await import("../../src/lib/maker/editable");
    const source = readFileSync("src/components/common/InstancePoster.tsx", "utf8");

    expect(INSTANCE_ATTRIBUTE).toBe("data-kiza-instance");
    expect(source, "a card does not say which card it is").toContain(
      'editable("card", instance.id)',
    );
  });

  /**
   * A move is an edit, and every edit already goes through the theme store —
   * which is where Undo, Redo and the unsaved-work guard live. Nothing about
   * moving a component should need its own history.
   */
  it("keeps the door open for moves without a second history", () => {
    const store = readFileSync("src/lib/theme/store.ts", "utf8");
    expect(store).toContain("kind: \"component\"");
    // One place decides what a run of edits is, so a dragged card collapses
    // into one undo step the same way a dragged slider does.
    expect(store).toContain("function runKey");
  });
});
