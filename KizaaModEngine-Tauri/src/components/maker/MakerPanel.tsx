/**
 * Kiza Maker.
 *
 * A panel beside the launcher, not in front of it. Everything to the left is
 * the real Kiza — the real pages, the real components, still navigable — and it
 * is painted by the draft this panel is editing. There is no preview here
 * because there is nothing to preview: the launcher is the preview.
 *
 * Only ever rendered in the Maker edition. `IS_MAKER` is a literal after
 * bundling, so a Stable build drops this file and everything it imports.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  BringToFront,
  ChevronLeft,
  ChevronRight,
  SendToBack,
  Download,
  ExternalLink,
  PanelRightClose,
  MousePointerSquareDashed,
  Move,
  Palette,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { getStoredAppearance } from "../../lib/appearance";
import {
  COLOR_TOKENS,
  effectsOf,
  type AssetSlot,
  type ColorToken,
  type ThemeDefinition,
} from "../../lib/theme/definition";
import { hasUnsavedChanges, useThemeStore, type ThemeEdit } from "../../lib/theme/store";
import {
  closeMaker,
  loadInstalled,
  PANEL_WIDTH,
  toDefinition,
  toManifest,
  type InstalledTheme,
} from "../../lib/maker/session";
import {
  ASSET_LIMITS,
  bundledAsset,
  isMotionAsset,
  MOTION_SLOT,
  VIDEO_EXTENSIONS,
} from "../../lib/theme/assets";
import { cn } from "../../lib/utils";
import { AssetCard, ColourRow, Panel, SliderRow, SwitchRow, TextRow } from "./controls";
import { SlidingPill } from "../ui/sliding-pill";
import { LOCKED_PARTS } from "../../lib/theme/values";
import { CATALOGUE, type EditableComponent, type EditableProperty } from "../../lib/maker/catalogue";
import { useInspector, type Selection } from "../../lib/maker/inspector";
import { partLabel } from "../../lib/theme/parts";

/** The colours worth putting first, in the order a designer reaches for them. */
const HEADLINE: { token: ColorToken; label: string; hint: string }[] = [
  { token: "primary", label: "Accent", hint: "Play, Create, the waves' light." },
  { token: "background", label: "Background", hint: "The window behind everything." },
  { token: "card", label: "Surfaces", hint: "Cards, panels and lists." },
  { token: "foreground", label: "Text", hint: "Titles and everything you read." },
  { token: "muted-foreground", label: "Quiet text", hint: "Hints, dates, counts." },
  { token: "border", label: "Lines", hint: "Edges and dividers." },
];

/** What the rest of the colours are, said for somebody who is not a developer. */
const MORE_LABELS: Partial<Record<ColorToken, string>> = {
  "card-foreground": "Text on surfaces",
  popover: "Menus and dialogues",
  "popover-foreground": "Text in menus",
  "primary-foreground": "Text on the accent",
  secondary: "Buttons and fields",
  "secondary-foreground": "Text on buttons",
  muted: "Tracks and wells",
  accent: "Highlights",
  "accent-foreground": "Text on highlights",
  destructive: "Danger",
  "destructive-foreground": "Text on danger",
  input: "Field edges",
  ring: "Focus ring",
};

const REST = COLOR_TOKENS.filter(
  (token) => !HEADLINE.some((entry) => entry.token === token),
);

const SLOTS: { slot: AssetSlot; label: string; hint: string }[] = [
  { slot: "logo", label: "Logo", hint: "The start screen, About and the updater." },
  { slot: "logoCompact", label: "Title bar mark", hint: "The small square beside the launcher's name." },
  { slot: "background", label: "Background", hint: "Replaces the waves. A picture, a GIF or a short video." },
];

type Tab = "theme" | "assets" | "effects";

const TABS: { id: Tab; label: string }[] = [
  { id: "theme", label: "Colours" },
  { id: "assets", label: "Pictures" },
  { id: "effects", label: "Effects" },
];

/**
 * Where each slot's picture lives on disk.
 *
 * The theme holds URLs the window can draw; exporting needs the files behind
 * them. Kept beside the draft rather than in it, because a URL that came out of
 * a `.kizatheme` has a path and one bundled with Kiza does not.
 */
type AssetPaths = Partial<Record<AssetSlot, string>>;

export function MakerPanel({ detached = false }: { detached?: boolean }) {
  const session = useThemeStore((state) => state.session);
  const edit = useThemeStore((state) => state.edit);
  const reset = useThemeStore((state) => state.reset);
  const markSaved = useThemeStore((state) => state.markSaved);
  const adopt = useThemeStore((state) => state.adopt);
  const undo = useThemeStore((state) => state.undo);
  const redo = useThemeStore((state) => state.redo);

  const [tab, setTab] = useState<Tab>("theme");
  const [showAll, setShowAll] = useState(false);
  const [paths, setPaths] = useState<AssetPaths>({});
  const [leaving, setLeaving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);

  const dirty = hasUnsavedChanges(session);
  const draft = session?.draft;

  // The select tool and what it is pointing at. Neither is part of the theme:
  // selecting a card is not an edit, and must not make a theme look unsaved.
  const selecting = useInspector((state) => state.selecting);
  const setSelecting = useInspector((state) => state.setSelecting);
  const selected = useInspector((state) => state.selected);
  const component = selected?.kind ? CATALOGUE[selected.kind] : null;

  const pictures = useMemo(() => ["png", "jpg", "jpeg", "webp", "gif", "avif"], []);
  /** What a given slot will take. Only the background moves. */
  const accepts = useMemo(
    () => (slot: AssetSlot) =>
      slot === MOTION_SLOT ? [...pictures, ...VIDEO_EXTENSIONS] : pictures,
    [pictures],
  );

  /**
   * A file dragged onto the window, and the slot it landed on.
   *
   * The runtime hands over a path and a position in physical pixels; the
   * document is asked what is at that position, and the answer is the slot.
   * That is the whole of it — but three things about it have to be exactly
   * right, and each of them looked identical when it was wrong: nothing
   * happened.
   *
   * The listener is attached once. An effect with no dependency list re-runs
   * on every render, and the first drag event renders — so the listeners were
   * being torn down and rebuilt in the middle of the gesture and the drop fell
   * into the gap. The current handler is reached through a ref instead.
   *
   * The webview's own drag and drop stays off (`dragDropEnabled` in the window
   * configuration). That is what makes the drop arrive as a path rather than a
   * copy of the file, which is the difference between staging a video and
   * carrying twenty megabytes across the bridge to write them out again.
   *
   * And the position is divided by the device pixel ratio, because the runtime
   * counts real pixels and the document counts CSS ones. On a 150% display the
   * undivided point is a third of the way off the panel.
   */
  const [over, setOver] = useState<AssetSlot | null>(null);
  const accept = useRef<(slot: AssetSlot, path: string) => void>(() => {});

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;

    const slotAt = (position: { x: number; y: number }): AssetSlot | null => {
      const ratio = window.devicePixelRatio || 1;
      const element = document.elementFromPoint(position.x / ratio, position.y / ratio);
      const named = element?.closest("[data-kiza-drop]")?.getAttribute("data-kiza-drop");
      return SLOTS.find((entry) => entry.slot === named)?.slot ?? null;
    };

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "leave") {
          setOver(null);
          return;
        }
        if (payload.type === "enter" || payload.type === "over") {
          setOver(slotAt(payload.position));
          return;
        }
        setOver(null);
        const slot = slotAt(payload.position);
        const path = payload.paths[0];
        // A file dropped on the panel but not on a slot is not an accident
        // worth guessing about: there are three slots, and the one under the
        // pointer is the one that was meant.
        if (slot && path) accept.current(slot, path);
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch(() => {
        // Losing drag and drop must not take the launcher with it: the file
        // picker is still there, and it is the same code path from here on.
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  // What the draft asks for, and whether the person at this keyboard has
  // already decided otherwise in Settings. The theme is a recommendation; a
  // switch somebody has touched is not, so the panel says which is winning
  // instead of letting a designer wonder why nothing moved.
  const effects = effectsOf(draft ?? null);
  const preference = getStoredAppearance();
  const overridden = {
    translucency: preference.translucency !== null,
    backgroundBlur: preference.backgroundBlur !== null,
  };

  if (!session || !draft) return null;

  /**
   * Takes a picture the designer chose and puts it in the theme.
   *
   * The file is copied into the launcher's own theme folder before it is
   * drawn. That is not a detour: the window may only read pictures from that
   * one folder, and the alternative — letting the page read anywhere the file
   * picker can reach — would be handing a theme the whole disk. The backend
   * also refuses a file that is too heavy or not a picture at all, which is
   * why this says why rather than failing quietly.
   *
   * The extension and the dimensions are checked here first, because a browser
   * answers both cheaply and it was going to decode the picture anyway. The
   * backend still has the final say.
   */
  const usePicture = async (slot: AssetSlot, path: string) => {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    if (!accepts(slot).includes(extension)) {
      const moving = (VIDEO_EXTENSIONS as readonly string[]).includes(extension);
      toast.error(
        moving
          ? "A video can only be the background. A logo has to be a picture."
          : `${extension || "That file"} is not a picture a theme can use.`,
      );
      return;
    }

    let staged: string;
    try {
      staged = await invoke<string>("stage_theme_asset", { slot, source: path });
    } catch (error) {
      toast.error(String(error));
      return;
    }
    await showPicture(slot, staged, extension);
  };

  /** Measures what was staged, then puts it in the draft. */
  const showPicture = async (slot: AssetSlot, staged: string, extension: string) => {
    // No cache-busting query: the staged file already carries the moment it was
    // taken in its name, so the address is new every time. A query would have
    // to survive the asset protocol's own parsing, and there is no reason to
    // find out whether it does.
    const url = convertFileSrc(staged);
    const moving = (VIDEO_EXTENSIONS as readonly string[]).includes(extension);
    const measured = moving ? await measureVideo(url) : await measurePicture(url);
    if (!measured) {
      toast.error(
        moving
          ? "Kiza could not play that video, even though it accepted the file."
          : "Kiza could not draw that picture, even though it accepted the file.",
      );
      return;
    }

    const longest = Math.max(measured.width, measured.height);
    // A still can be large because it is decoded once. Anything that moves is
    // decoded for as long as it is on screen, which is why it is held to the
    // smaller of the two ceilings.
    const animated = moving || extension === "gif" || extension === "webp";
    const ceiling = animated ? ASSET_LIMITS.maxAnimatedDimension : ASSET_LIMITS.maxDimension;
    if (longest > ceiling) {
      toast.error(
        `That ${moving ? "video" : "picture"} is ${longest}px on its longest edge; ${animated ? "something that moves" : "a picture"} may be ${ceiling}px.`,
      );
      return;
    }
    if (moving && measured.seconds > ASSET_LIMITS.maxVideoSeconds) {
      toast.error(
        `That video runs ${Math.round(measured.seconds)} seconds; a background may run ${ASSET_LIMITS.maxVideoSeconds}. A background loops — it does not need to be long.`,
      );
      return;
    }

    setPaths((current) => ({ ...current, [slot]: staged }));
    edit({ kind: "asset", slot, url });
  };

  // Attached once above, pointed here on every render.
  accept.current = (slot, path) => void usePicture(slot, path);

  const pick = async (slot: AssetSlot) => {
    const chosen = await openFileDialog({
      multiple: false,
      filters: [
        {
          name: slot === MOTION_SLOT ? "Pictures and video" : "Pictures",
          extensions: [...accepts(slot)],
        },
      ],
    });
    if (typeof chosen === "string") await usePicture(slot, chosen);
  };

  const revert = (slot: AssetSlot) => {
    setPaths((current) => {
      const next = { ...current };
      delete next[slot];
      return next;
    });
    edit({ kind: "asset", slot, url: undefined });
  };

  const exportTheme = async (): Promise<boolean> => {
    const destination = await saveFileDialog({
      defaultPath: `${draft.id}.kizatheme`,
      filters: [{ name: "Kiza theme", extensions: ["kizatheme"] }],
    });
    if (typeof destination !== "string") return false;
    setBusy(true);
    try {
      await invoke("export_theme", {
        destination,
        manifest: toManifest(draft, paths as Record<string, string>),
        assets: paths,
      });
      markSaved(destination);
      toast.success(`Saved to ${destination.split(/[\\/]/).pop()}`);
      return true;
    } catch (error) {
      toast.error(String(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<boolean> => {
    // Save with somewhere to save to is a write; without one it is Save As.
    if (!session.savedAs) return exportTheme();
    setBusy(true);
    try {
      await invoke("export_theme", {
        destination: session.savedAs,
        manifest: toManifest(draft, paths as Record<string, string>),
        assets: paths,
      });
      markSaved(session.savedAs);
      toast.success("Saved");
      return true;
    } catch (error) {
      toast.error(String(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Opens a `.kizatheme` and works on that instead.
   *
   * An import replaces the session outright — new baseline, new draft, empty
   * history — rather than being replayed as a run of edits onto whatever was
   * open. Replaying leaves behind everything the incoming theme does not
   * mention: the previous assets, its ambient stops, a history in which none of
   * this happened, and a Reset that returns to a theme nobody is editing any
   * more.
   *
   * The backend reads and validates the archive first, so nothing is replaced
   * on account of a file that turns out not to be a theme.
   */
  const importTheme = async (replace = false) => {
    if (dirty && !replace) {
      setReplacing(true);
      return;
    }
    const chosen = await openFileDialog({
      multiple: false,
      filters: [{ name: "Kiza theme", extensions: ["kizatheme"] }],
    });
    if (typeof chosen !== "string") return;
    setBusy(true);
    try {
      const installed = await invoke<InstalledTheme>("import_theme", { archivePath: chosen });
      await loadInstalled(convertFileSrc);
      adopt(toDefinition(installed, convertFileSrc), { savedAs: chosen, replace: true });
      const next: AssetPaths = {};
      for (const [slot, path] of Object.entries(installed.assets)) {
        next[slot as AssetSlot] = path;
      }
      setPaths(next);
      toast.success(`${installed.manifest.name} imported`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (await closeMaker()) return;
    setLeaving(true);
  };

  const backdrop = draft.components?.backdrop ?? {};
  const setBackdrop = (property: string, value: string | undefined) =>
    edit({ kind: "component", component: "backdrop", property, value });
  const glow = backdrop.glow ?? draft.colors.primary;

  return (
    <>
      <aside
        // Beside the launcher, under its title bar; in its own window, all of it.
        style={detached ? undefined : { width: PANEL_WIDTH, paddingTop: "var(--kiza-titlebar, 3.5rem)" }}
        data-anim="maker-panel"
        className={cn("flex shrink-0 flex-col", detached ? "w-full p-2" : "pb-2 pr-2")}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-[hsl(var(--card)/0.86)] shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.08),0_24px_60px_-28px_hsl(0_0%_0%/0.9)]">
          <header className="px-4 pb-3 pt-3.5">
            <div className="flex items-center gap-3">
              {/* The Maker's mark: a tile in the theme's own colour, which
                  changes as the designer changes it. */}
              <span className="kiza-action flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-primary-foreground">
                <Palette className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em]">{draft.name || "Untitled theme"}</h2>
                  {dirty && (
                    <span
                      title="Changes not saved to a file yet"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400/[0.13] px-1.5 py-px text-[10.5px] font-semibold text-amber-300"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      Unsaved
                    </span>
                  )}
                </div>
                <p className="truncate text-[11.5px] text-muted-foreground">
                  Kiza Maker{session.savedAs ? ` · ${session.savedAs.split(/[\\/]/).pop()}` : " · not saved yet"}
                </p>
              </div>
              {/* Out of the launcher and into a window of its own, so the
                  launcher can be seen whole — or back in beside it. */}
              <button
                type="button"
                onClick={() =>
                  void import("../../lib/maker/detach").then((bridge) =>
                    detached ? bridge.requestAttach() : bridge.detachPanel(),
                  )
                }
                title={detached ? "Put the editor back beside the launcher" : "Open the editor in its own window"}
                aria-label={detached ? "Put the editor back beside the launcher" : "Open the editor in its own window"}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-secondary hover:text-foreground active:scale-90"
              >
                {detached ? <PanelRightClose className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => void leave()}
                title="Close the editor"
                aria-label="Close the editor"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-secondary hover:text-foreground active:scale-90"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-1.5">
              <div className="flex items-center rounded-full bg-secondary/45 p-0.5">
                <Action icon={Undo2} label="Undo" disabled={session.past.length === 0} onClick={undo} />
                <Action icon={Redo2} label="Redo" disabled={session.future.length === 0} onClick={redo} />
                <Action icon={RotateCcw} label="Back to the last save" disabled={!dirty} onClick={reset} />
              </div>
              <div className="flex items-center rounded-full bg-secondary/45 p-0.5">
                <Action icon={Save} label="Save" disabled={busy || !dirty} onClick={() => void save()} />
                <Action icon={Download} label="Export as .kizatheme" disabled={busy} onClick={() => void exportTheme()} />
                <Action icon={Upload} label="Open a .kizatheme" disabled={busy} onClick={() => void importTheme()} />
              </div>
              {/* A tool, not an action: it stays on, so it says what it does
                  in words and shows when it is on. */}
              <button
                type="button"
                aria-pressed={selecting}
                onClick={() => setSelecting(!selecting)}
                title="Pick something in the launcher to edit it"
                className={cn(
                  "ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]",
                  selecting
                    ? "bg-primary text-primary-foreground shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.7)]"
                    : "bg-secondary/45 text-foreground/90 hover:bg-secondary/70",
                )}
              >
                <MousePointerSquareDashed className="h-4 w-4" />
                {selecting ? "Picking" : "Pick"}
              </button>
            </div>
          </header>

          {selecting && !selected && (
            <div className="mx-4 mb-3 flex gap-2.5 rounded-xl bg-primary/[0.09] p-3 text-[12px] leading-relaxed text-foreground/85 shadow-[inset_0_0_0_0.5px_hsl(var(--primary)/0.3)] animate-in fade-in-0 slide-in-from-top-1 duration-200">
              <MousePointerSquareDashed className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                Click a card, a panel, a button or a title in the launcher.
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  Esc puts it down; Esc again puts the tool away.
                </span>
              </span>
            </div>
          )}

          {selected ? (
            <SelectionProperties selection={selected} component={component} draft={draft} edit={edit} />
          ) : (
            <>
              <div className="px-4 pb-3">
                <div className="relative flex rounded-[10px] bg-secondary/45 p-0.5">
                  <SlidingPill value={tab} />
                  {TABS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      data-active={tab === entry.id}
                      onClick={() => setTab(entry.id)}
                      className={cn(
                        "relative z-[1] h-7 flex-1 rounded-[8px] text-[12.5px] font-medium transition-colors duration-200",
                        tab === entry.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>

              <div key={tab} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-5 animate-in fade-in-0 duration-200">
                {tab === "theme" && (
                  <>
                    <Panel title="Theme">
                      <TextRow
                        label="Name"
                        value={draft.name}
                        placeholder="Untitled theme"
                        onChange={(value) => edit({ kind: "meta", field: "name", value })}
                      />
                      <TextRow
                        label="Author"
                        value={draft.author ?? ""}
                        placeholder="Your name"
                        onChange={(value) => edit({ kind: "meta", field: "author", value })}
                      />
                    </Panel>

                    <Panel title="Colours" hint="The launcher repaints as you pick.">
                      {HEADLINE.map(({ token, label, hint }) => (
                        <ColourRow
                          key={token}
                          label={label}
                          hint={hint}
                          value={draft.colors[token]}
                          onChange={(value) => edit({ kind: "color", token, value })}
                        />
                      ))}
                    </Panel>

                    <Panel
                      title="More colours"
                      trailing={
                        <button
                          type="button"
                          onClick={() => setShowAll(!showAll)}
                          className="inline-flex items-center gap-0.5 text-[12px] font-medium text-primary transition-opacity hover:opacity-80"
                        >
                          {showAll ? "Hide" : `Show ${REST.length}`}
                          <ChevronRight
                            className={cn("h-3.5 w-3.5 transition-transform duration-200", showAll && "rotate-90")}
                          />
                        </button>
                      }
                    >
                      {showAll ? (
                        REST.map((token) => (
                          <ColourRow
                            key={token}
                            label={MORE_LABELS[token] ?? token.replace(/-/g, " ")}
                            value={draft.colors[token]}
                            onChange={(value) => edit({ kind: "color", token, value })}
                          />
                        ))
                      ) : (
                        <p className="py-3 text-[12px] leading-snug text-muted-foreground">
                          Menus, buttons, warnings and the text on them. Kiza picks them well from the six above.
                        </p>
                      )}
                    </Panel>
                  </>
                )}

                {tab === "assets" &&
                  SLOTS.map(({ slot, label, hint }) => (
                    <AssetCard
                      key={slot}
                      slot={slot}
                      label={label}
                      hint={hint}
                      // What Kiza ships when the theme replaces nothing, so a
                      // designer sees the picture they are about to replace.
                      url={draft.assets?.[slot] ?? bundledAsset(slot)}
                      isVideo={isMotionAsset(draft.assets?.[slot] ?? "")}
                      isDefault={draft.assets?.[slot] === undefined}
                      over={over === slot}
                      onPick={() => void pick(slot)}
                      onRevert={() => revert(slot)}
                    />
                  ))}

                {tab === "effects" && (
                  <>
                    {/* The layer behind everything takes no clicks, so it is
                        edited here rather than picked in the launcher. */}
                    <Panel
                      title="Background"
                      hint={
                        draft.assets?.background
                          ? "This theme brings its own picture (Pictures tab)."
                          : "Slow waves in the theme's colours, behind every page."
                      }
                    >
                      {draft.assets?.background ? (
                        <SliderRow
                          label="Picture dimming"
                          hint="How dark the veil over the picture is."
                          value={Math.round(Number(backdrop.veil ?? "0.62") * 100)}
                          min={0}
                          max={95}
                          unit="%"
                          onChange={(percent) => setBackdrop("veil", (percent / 100).toFixed(2))}
                          onReset={backdrop.veil ? () => setBackdrop("veil", undefined) : undefined}
                        />
                      ) : (
                        <>
                          <SwitchRow
                            label="Moving waves"
                            hint={backdrop.waves === "off" ? "Off: a still window with two soft glows." : undefined}
                            checked={backdrop.waves !== "off"}
                            onChange={(on) => setBackdrop("waves", on ? undefined : "off")}
                          />
                          {backdrop.waves !== "off" ? (
                            <>
                              <ColourRow
                                label="Light"
                                hint={backdrop.glow ? undefined : "Follows the primary colour."}
                                value={glow}
                                onChange={(value) => setBackdrop("glow", value)}
                                onReset={backdrop.glow ? () => setBackdrop("glow", undefined) : undefined}
                              />
                              <ColourRow
                                label="Depth"
                                hint={backdrop.depth ? undefined : "A deep shade of the light."}
                                value={backdrop.depth ?? deepShadeOf(glow)}
                                onChange={(value) => setBackdrop("depth", value)}
                                onReset={backdrop.depth ? () => setBackdrop("depth", undefined) : undefined}
                              />
                              <SliderRow
                                label="Veil"
                                hint="How much the dark covers the waves."
                                value={Math.round(Number(backdrop.shade ?? "0.86") * 100)}
                                min={40}
                                max={98}
                                unit="%"
                                onChange={(percent) => setBackdrop("shade", (percent / 100).toFixed(2))}
                                onReset={backdrop.shade ? () => setBackdrop("shade", undefined) : undefined}
                              />
                              <SliderRow
                                label="Movement"
                                hint="0 holds them still."
                                value={Math.round(Number(backdrop.movement ?? "1") * 100)}
                                min={0}
                                max={100}
                                unit="%"
                                onChange={(percent) => setBackdrop("movement", (percent / 100).toFixed(2))}
                                onReset={backdrop.movement ? () => setBackdrop("movement", undefined) : undefined}
                              />
                            </>
                          ) : (
                            ([0, 1] as const).map((index) => (
                              <AmbientRows key={index} index={index} draft={draft} edit={edit} />
                            ))
                          )}
                        </>
                      )}
                    </Panel>

                    <Panel title="Material">
                      <SwitchRow
                        label="See-through panels"
                        hint="What this theme asks for, unless the person using it says otherwise."
                        checked={effects.translucency}
                        overridden={overridden.translucency}
                        onChange={(value) => edit({ kind: "effect", field: "translucency", value })}
                      />
                      <SwitchRow
                        label="Blur behind panels"
                        hint="Costs a little on a modest machine."
                        checked={effects.backgroundBlur}
                        overridden={overridden.backgroundBlur}
                        onChange={(value) => edit({ kind: "effect", field: "backgroundBlur", value })}
                      />
                    </Panel>

                    <Panel title="Shape">
                      <SliderRow
                        label="Corner rounding"
                        hint="Every corner the launcher rounds."
                        value={draft.radius ?? 12}
                        min={0}
                        max={28}
                        unit="px"
                        onChange={(value) => edit({ kind: "radius", value })}
                        onReset={draft.radius !== undefined ? () => edit({ kind: "radius", value: undefined }) : undefined}
                      />
                    </Panel>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </aside>

      {replacing && (
        <KeepChangesDialog
          body="Opening another theme replaces the one you are editing. These changes are not saved to a file yet."
          discardLabel="Replace"
          onSave={async () => {
            if (await save()) {
              setReplacing(false);
              await importTheme(true);
            }
          }}
          onDiscard={async () => {
            setReplacing(false);
            await importTheme(true);
          }}
          onCancel={() => setReplacing(false)}
        />
      )}

      {leaving && (
        <KeepChangesDialog
          body="This theme has changes that are not saved to a file. Closing the editor without saving them loses them."
          discardLabel="Discard"
          onSave={async () => {
            if (await save()) {
              setLeaving(false);
              await closeMaker();
            }
          }}
          onDiscard={async () => {
            setLeaving(false);
            await closeMaker({ discard: true });
          }}
          onCancel={() => setLeaving(false)}
        />
      )}
    </>
  );
}

/** The bands' deep shade when a theme names none: as the waves derive it. */
function deepShadeOf(triple: string): string {
  const [hue, saturation] = triple.trim().split(/\s+/).map((part) => Number.parseFloat(part));
  if (!Number.isFinite(hue) || !Number.isFinite(saturation)) return "260 82% 27%";
  return `${Math.round(hue)} ${Math.round(saturation * 0.91)}% 27%`;
}

/** One of the two soft glows of a still window. */
function AmbientRows({
  index,
  draft,
  edit,
}: {
  index: 0 | 1;
  draft: ThemeDefinition;
  edit: (edit: ThemeEdit) => void;
}) {
  return (
    <>
      <ColourRow
        label={index === 0 ? "Glow, top left" : "Glow, top right"}
        value={draft.ambient[index].color}
        onChange={(color) => edit({ kind: "ambient", index, stop: { color } })}
      />
      <SliderRow
        label="Strength"
        value={Math.round(draft.ambient[index].alpha * 100)}
        min={0}
        max={40}
        unit="%"
        onChange={(value) => edit({ kind: "ambient", index, stop: { alpha: value / 100 } })}
      />
    </>
  );
}

function Action({
  icon: Icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: typeof Save;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/80 transition-[background-color,color,scale,opacity] duration-150 enabled:hover:bg-white/[0.08] enabled:hover:text-foreground enabled:active:scale-90 disabled:opacity-30"
    >
      <Icon className="h-[15px] w-[15px]" />
    </button>
  );
}

/**
 * What the selected thing lets a designer change.
 *
 * The panel's body while something is picked up. Placement first — it is
 * about this one element — then the style, which is about every element of
 * its kind and says so in its title, so nobody rounds every card in the
 * launcher while trying to move one.
 */
function SelectionProperties({
  selection,
  component,
  draft,
  edit,
}: {
  selection: Selection;
  component: EditableComponent | null;
  draft: ThemeDefinition;
  edit: (edit: ThemeEdit) => void;
}) {
  const kind = selection.kind;
  const values = kind ? (draft.components?.[kind] ?? {}) : {};
  const clear = useInspector((state) => state.clear);

  const set = (property: EditableProperty, value: string | undefined) =>
    kind && edit({ kind: "component", component: kind, property: property.key, value });

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-5 animate-in fade-in-0 slide-in-from-right-2 duration-200">
      <div>
        <button
          type="button"
          onClick={clear}
          className="-ml-1 mb-2 inline-flex items-center gap-0.5 rounded-full px-1 text-[12.5px] font-medium text-primary transition-opacity hover:opacity-80"
        >
          <ChevronLeft className="h-4 w-4" />
          Theme
        </button>
        <h3 className="text-[16px] font-semibold tracking-[-0.01em]">
          {component?.name ?? partLabel(selection.part)}
        </h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          {component?.scope ?? "This one element. Move it, resize it, turn it, or take it off the page."}
        </p>
      </div>

      {selection.part ? (
        <Placement part={selection.part} draft={draft} edit={edit} />
      ) : (
        <p className="flex gap-2 rounded-xl bg-secondary/[0.32] p-3 text-[12px] leading-relaxed text-muted-foreground shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
          <Move className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This one takes its place from the list it is in, so it does not move on its own. Pick the area
            around it to move the whole group.
          </span>
        </p>
      )}

      {component && component.properties.length > 0 && (
        <Panel title={selection.part ? `Every ${component.name.toLowerCase()}` : "Style"}>
          {component.properties.map((property) => {
            const stored = values[property.key];
            // While unset, the control shows what the launcher is painting:
            // the theme colour it follows, not the text `var(--border)`.
            const value =
              stored ?? (property.follows ? draft.colors[property.follows as ColorToken] : property.fallback);
            const reset = stored !== undefined ? () => set(property, undefined) : undefined;

            if (property.kind === "colour") {
              return (
                <ColourRow
                  key={property.key}
                  label={property.label}
                  hint={property.hint}
                  value={value}
                  onChange={(next) => set(property, next)}
                  onReset={reset}
                />
              );
            }
            if (property.kind === "length") {
              return (
                <SliderRow
                  key={property.key}
                  label={property.label}
                  hint={property.hint}
                  value={Number.parseFloat(value) || 0}
                  min={property.min ?? 0}
                  max={property.max ?? 40}
                  unit="px"
                  onChange={(next) => set(property, `${next}px`)}
                  onReset={reset}
                />
              );
            }
            return (
              <SliderRow
                key={property.key}
                label={property.label}
                hint={property.hint}
                value={Math.round((Number.parseFloat(value) || 0) * 100)}
                min={0}
                max={100}
                unit="%"
                onChange={(next) => set(property, `${next / 100}`)}
                onReset={reset}
              />
            );
          })}
        </Panel>
      )}
    </div>
  );
}

/**
 * About to lose work that is not written down anywhere.
 *
 * The same three answers whatever is about to happen — closing the editor, or
 * opening another theme over this one. Two dialogues that ask the same
 * question differently is how one of them ends up missing the Save button.
 */
function KeepChangesDialog({
  body,
  discardLabel,
  onSave,
  onDiscard,
  onCancel,
}: {
  body: string;
  discardLabel: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm animate-in fade-in-0 duration-200">
      <div className="w-full max-w-sm rounded-2xl bg-popover p-6 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.08),0_30px_80px_hsl(242_30%_2%/0.7)] animate-in fade-in-0 zoom-in-[0.96] duration-sheet ease-drawer">
        <h3 className="text-[15px] font-semibold">Keep your changes?</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-[10px] bg-secondary/70 px-4 text-[13px] font-medium transition-[background-color,scale] duration-150 hover:bg-secondary active:scale-[0.97]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="h-9 rounded-[10px] px-4 text-[13px] font-medium text-red-300 transition-[background-color,scale] duration-150 hover:bg-destructive/[0.15] active:scale-[0.97]"
          >
            {discardLabel}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="kiza-action h-9 rounded-[10px] px-4 text-[13px] font-semibold text-primary-foreground transition-[filter,scale] duration-150 hover:brightness-110 active:scale-[0.97]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/** What a staged file turned out to be. A still runs for no seconds. */
interface Measured {
  width: number;
  height: number;
  seconds: number;
}

/** How big a picture is, or nothing if the window cannot draw it. */
function measurePicture(url: string): Promise<Measured | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight, seconds: 0 });
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * How big a video is and how long it runs, or nothing if it will not play.
 *
 * Metadata only: the size and the duration arrive long before the first frame
 * does, and a designer who has just dropped a file should not wait for a
 * twenty-second video to buffer to be told it is too large.
 */
function measureVideo(url: string): Promise<Measured | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        seconds: Number.isFinite(video.duration) ? video.duration : 0,
      });
    video.onerror = () => resolve(null);
    video.src = url;
  });
}


/** What "Put it back" takes back: everything about where it sits. */
const PLACED_KEYS = ["x", "y", "scale", "rotate", "layer"];

/** The lowest and highest layer, as `values.ts` and `kizatheme.rs` allow. */
const LAYER_LIMIT = 9;

/**
 * In front or behind, the four ways a drawing program offers: all the way to
 * the front, one step forward, one step back, all the way to the back.
 * Ctrl+] and Ctrl+[ do the same from the keyboard (with Shift, all the way).
 */
function LayerRow({ layer, onChange }: { layer: number | null; onChange: (layer: number | null) => void }) {
  const current = layer ?? 0;
  const step = (by: number) => onChange(Math.max(-LAYER_LIMIT, Math.min(LAYER_LIMIT, current + by)));
  const label =
    layer === null
      ? "As the page draws it"
      : current === LAYER_LIMIT
        ? "In front of everything"
        : current === -LAYER_LIMIT
          ? "Behind everything"
          : current > 0
            ? `${current} step${current === 1 ? "" : "s"} forward`
            : current < 0
              ? `${-current} step${current === -1 ? "" : "s"} back`
              : "Level with the page";
  const tools: { icon: typeof ArrowUp; title: string; disabled: boolean; run: () => void }[] = [
    { icon: BringToFront, title: "Bring to front (Ctrl+Shift+])", disabled: current === LAYER_LIMIT, run: () => onChange(LAYER_LIMIT) },
    { icon: ArrowUp, title: "Bring forward (Ctrl+])", disabled: current === LAYER_LIMIT, run: () => step(1) },
    { icon: ArrowDown, title: "Send backward (Ctrl+[)", disabled: current === -LAYER_LIMIT, run: () => step(-1) },
    { icon: SendToBack, title: "Send to back (Ctrl+Shift+[)", disabled: current === -LAYER_LIMIT, run: () => onChange(-LAYER_LIMIT) },
  ];
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-[13px] leading-snug">Layer</div>
        <div className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground">{label}</div>
      </div>
      <div className="flex shrink-0 items-center rounded-full bg-secondary/45 p-0.5">
        {tools.map(({ icon: Icon, title, disabled, run }) => (
          <button
            key={title}
            type="button"
            title={title}
            aria-label={title}
            disabled={disabled}
            onClick={run}
            className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/80 transition-[background-color,color,scale,opacity] duration-150 enabled:hover:bg-white/[0.08] enabled:hover:text-foreground enabled:active:scale-90 disabled:opacity-30"
          >
            <Icon className="h-[15px] w-[15px]" />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Where one element sits, how big it is, which way it faces, and whether it is
 * there at all.
 *
 * The same four numbers the handles write, with a slider each — a drag is how
 * you find a position and a number is how you repeat one. Hiding is here
 * rather than among a kind's properties: "hide this line of small print" is a
 * sentence about this element. The buttons people need to make and bring in
 * instances and servers can be moved, never hidden.
 */
function Placement({
  part,
  draft,
  edit,
}: {
  part: string;
  draft: ThemeDefinition;
  edit: (edit: ThemeEdit) => void;
}) {
  const values = draft.layout?.[part] ?? {};
  const set = (property: string, value: string | undefined) =>
    edit({ kind: "layout", part, property, value });

  const number = (key: string, fallback: number) => {
    const parsed = Number.parseFloat(values[key] ?? "");
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const placed = PLACED_KEYS.some((key) => values[key] !== undefined);
  const locked = LOCKED_PARTS.includes(part);
  const layer = Math.round(number("layer", 0));

  return (
    <Panel
      title="This one"
      trailing={
        placed && (
          <button
            type="button"
            onClick={() => {
              for (const key of PLACED_KEYS) set(key, undefined);
            }}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-primary transition-opacity hover:opacity-80"
          >
            <RotateCcw className="h-3 w-3" />
            Put it back
          </button>
        )
      }
    >
      <SliderRow label="Across" value={Math.round(number("x", 0))} min={-400} max={400} unit="px" onChange={(next) => set("x", `${next}px`)} />
      <SliderRow label="Down" value={Math.round(number("y", 0))} min={-400} max={400} unit="px" onChange={(next) => set("y", `${next}px`)} />
      <SliderRow
        label="Size"
        value={Math.round(number("scale", 1) * 100)}
        min={20}
        max={400}
        unit="%"
        onChange={(next) => set("scale", (next / 100).toFixed(3))}
      />
      <SliderRow label="Rotation" value={Math.round(number("rotate", 0))} min={-180} max={180} unit="°" onChange={(next) => set("rotate", `${next}deg`)} />
      <LayerRow layer={values.layer === undefined ? null : layer} onChange={(next) => set("layer", next === null ? undefined : String(next))} />
      {locked ? (
        <p className="py-3 text-[12px] leading-snug text-muted-foreground">
          People need this one to get anything done, so it can be moved and restyled but not hidden.
        </p>
      ) : (
        <SwitchRow
          label="Hidden"
          hint="Takes it off the page, and the space it held."
          checked={values.hidden === "true"}
          onChange={(on) => set("hidden", on ? "true" : undefined)}
        />
      )}
    </Panel>
  );
}
