/**
 * What the Component Inspector is pointing at.
 *
 * Two pieces of state and nothing else: whether the select tool is on, and
 * which element was last clicked with it. Both are about the session a
 * designer is in, not about the theme, so neither belongs in the theme store —
 * selecting a card is not an edit and must not make a theme look unsaved.
 *
 * The selected element is held as the DOM node itself. That is unusual for a
 * store and it is the honest thing here: the inspector outlines a real element
 * in the real launcher, and there is no identifier for "that card" that would
 * survive the list re-rendering anyway. Anything reading it re-checks that the
 * node is still in the document, and the inspector drops the selection when it
 * is not.
 *
 * Only the Maker imports this.
 */

import { create } from "zustand";
import { CATALOGUE, type EditableComponent } from "./catalogue";
import type { ComponentKind } from "./editable";

export interface Selection {
  kind: ComponentKind;
  element: HTMLElement;
}

interface InspectorState {
  /** Whether clicks pick components instead of working the launcher. */
  selecting: boolean;
  selected: Selection | null;

  setSelecting: (on: boolean) => void;
  select: (selection: Selection) => void;
  /**
   * Puts the selection down.
   *
   * Escape does this, and Escape again turns the tool off — a staircase out
   * rather than one key that means two things at once.
   */
  clear: () => void;
}

export const useInspector = create<InspectorState>((set) => ({
  selecting: false,
  selected: null,

  setSelecting: (on) => set({ selecting: on, selected: on ? undefined : null }),
  select: (selection) => set({ selected: selection }),
  clear: () => set({ selected: null }),
}));

/** What the selected component exposes, or nothing when nothing is selected. */
export function selectedComponent(state: InspectorState): EditableComponent | null {
  return state.selected ? CATALOGUE[state.selected.kind] : null;
}
