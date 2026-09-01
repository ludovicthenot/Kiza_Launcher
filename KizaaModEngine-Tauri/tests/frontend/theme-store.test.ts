import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apply,
  effectiveTheme,
  hasUnsavedChanges,
  sameTheme,
  startPainting,
  useThemeStore,
} from "../../src/lib/theme/store";
import { BUILT_IN_THEMES } from "../../src/lib/theme/builtin";
import { COLOR_TOKENS, type ThemeDefinition } from "../../src/lib/theme/definition";

const nebula = () => BUILT_IN_THEMES.find((theme) => theme.id === "nebula")!;
const cyber = () => BUILT_IN_THEMES.find((theme) => theme.id === "cyber")!;

function freshStore() {
  useThemeStore.setState({
    appliedId: "nebula",
    available: [...BUILT_IN_THEMES],
    session: null,
  });
}

describe("what the window paints", () => {
  beforeEach(freshStore);

  /**
   * The applied theme and a draft being edited are two different things, and
   * the launcher has to be able to tell them apart without anything drawing a
   * button having to.
   */
  it("shows the applied theme until somebody starts editing", () => {
    expect(effectiveTheme(useThemeStore.getState()).id).toBe("nebula");

    useThemeStore.getState().setApplied("cyber");
    expect(effectiveTheme(useThemeStore.getState()).id).toBe("cyber");

    useThemeStore.getState().beginSession(cyber());
    useThemeStore.getState().edit({ kind: "color", token: "primary", value: "0 100% 50%" });
    expect(effectiveTheme(useThemeStore.getState()).colors.primary).toBe("0 100% 50%");

    // And goes back to the applied one when the work is put down.
    useThemeStore.getState().endSession({ discard: true });
    expect(effectiveTheme(useThemeStore.getState()).id).toBe("cyber");
    expect(effectiveTheme(useThemeStore.getState()).colors.primary).toBe(cyber().colors.primary);
  });

  it("falls back to a theme that exists when the applied one is gone", () => {
    useThemeStore.setState({ appliedId: "a-theme-that-was-deleted" });
    expect(effectiveTheme(useThemeStore.getState()).id).toBe("nebula");
  });
});

describe("an editing session", () => {
  beforeEach(freshStore);

  /**
   * Editing Nebula must not turn Nebula into something that is no longer
   * Nebula. A bundled theme is copied, and the copy is what gets edited.
   */
  it("copies a bundled theme rather than editing it in place", () => {
    useThemeStore.getState().beginSession(nebula());
    const session = useThemeStore.getState().session!;

    expect(session.draft.readOnly).toBeFalsy();
    expect(session.draft.id).not.toBe("nebula");
    expect(session.draft.colors).toEqual(nebula().colors);
    // The bundled one is untouched.
    expect(nebula().readOnly).toBe(true);
  });

  it("knows when there is something to save, and when there is not", () => {
    useThemeStore.getState().beginSession(nebula());
    expect(hasUnsavedChanges(useThemeStore.getState().session)).toBe(false);

    useThemeStore.getState().edit({ kind: "color", token: "border", value: "0 0% 50%" });
    expect(hasUnsavedChanges(useThemeStore.getState().session)).toBe(true);

    // Setting a value back to what it was is not a change.
    useThemeStore
      .getState()
      .edit({ kind: "color", token: "border", value: nebula().colors.border });
    expect(hasUnsavedChanges(useThemeStore.getState().session)).toBe(false);
  });

  it("makes the draft the new reference when it is saved", () => {
    useThemeStore.getState().beginSession(nebula());
    useThemeStore.getState().edit({ kind: "meta", field: "name", value: "Midnight" });
    expect(hasUnsavedChanges(useThemeStore.getState().session)).toBe(true);

    useThemeStore.getState().markSaved("C:/themes/midnight.kizatheme");
    expect(hasUnsavedChanges(useThemeStore.getState().session)).toBe(false);
    expect(useThemeStore.getState().session!.savedAs).toBe("C:/themes/midnight.kizatheme");

    // "Changed" now means changed since that save, not since the Maker opened.
    useThemeStore.getState().edit({ kind: "radius", value: 20 });
    expect(hasUnsavedChanges(useThemeStore.getState().session)).toBe(true);
    useThemeStore.getState().reset();
    expect(useThemeStore.getState().session!.draft.name).toBe("Midnight");
    expect(hasUnsavedChanges(useThemeStore.getState().session)).toBe(false);
  });

  /**
   * The one thing the store must never do on its own. Work somebody spent an
   * evening on is not thrown away because a panel closed.
   */
  it("refuses to close over unsaved work unless told to", () => {
    useThemeStore.getState().beginSession(nebula());
    useThemeStore.getState().edit({ kind: "color", token: "primary", value: "0 100% 50%" });

    expect(useThemeStore.getState().endSession()).toBe(false);
    expect(useThemeStore.getState().session).not.toBeNull();
    expect(useThemeStore.getState().session!.draft.colors.primary).toBe("0 100% 50%");

    expect(useThemeStore.getState().endSession({ discard: true })).toBe(true);
    expect(useThemeStore.getState().session).toBeNull();
  });

  it("closes without argument when nothing has changed", () => {
    useThemeStore.getState().beginSession(nebula());
    expect(useThemeStore.getState().endSession()).toBe(true);
    expect(useThemeStore.getState().session).toBeNull();
  });
});

describe("an edit", () => {
  const base = (): ThemeDefinition => ({ ...nebula(), readOnly: false });

  it("never changes the theme it was given", () => {
    const before = base();
    const snapshot = JSON.stringify(before);

    apply(before, { kind: "color", token: "primary", value: "0 100% 50%" });
    apply(before, { kind: "asset", slot: "logo", url: "blob:x" });
    apply(before, { kind: "ambient", index: 0, stop: { alpha: 0.5 } });

    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("reaches every part of a theme a designer can touch", () => {
    let theme = base();

    theme = apply(theme, { kind: "color", token: "card", value: "10 20% 30%" });
    expect(theme.colors.card).toBe("10 20% 30%");

    theme = apply(theme, { kind: "ambient", index: 1, stop: { alpha: 0.42 } });
    expect(theme.ambient[1].alpha).toBe(0.42);
    expect(theme.ambient[0]).toEqual(nebula().ambient[0]);

    theme = apply(theme, { kind: "radius", value: 16 });
    expect(theme.radius).toBe(16);

    theme = apply(theme, { kind: "asset", slot: "background", url: "blob:bg" });
    expect(theme.assets?.background).toBe("blob:bg");

    // Removing a picture takes the slot away rather than leaving it empty, so
    // the resolver falls back to what Kiza ships.
    theme = apply(theme, { kind: "asset", slot: "background", url: undefined });
    expect(theme.assets?.background).toBeUndefined();
    expect("background" in (theme.assets ?? {})).toBe(false);

    theme = apply(theme, { kind: "meta", field: "author", value: "Jay" });
    expect(theme.author).toBe("Jay");
  });

  /** Two themes that mean the same thing compare equal whatever order they were built in. */
  it("compares by what a theme means, not how it was assembled", () => {
    let left = base();
    let right = base();

    left = apply(left, { kind: "color", token: "ring", value: "1 2% 3%" });
    left = apply(left, { kind: "color", token: "card", value: "4 5% 6%" });
    right = apply(right, { kind: "color", token: "card", value: "4 5% 6%" });
    right = apply(right, { kind: "color", token: "ring", value: "1 2% 3%" });

    expect(sameTheme(left, right)).toBe(true);
    expect(sameTheme(left, base())).toBe(false);
  });
});

describe("the history the store already keeps", () => {
  beforeEach(freshStore);

  it("walks back and forward through edits", () => {
    useThemeStore.getState().beginSession(nebula());
    useThemeStore.getState().edit({ kind: "color", token: "primary", value: "0 100% 50%" });
    useThemeStore.getState().edit({ kind: "color", token: "background", value: "120 100% 50%" });

    useThemeStore.getState().undo();
    expect(useThemeStore.getState().session!.draft.colors.background).toBe(
      nebula().colors.background,
    );
    expect(useThemeStore.getState().session!.draft.colors.primary).toBe("0 100% 50%");

    useThemeStore.getState().undo();
    expect(useThemeStore.getState().session!.draft.colors.primary).toBe(nebula().colors.primary);

    useThemeStore.getState().redo();
    expect(useThemeStore.getState().session!.draft.colors.primary).toBe("0 100% 50%");

    // A new edit after undoing drops what was ahead, as every editor does.
    useThemeStore.getState().edit({ kind: "color", token: "ring", value: "240 100% 50%" });
    expect(useThemeStore.getState().session!.future).toHaveLength(0);
    useThemeStore.getState().redo();
    expect(useThemeStore.getState().session!.draft.colors.ring).toBe("240 100% 50%");
  });

  /**
   * A gesture is one step.
   *
   * Dragging a slider sends an edit per pixel and typing a colour sends one
   * per character. One history entry each would make Undo take back a pixel
   * at a time — press it six times and the theme has barely moved — so a run
   * of edits to the same thing collapses into the step a person would say
   * they had taken.
   */
  it("treats a run of edits to the same thing as one step", () => {
    const store = useThemeStore.getState();
    store.beginSession(nebula());
    for (const lightness of [40, 45, 50, 55, 60]) {
      store.edit({ kind: "color", token: "primary", value: `0 100% ${lightness}%` });
    }

    const session = useThemeStore.getState().session!;
    expect(session.draft.colors.primary).toBe("0 100% 60%");
    expect(session.past).toHaveLength(1);

    // And one undo takes the whole gesture back.
    useThemeStore.getState().undo();
    expect(useThemeStore.getState().session!.draft.colors.primary).toBe(nebula().colors.primary);
  });

  /** A different field is a different intention, however fast it follows. */
  it("does not fold two different things into one step", () => {
    const store = useThemeStore.getState();
    store.beginSession(nebula());
    store.edit({ kind: "color", token: "primary", value: "0 100% 50%" });
    store.edit({ kind: "radius", value: 4 });
    store.edit({ kind: "color", token: "primary", value: "0 100% 51%" });

    expect(useThemeStore.getState().session!.past).toHaveLength(3);
  });

  /**
   * Coming back to a field after a pause is a new step, and so is editing
   * after an undo — otherwise the next keystroke would fold itself into a
   * history entry that is no longer the one on top.
   */
  it("starts a new step after a pause, and after an undo", () => {
    vi.useFakeTimers();
    try {
      const store = useThemeStore.getState();
      store.beginSession(nebula());
      store.edit({ kind: "color", token: "primary", value: "0 100% 50%" });
      vi.advanceTimersByTime(2000);
      store.edit({ kind: "color", token: "primary", value: "0 100% 51%" });
      expect(useThemeStore.getState().session!.past).toHaveLength(2);

      useThemeStore.getState().undo();
      useThemeStore.getState().edit({ kind: "color", token: "primary", value: "0 100% 52%" });
      expect(useThemeStore.getState().session!.draft.colors.primary).toBe("0 100% 52%");
      // The undone value is still behind it rather than overwritten in place.
      useThemeStore.getState().undo();
      expect(useThemeStore.getState().session!.draft.colors.primary).toBe("0 100% 50%");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing at the ends rather than falling over", () => {
    useThemeStore.getState().beginSession(nebula());
    useThemeStore.getState().undo();
    useThemeStore.getState().redo();
    expect(useThemeStore.getState().session!.draft.colors).toEqual(nebula().colors);
  });

  it("is safe to undo with no session at all", () => {
    expect(() => useThemeStore.getState().undo()).not.toThrow();
    expect(() => useThemeStore.getState().edit({ kind: "radius", value: 4 })).not.toThrow();
  });
});

describe("painting", () => {
  beforeEach(() => {
    freshStore();
    document.documentElement.removeAttribute("style");
  });

  /**
   * Painting is not rendering. A component that had to remember to repaint is
   * one that will forget, so the store does it.
   */
  it("puts the effective theme on the document, and follows it", () => {
    const stop = startPainting();
    try {
      const painted = () =>
        document.documentElement.style.getPropertyValue("--primary");

      expect(painted()).toBe(nebula().colors.primary);

      useThemeStore.getState().setApplied("cyber");
      expect(painted()).toBe(cyber().colors.primary);

      useThemeStore.getState().beginSession(cyber());
      useThemeStore.getState().edit({ kind: "color", token: "primary", value: "0 100% 50%" });
      expect(painted()).toBe("0 100% 50%");

      useThemeStore.getState().endSession({ discard: true });
      expect(painted()).toBe(cyber().colors.primary);

      // and the whole palette came with it, not only the token that changed
      for (const token of COLOR_TOKENS) {
        expect(
          document.documentElement.style.getPropertyValue(`--${token}`),
          token,
        ).toBe(cyber().colors[token]);
      }
    } finally {
      stop();
    }
  });
});

describe("opening another theme over the one being edited", () => {
  beforeEach(freshStore);

  /**
   * Import replaces the session rather than being replayed as edits onto it.
   *
   * Replaying looks equivalent and is not: everything the incoming theme does
   * not mention survives — the old assets, the old ambient stops — and the
   * history still holds a theme nobody is editing any more, so Undo walks back
   * into it and Reset returns to it.
   */
  it("replaces the whole session rather than merging into it", () => {
    const store = useThemeStore.getState();
    store.beginSession(nebula());
    store.edit({ kind: "asset", slot: "logo", url: "blob:old-logo" });
    store.edit({ kind: "color", token: "primary", value: "0 100% 50%" });

    const incoming: ThemeDefinition = { ...cyber(), id: "borrowed", readOnly: false };
    expect(useThemeStore.getState().adopt(incoming, { replace: true })).toBe(true);

    const session = useThemeStore.getState().session!;
    expect(session.draft.id).toBe("borrowed");
    expect(session.draft.assets?.logo).toBeUndefined();
    expect(session.draft.colors.primary).toBe(cyber().colors.primary);
    // Nothing left behind for Undo or Reset to walk back into.
    expect(session.past).toEqual([]);
    expect(session.future).toEqual([]);
    expect(session.baseline).toEqual(session.draft);
    expect(hasUnsavedChanges(session)).toBe(false);
  });

  /** Unsaved work is never replaced without being asked about first. */
  it("refuses to replace unsaved work unless told to", () => {
    const store = useThemeStore.getState();
    store.beginSession(nebula());
    store.edit({ kind: "color", token: "primary", value: "0 100% 50%" });

    const incoming: ThemeDefinition = { ...cyber(), id: "borrowed", readOnly: false };
    expect(useThemeStore.getState().adopt(incoming)).toBe(false);
    expect(useThemeStore.getState().session!.draft.colors.primary).toBe("0 100% 50%");

    expect(useThemeStore.getState().adopt(incoming, { replace: true })).toBe(true);
    expect(useThemeStore.getState().session!.draft.id).toBe("borrowed");
  });

  /** A saved session has nothing to lose, so it goes ahead unasked. */
  it("replaces a session with no unsaved work without being told twice", () => {
    useThemeStore.getState().beginSession(nebula());
    const incoming: ThemeDefinition = { ...cyber(), id: "borrowed", readOnly: false };
    expect(useThemeStore.getState().adopt(incoming)).toBe(true);
  });
});

describe("the effects a theme asks for", () => {
  beforeEach(freshStore);

  /**
   * A theme's effects are part of it, so changing one is a change to save and
   * an entry in the history like any other.
   */
  it("is an edit like a colour is", () => {
    const store = useThemeStore.getState();
    store.beginSession(nebula());
    store.edit({ kind: "effect", field: "backgroundBlur", value: false });

    const session = useThemeStore.getState().session!;
    expect(session.draft.effects).toEqual({ translucency: true, backgroundBlur: false });
    expect(hasUnsavedChanges(session)).toBe(true);

    useThemeStore.getState().undo();
    expect(hasUnsavedChanges(useThemeStore.getState().session)).toBe(false);
  });

  /**
   * A theme that says nothing about effects means the launcher's own defaults,
   * which is what every bundled theme relies on. Storing it as an opinion
   * anyway would make "no opinion" and "wants exactly the defaults" the same
   * value, and then a later Kiza could never change a default.
   */
  it("leaves a theme that has no opinion alone", () => {
    expect(nebula().effects).toBeUndefined();
    expect(apply(nebula(), { kind: "color", token: "primary", value: "0 0% 50%" }).effects)
      .toBeUndefined();
  });
});
