/**
 * What theme the launcher shows, and what somebody is editing.
 *
 * Those are two different questions and the store keeps them apart. `appliedId`
 * is the theme Kiza runs with — chosen in Settings, persisted, and the only
 * thing that matters outside the Maker. A `session` is a piece of work in
 * progress: a draft, what it started from, and where it would be saved.
 *
 * While a session is open the launcher paints the draft, so a designer sees the
 * real thing rather than a preview of it. Closing the session paints the applied
 * theme again. Nothing in the launcher is asked to know which of the two it is
 * looking at.
 *
 *     applied theme ─┐
 *                    ├─ effective theme → engine → the window
 *     session draft ─┘
 *
 * Every edit is a value, not a mutation: `apply` takes a draft and an edit and
 * returns a new draft. That is what makes undo a list of drafts rather than a
 * rewrite — `past` and `future` are already here and already maintained; only
 * the two actions that read them are missing, and they are four lines each.
 */

import { create } from "zustand";
import { applyAppearance, getStoredAppearance } from "../appearance";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "./builtin";
import { applyTheme } from "./engine";
import { effectsOf } from "./definition";
import type {
  AmbientStop,
  AssetSlot,
  ColorToken,
  ThemeDefinition,
  ThemeEffects,
} from "./definition";

/** One change a person made. Typed so a history can replay or invert them. */
export type ThemeEdit =
  | { kind: "color"; token: ColorToken; value: string }
  | { kind: "ambient"; index: 0 | 1; stop: Partial<AmbientStop> }
  | { kind: "radius"; value: number | undefined }
  | { kind: "asset"; slot: AssetSlot; url: string | undefined }
  | { kind: "effect"; field: keyof ThemeEffects; value: boolean }
  | { kind: "component"; component: string; property: string; value: string | undefined }
  | { kind: "layout"; part: string; property: string; value: string | undefined }
  | { kind: "meta"; field: "name" | "description" | "author" | "version"; value: string };

/** A piece of work in progress. */
export interface MakerSession {
  /**
   * What the draft started from.
   *
   * Save compares against this and Reset returns to it. It is replaced on save,
   * so "changed" always means "changed since the last time this was written
   * down" rather than "changed since the Maker opened".
   */
  baseline: ThemeDefinition;
  draft: ThemeDefinition;
  /** The file a Save would overwrite, or null for a theme never written out. */
  savedAs: string | null;
  /** Drafts behind and ahead of this one. Maintained now, read later. */
  past: ThemeDefinition[];
  future: ThemeDefinition[];
}

/** How many drafts back a history may reach. */
const HISTORY_LIMIT = 100;

/** Whether two themes would paint the window identically. */
export function sameTheme(left: ThemeDefinition, right: ThemeDefinition): boolean {
  return JSON.stringify(normalised(left)) === JSON.stringify(normalised(right));
}

/**
 * A theme with its keys in a fixed order.
 *
 * Comparison is by serialisation, which is only honest if two themes that mean
 * the same thing serialise the same way. Object key order in JavaScript follows
 * insertion, and an edit inserts.
 */
function normalised(theme: ThemeDefinition): unknown {
  const colors: Record<string, string> = {};
  for (const token of Object.keys(theme.colors).sort()) {
    colors[token] = theme.colors[token as ColorToken];
  }
  const assets: Record<string, string> = {};
  for (const slot of Object.keys(theme.assets ?? {}).sort()) {
    const value = theme.assets?.[slot as AssetSlot];
    if (value !== undefined) assets[slot] = value;
  }
  return {
    id: theme.id,
    name: theme.name,
    description: theme.description,
    author: theme.author ?? null,
    version: theme.version ?? null,
    radius: theme.radius ?? null,
    effects: effectsOf(theme),
    components: sortedTwice(theme.components),
    // Placement belongs in the comparison for the same reason everything else
    // does, and leaving it out was not a missing nicety: an edit that does not
    // change the theme is dropped before it is applied, so every move, resize
    // and rotation was discarded on its way in. The tool worked, the drag
    // worked, and nothing happened.
    layout: sortedTwice(theme.layout),
    colors,
    assets,
    ambient: theme.ambient.map((stop) => [stop.color, stop.alpha]),
  };
}

/** A map of maps with every key in a fixed order, for comparison. */
function sortedTwice(
  values: Record<string, Record<string, string>> | undefined,
): Record<string, Record<string, string>> {
  const outer: Record<string, Record<string, string>> = {};
  for (const name of Object.keys(values ?? {}).sort()) {
    const inner = values![name];
    const sorted: Record<string, string> = {};
    for (const key of Object.keys(inner).sort()) sorted[key] = inner[key];
    outer[name] = sorted;
  }
  return outer;
}

/** Applies one edit and returns a new theme. Never mutates its argument. */
export function apply(theme: ThemeDefinition, edit: ThemeEdit): ThemeDefinition {
  switch (edit.kind) {
    case "color":
      return { ...theme, colors: { ...theme.colors, [edit.token]: edit.value } };
    case "ambient": {
      const ambient: [AmbientStop, AmbientStop] = [theme.ambient[0], theme.ambient[1]];
      ambient[edit.index] = { ...ambient[edit.index], ...edit.stop };
      return { ...theme, ambient };
    }
    case "radius":
      return { ...theme, radius: edit.value };
    case "asset": {
      const assets = { ...(theme.assets ?? {}) };
      if (edit.url === undefined) delete assets[edit.slot];
      else assets[edit.slot] = edit.url;
      return { ...theme, assets };
    }
    case "component": {
      const components = { ...(theme.components ?? {}) };
      const properties = { ...(components[edit.component] ?? {}) };
      if (edit.value === undefined) delete properties[edit.property];
      else properties[edit.property] = edit.value;
      // A component with nothing left to say is dropped rather than kept as an
      // empty object: "this theme has an opinion about cards" and "this theme
      // mentions cards" should not be able to differ.
      if (Object.keys(properties).length === 0) delete components[edit.component];
      else components[edit.component] = properties;
      return { ...theme, components };
    }
    case "layout": {
      const layout = { ...(theme.layout ?? {}) };
      const values = { ...(layout[edit.part] ?? {}) };
      if (edit.value === undefined) delete values[edit.property];
      else values[edit.property] = edit.value;
      // An element with nothing left to say about it is dropped, so "this
      // theme places the title" and "this theme mentions the title" cannot
      // differ — the same rule the components follow.
      if (Object.keys(values).length === 0) delete layout[edit.part];
      else layout[edit.part] = values;
      return { ...theme, layout };
    }
    case "effect":
      // Stored filled in rather than as the one field that changed: a theme
      // that has been through the Maker should say what it wants outright,
      // instead of leaving half of it to whatever a later Kiza defaults to.
      return { ...theme, effects: { ...effectsOf(theme), [edit.field]: edit.value } };
    case "meta":
      return { ...theme, [edit.field]: edit.value };
  }
}

interface ThemeStore {
  /** The theme Kiza runs with when nobody is editing. */
  appliedId: string;
  /** Every theme that can be chosen: the bundled ones and any imported. */
  available: ThemeDefinition[];
  session: MakerSession | null;

  setApplied: (id: string) => void;
  setAvailable: (themes: ThemeDefinition[]) => void;

  /** Starts editing. A bundled theme is copied rather than edited in place. */
  beginSession: (from: ThemeDefinition) => void;
  /**
   * Puts a whole theme in the session's place.
   *
   * What importing does. The alternative — replaying the file as a hundred
   * edits onto whatever was already there — leaves behind everything the new
   * theme does not mention: the old theme's assets, its ambient stops, its
   * name half-changed, and a history in which none of it happened. This is one
   * step: a new baseline, a new draft, an empty history.
   *
   * Refuses over unsaved work unless told to `replace`, for the same reason
   * `endSession` does. Returns whether it went ahead.
   */
  adopt: (theme: ThemeDefinition, options?: { savedAs?: string | null; replace?: boolean }) =>
    boolean;
  edit: (edit: ThemeEdit) => void;
  /** Back to the last thing written down. */
  reset: () => void;
  /** The draft has been written somewhere; it becomes the new reference. */
  markSaved: (savedAs: string | null, as?: ThemeDefinition) => void;
  /**
   * Ends the session.
   *
   * Refuses to throw away unsaved work: closing with changes and without
   * `discard` leaves the session exactly where it was, so the window can ask
   * first. Returns whether it actually closed.
   */
  endSession: (options?: { discard?: boolean }) => boolean;

  undo: () => void;
  redo: () => void;
}

/** The theme the window should be painting right now. */
export function effectiveTheme(state: Pick<ThemeStore, "appliedId" | "available" | "session">) {
  if (state.session) return state.session.draft;
  return (
    state.available.find((theme) => theme.id === state.appliedId) ??
    BUILT_IN_THEMES.find((theme) => theme.id === DEFAULT_THEME_ID)!
  );
}

/** Whether the session has changes that are not written down. */
export function hasUnsavedChanges(session: MakerSession | null): boolean {
  return session !== null && !sameTheme(session.baseline, session.draft);
}

/** A bundled theme is never edited in place. */
function editableCopy(from: ThemeDefinition): ThemeDefinition {
  if (!from.readOnly) return { ...from };
  return {
    ...from,
    id: `${from.id}-copy`,
    name: `${from.name} copy`,
    readOnly: false,
  };
}

/**
 * What a run of edits is a run *of*.
 *
 * Dragging a slider or typing a colour is one intention, and it arrives as
 * thirty or forty edits. Recorded as thirty history entries, Undo stops
 * meaning "take back what I just did" and starts meaning "take back one pixel
 * of it", which is worse than useless — you press it six times and the theme
 * has barely moved. So consecutive edits to the same thing collapse into one
 * step, and the history holds gestures rather than keystrokes.
 */
function runKey(edit: ThemeEdit): string {
  switch (edit.kind) {
    case "color":
      return `color:${edit.token}`;
    case "ambient":
      return `ambient:${edit.index}:${Object.keys(edit.stop).sort().join(",")}`;
    case "radius":
      return "radius";
    case "asset":
      return `asset:${edit.slot}`;
    case "component":
      return `component:${edit.component}:${edit.property}`;
    case "layout":
      // By element, not by property. A drag writes across and down on the same
      // frame, so keying on the property would alternate between two runs and
      // record two history entries per mouse move — Undo would then take back
      // half a pixel of a move at a time. The whole gesture is one thing
      // somebody did.
      return `layout:${edit.part}`;
    case "effect":
      return `effect:${edit.field}`;
    case "meta":
      return `meta:${edit.field}`;
  }
}

/**
 * How long a pause ends a run.
 *
 * Long enough to cover a slider being dragged slowly or somebody typing a
 * colour a character at a time; short enough that coming back to the same
 * field after a look at the launcher is a new step, which is what a person
 * would expect Undo to take back.
 */
const RUN_PAUSE_MS = 700;

let runningKey: string | null = null;
let runningAt = 0;

/**
 * Ends the current run.
 *
 * Anything that moves the history itself — undo, redo, reset, a save, a theme
 * arriving — has to break the run, or the next edit would fold itself into a
 * step that is no longer the one on top.
 */
function endRun(): void {
  runningKey = null;
  runningAt = 0;
}

function remember(session: MakerSession, next: ThemeDefinition): MakerSession {
  return {
    ...session,
    past: [...session.past, session.draft].slice(-HISTORY_LIMIT),
    future: [],
    draft: next,
  };
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  appliedId: DEFAULT_THEME_ID,
  available: [...BUILT_IN_THEMES],
  session: null,

  setApplied: (id) => set({ appliedId: id }),
  setAvailable: (themes) => set({ available: themes }),

  beginSession: (from) => {
    endRun();
    const draft = editableCopy(from);
    set({
      session: { baseline: draft, draft, savedAs: null, past: [], future: [] },
    });
  },

  adopt: (theme, options) => {
    endRun();
    const session = get().session;
    if (session && hasUnsavedChanges(session) && !options?.replace) return false;
    const draft = editableCopy(theme);
    set({
      session: {
        baseline: draft,
        draft,
        savedAs: options?.savedAs ?? null,
        past: [],
        future: [],
      },
    });
    return true;
  },

  edit: (edit) => {
    const session = get().session;
    if (!session) return;
    const next = apply(session.draft, edit);
    if (sameTheme(next, session.draft)) return;

    const now = Date.now();
    const key = runKey(edit);
    const continuing = key === runningKey && now - runningAt < RUN_PAUSE_MS;
    runningKey = key;
    runningAt = now;

    set({
      session: continuing
        ? // Still the same gesture: the draft moves on, the history does not
          // gain a step. Anything ahead is still discarded — editing after an
          // undo abandons the redo, run or no run.
          { ...session, draft: next, future: [] }
        : remember(session, next),
    });
  },

  reset: () => {
    endRun();
    const session = get().session;
    if (!session) return;
    set({ session: remember(session, session.baseline) });
  },

  markSaved: (savedAs, as) => {
    endRun();
    const session = get().session;
    if (!session) return;
    const saved = as ?? session.draft;
    set({ session: { ...session, baseline: saved, draft: saved, savedAs } });
  },

  endSession: (options) => {
    endRun();
    const session = get().session;
    if (!session) return true;
    if (!options?.discard && hasUnsavedChanges(session)) return false;
    set({ session: null });
    return true;
  },

  undo: () => {
    endRun();
    const session = get().session;
    if (!session || session.past.length === 0) return;
    const previous = session.past[session.past.length - 1];
    set({
      session: {
        ...session,
        past: session.past.slice(0, -1),
        future: [session.draft, ...session.future].slice(0, HISTORY_LIMIT),
        draft: previous,
      },
    });
  },

  redo: () => {
    endRun();
    const session = get().session;
    if (!session || session.future.length === 0) return;
    const [next, ...rest] = session.future;
    set({
      session: {
        ...session,
        past: [...session.past, session.draft].slice(-HISTORY_LIMIT),
        future: rest,
        draft: next,
      },
    });
  },
}));

/**
 * Paints whatever the store says should be on screen.
 *
 * Subscribed once, here, rather than from a component: painting is not
 * rendering, and a component that had to remember to do it is a component that
 * will forget. Repainting only when the theme actually differs keeps a colour
 * drag from writing the same twenty-one properties on every mouse move.
 */
let painted: ThemeDefinition | null = null;

export function startPainting(): () => void {
  const paint = () => {
    const next = effectiveTheme(useThemeStore.getState());
    if (painted && sameTheme(painted, next) && painted.id === next.id) return;
    painted = next;
    applyTheme(next);
    // The theme is the base and what somebody chose in Settings goes over it,
    // always in that order and always here. Painting a theme without this would
    // drop a custom accent every time a colour changed in the Maker.
    applyAppearance(getStoredAppearance());
  };
  paint();
  return useThemeStore.subscribe(paint);
}
