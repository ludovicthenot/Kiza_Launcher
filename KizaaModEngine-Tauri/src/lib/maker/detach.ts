/**
 * The editor in a window of its own.
 *
 * The panel normally sits beside the launcher, which then cannot be seen at
 * its own size. Detached, it opens in a second window and the launcher gives
 * back the width it borrowed — a designer can put the editor on another
 * screen and look at the launcher whole.
 *
 * Two windows, two pages, one theme. The launcher's window stays the owner:
 * its theme store holds the draft and its inspector does the picking, because
 * that is where the elements are. The editor's window is a remote control:
 *
 *     launcher ── maker://state ──▶ editor     the draft, the history's
 *                                              length, what is picked up
 *     launcher ◀── maker://command ── editor   edit, undo, pick, close…
 *
 * The editor's store is filled from the state it is sent, and its actions are
 * replaced by ones that send a command; the panel itself does not know which
 * window it is in.
 */

import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { hasUnsavedChanges, useThemeStore, type MakerSession, type ThemeEdit } from "../theme/store";
import type { ThemeDefinition } from "../theme/definition";
import { useInspector, type Selection } from "./inspector";
import { returnRoom, takeRoom } from "./session";
import { useMakerWindow } from "./window";

export { useMakerWindow };

const MAIN = "main";
const PANEL = "maker-panel";

/** What the launcher tells the editor, after every change. */
interface Shared {
  session: { baseline: ThemeDefinition; draft: ThemeDefinition; savedAs: string | null; past: number; future: number } | null;
  selecting: boolean;
  selected: Omit<Selection, "element"> | null;
}

type Command =
  | { type: "edit"; edit: ThemeEdit }
  | { type: "undo" | "redo" | "reset" | "attach" | "clear" | "hello" }
  | { type: "markSaved"; savedAs: string | null; as?: ThemeDefinition }
  | { type: "adopt"; theme: ThemeDefinition; options?: { savedAs?: string | null; replace?: boolean } }
  | { type: "endSession"; discard?: boolean }
  | { type: "setSelecting"; on: boolean };

function snapshot(): Shared {
  const session = useThemeStore.getState().session;
  const { selecting, selected } = useInspector.getState();
  return {
    session: session && {
      baseline: session.baseline,
      draft: session.draft,
      savedAs: session.savedAs,
      // Only the lengths: the panel greys Undo and Redo, and a hundred drafts
      // sent on every frame of a drag would be a hundred drafts too many.
      past: session.past.length,
      future: session.future.length,
    },
    selecting,
    selected: selected && {
      kind: selected.kind,
      part: selected.part,
      instance: selected.instance,
      offers: selected.offers,
    },
  };
}

// ---------------------------------------------------------------- launcher

/** Takes the panel out of the launcher, into its own window. */
export async function detachPanel(): Promise<void> {
  if (useMakerWindow.getState().detached) return;
  useMakerWindow.setState({ detached: true });
  await returnRoom();
  try {
    await invoke("open_maker_panel");
  } catch {
    // No window: the panel comes straight back.
    await attachPanel();
  }
}

/** Puts the panel back beside the launcher. */
export async function attachPanel(): Promise<void> {
  if (!useMakerWindow.getState().detached) return;
  useMakerWindow.setState({ detached: false });
  await invoke("close_maker_panel").catch(() => {});
  if (useThemeStore.getState().session) await takeRoom();
}

/**
 * The launcher's half: send the state while detached, and carry out what the
 * editor asks. Started once by the Maker's host; returns its own stop.
 */
export function startLauncherBridge(): () => void {
  let frame = 0;
  const send = () => {
    if (!useMakerWindow.getState().detached) return;
    // Once a frame, however many changes a drag made in it.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => void emitTo(PANEL, "maker://state", snapshot()).catch(() => {}));
  };
  const stops: (() => void)[] = [
    useThemeStore.subscribe(send),
    useInspector.subscribe(send),
    useMakerWindow.subscribe(send),
  ];

  const listening: Promise<UnlistenFn>[] = [
    listen<Command>("maker://command", ({ payload }) => {
      const theme = useThemeStore.getState();
      const inspector = useInspector.getState();
      switch (payload.type) {
        case "hello":
          void emitTo(PANEL, "maker://state", snapshot()).catch(() => {});
          return;
        case "edit":
          theme.edit(payload.edit);
          return;
        case "undo":
          theme.undo();
          return;
        case "redo":
          theme.redo();
          return;
        case "reset":
          theme.reset();
          return;
        case "markSaved":
          theme.markSaved(payload.savedAs, payload.as);
          return;
        case "adopt":
          theme.adopt(payload.theme, payload.options);
          return;
        case "endSession":
          // The editor already asked about unsaved work; this only carries
          // the answer. Closing the editor closes its window too.
          if (theme.endSession({ discard: payload.discard })) {
            useMakerWindow.setState({ detached: false });
            void invoke("close_maker_panel").catch(() => {});
          }
          return;
        case "setSelecting":
          inspector.setSelecting(payload.on);
          return;
        case "clear":
          inspector.clear();
          return;
        case "attach":
          void attachPanel();
          return;
      }
    }),
    // Closed by its own frame: the panel comes back rather than vanishing.
    listen("maker://panel-closed", () => {
      if (!useMakerWindow.getState().detached) return;
      useMakerWindow.setState({ detached: false });
      if (useThemeStore.getState().session) void takeRoom();
    }),
  ];

  return () => {
    cancelAnimationFrame(frame);
    for (const stop of stops) stop();
    for (const pending of listening) void pending.then((unlisten) => unlisten()).catch(() => {});
  };
}

// ------------------------------------------------------------------ editor

function command(payload: Command): void {
  void emitTo(MAIN, "maker://command", payload).catch(() => {});
}

/**
 * The editor's half: the store is filled from what the launcher sends, and
 * every action becomes a command to it. Returns its own stop.
 */
export function startEditorBridge(): () => void {
  useThemeStore.setState({
    edit: (edit) => command({ type: "edit", edit }),
    undo: () => command({ type: "undo" }),
    redo: () => command({ type: "redo" }),
    reset: () => command({ type: "reset" }),
    markSaved: (savedAs, as) => command({ type: "markSaved", savedAs, as: as ?? useThemeStore.getState().session?.draft }),
    adopt: (theme, options) => {
      command({ type: "adopt", theme, options });
      return true;
    },
    endSession: (options) => {
      // Answered here, where the question about unsaved work is asked.
      const session = useThemeStore.getState().session;
      if (!options?.discard && hasUnsavedChanges(session)) return false;
      command({ type: "endSession", discard: options?.discard });
      return true;
    },
  });
  useInspector.setState({
    setSelecting: (on) => command({ type: "setSelecting", on }),
    clear: () => command({ type: "clear" }),
    select: () => {},
  });

  const unlisten = listen<Shared>("maker://state", ({ payload }) => {
    const session: MakerSession | null = payload.session && {
      baseline: payload.session.baseline,
      draft: payload.session.draft,
      savedAs: payload.session.savedAs,
      past: new Array(payload.session.past).fill(payload.session.baseline),
      future: new Array(payload.session.future).fill(payload.session.baseline),
    };
    useThemeStore.setState({ session });
    useInspector.setState({
      selecting: payload.selecting,
      // The element lives in the other window; the panel only reads the
      // names, and the body stands in for the node it never touches.
      selected: payload.selected && { ...payload.selected, element: document.body },
    });
  });
  command({ type: "hello" });

  return () => void unlisten.then((stop) => stop()).catch(() => {});
}

/** Asks the launcher to take the panel back. */
export function requestAttach(): void {
  command({ type: "attach" });
}
