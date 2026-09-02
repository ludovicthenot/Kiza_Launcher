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
 * in the real launcher, and a node is what an outline needs. It is held
 * alongside the component's kind and, where the component has one, the name of
 * the particular instance — the node for drawing, the names for deciding.
 * Anything reading the node re-checks that it is still in the document, and
 * the inspector drops the selection when it is not.
 *
 * Only the Maker imports this.
 *
 * Where this is going, so that it keeps going there:
 *
 *     drag on the real component
 *          ↓
 *     the drop zone under the pointer
 *          ↓
 *     order · row · column · span · alignment
 *          ↓
 *     ThemeDefinition
 *          ↓
 *     the launcher's own responsive layout
 *
 * A move must never become `position: absolute` and a pair of pixel offsets.
 * That would look right on the desk it was made on and fall apart on the next
 * window size, the next resolution, the next scale factor — and it would take
 * the launcher's layout out of the launcher's hands, which is the one thing
 * the theme engine is built to avoid. What a drag produces is a *decision*
 * about the arrangement, in the vocabulary the layout already speaks, and the
 * layout goes on deciding where that puts things.
 *
 * Two consequences the current code already respects, and must keep
 * respecting. A move is an edit like any other, so it goes through the theme
 * store and inherits Undo, Redo and the unsaved-work guard for nothing. And a
 * move is about one component rather than every component of its kind, which
 * is why a selection records which one was picked up.
 */

import { create } from "zustand";
import { CATALOGUE, type EditableComponent } from "./catalogue";
import type { ComponentKind } from "./editable";

export interface Selection {
  /**
   * What the element is one of, when it is one of something.
   *
   * Null for an element that carries only a name — an icon, a line of small
   * text. Those have nothing to style as a class, and everything to place: you
   * can move them, resize them, turn them, or take them off the page. A
   * component with no kind is still a component somebody can point at, which
   * is the whole reason this is nullable rather than a reason to refuse the
   * selection.
   */
  kind: ComponentKind | null;
  /**
   * Its name in the theme file, when it has one.
   *
   * A kind is shared by every card; a part is this card. Placement needs the
   * second, which is why an element that can be moved has to be named in the
   * launcher rather than found by walking the tree.
   */
  part: string | null;
  element: HTMLElement;
  /**
   * Which one, when the component has more than one of itself on screen.
   *
   * Nothing reads this yet, and it is here rather than later on purpose.
   * Styling a component styles every one of its kind — that is the decision,
   * and it is why the panel says "every instance card in the library". Moving
   * one is the opposite: a card dragged in front of another is a statement
   * about *that* card, and there is no way to express it without knowing which
   * card was picked up. Recording it at the moment of selection is free;
   * recovering it afterwards, from a DOM node in a list that has re-rendered,
   * is not.
   */
  instance: string | null;
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

  // Turning the tool off puts down whatever it was holding: an outline over a
  // launcher you can click again would be a lie about what is selected.
  setSelecting: (on) => set(on ? { selecting: true } : { selecting: false, selected: null }),
  select: (selection) => set({ selected: selection }),
  clear: () => set({ selected: null }),
}));

/** What the selected component exposes, or nothing when nothing is selected. */
export function selectedComponent(state: InspectorState): EditableComponent | null {
  return state.selected?.kind ? CATALOGUE[state.selected.kind] : null;
}
