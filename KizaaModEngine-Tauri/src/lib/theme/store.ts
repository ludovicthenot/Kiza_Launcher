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
import type { AmbientStop, AssetSlot, ColorToken, ThemeDefinition } from "./definition";

/** One change a person made. Typed so a history can replay or invert them. */
export type ThemeEdit =
  | { kind: "color"; token: ColorToken; value: string }
  | { kind: "ambient"; index: 0 | 1; stop: Partial<AmbientStop> }
  | { kind: "radius"; value: number | undefined }
  | { kind: "asset"; slot: AssetSlot; url: string | undefined }
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
    colors,
    assets,
    ambient: theme.ambient.map((stop) => [stop.color, stop.alpha]),
  };
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
    const draft = editableCopy(from);
    set({
      session: { baseline: draft, draft, savedAs: null, past: [], future: [] },
    });
  },

  edit: (edit) => {
    const session = get().session;
    if (!session) return;
    const next = apply(session.draft, edit);
    if (sameTheme(next, session.draft)) return;
    set({ session: remember(session, next) });
  },

  reset: () => {
    const session = get().session;
    if (!session) return;
    set({ session: remember(session, session.baseline) });
  },

  markSaved: (savedAs, as) => {
    const session = get().session;
    if (!session) return;
    const saved = as ?? session.draft;
    set({ session: { ...session, baseline: saved, draft: saved, savedAs } });
  },

  endSession: (options) => {
    const session = get().session;
    if (!session) return true;
    if (!options?.discard && hasUnsavedChanges(session)) return false;
    set({ session: null });
    return true;
  },

  undo: () => {
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
