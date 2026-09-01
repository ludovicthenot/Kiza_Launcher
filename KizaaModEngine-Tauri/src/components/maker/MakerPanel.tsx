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
  Download,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  MousePointerSquareDashed,
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
import { AssetField, ColourField, SliderField, TextField, ToggleField } from "./controls";
import { CATALOGUE, type EditableComponent, type EditableProperty } from "../../lib/maker/catalogue";
import { useInspector } from "../../lib/maker/inspector";
import type { ComponentKind } from "../../lib/maker/editable";

/** The colours worth putting first, in the order a designer reaches for them. */
const HEADLINE: { token: ColorToken; label: string }[] = [
  { token: "primary", label: "Primary" },
  { token: "background", label: "Background" },
  { token: "card", label: "Cards" },
  { token: "foreground", label: "Text" },
  { token: "muted-foreground", label: "Secondary text" },
  { token: "border", label: "Borders" },
];

const REST = COLOR_TOKENS.filter(
  (token) => !HEADLINE.some((entry) => entry.token === token),
);

const SLOTS: { slot: AssetSlot; label: string }[] = [
  { slot: "logo", label: "Logo" },
  { slot: "logoCompact", label: "Compact logo" },
  { slot: "background", label: "Background picture" },
];

type Tab = "theme" | "assets" | "effects";

/**
 * Where each slot's picture lives on disk.
 *
 * The theme holds URLs the window can draw; exporting needs the files behind
 * them. Kept beside the draft rather than in it, because a URL that came out of
 * a `.kizatheme` has a path and one bundled with Kiza does not.
 */
type AssetPaths = Partial<Record<AssetSlot, string>>;

export function MakerPanel() {
  const session = useThemeStore((state) => state.session);
  const edit = useThemeStore((state) => state.edit);
  const reset = useThemeStore((state) => state.reset);
  const markSaved = useThemeStore((state) => state.markSaved);
  const adopt = useThemeStore((state) => state.adopt);
  const undo = useThemeStore((state) => state.undo);
  const redo = useThemeStore((state) => state.redo);

  const [tab, setTab] = useState<Tab>("theme");
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
  const component = selected ? CATALOGUE[selected.kind] : null;

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

  return (
    <>
      <aside
        style={{ width: PANEL_WIDTH }}
        data-anim="maker-panel"
        className="flex shrink-0 flex-col border-l border-border/60 bg-card/40 backdrop-blur-sm"
      >
        <header className="border-b border-border/60 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-semibold">Kiza Maker</h2>
                {dirty && (
                  <span
                    className="inline-flex items-center gap-1.5 text-[11px] text-amber-300"
                    title="Unsaved changes"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    Unsaved
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">{draft.name}</p>
            </div>
            <button
              type="button"
              onClick={() => void leave()}
              title="Exit Maker"
              className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary/50 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-1">
            <Action
              icon={Undo2}
              label="Undo"
              disabled={session.past.length === 0}
              onClick={undo}
            />
            <Action
              icon={Redo2}
              label="Redo"
              disabled={session.future.length === 0}
              onClick={redo}
            />
            <Action icon={RotateCcw} label="Reset" disabled={!dirty} onClick={reset} />
            <span className="mx-1 h-4 w-px bg-border/70" />
            <Action icon={Save} label="Save" disabled={busy || !dirty} onClick={() => void save()} />
            <Action
              icon={Download}
              label="Export"
              disabled={busy}
              onClick={() => void exportTheme()}
            />
            <Action icon={Upload} label="Import" disabled={busy} onClick={() => void importTheme()} />
            <span className="mx-1 h-4 w-px bg-border/70" />
            <Action
              icon={MousePointerSquareDashed}
              label={selecting ? "Stop selecting" : "Select a component"}
              active={selecting}
              onClick={() => setSelecting(!selecting)}
            />
          </div>
        </header>

        {selecting && !selected && (
          <p className="border-b border-border/60 bg-primary/5 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Point at the launcher and click a card, a panel or a main button.
            <span className="mt-0.5 block text-[11px] text-muted-foreground/70">
              Escape puts the selection down, and again puts the tool down.
            </span>
          </p>
        )}

        {selected && component ? (
          <ComponentProperties kind={selected.kind} component={component} draft={draft} edit={edit} />
        ) : (
        <>
        <nav className="flex gap-1 border-b border-border/60 px-3 py-2">
          {(["theme", "assets", "effects"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setTab(entry)}
              className={cn(
                "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition",
                tab === entry
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )}
            >
              {entry}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === "theme" && (
            <>
              <TextField
                label="Theme name"
                value={draft.name}
                onChange={(value) => edit({ kind: "meta", field: "name", value })}
              />
              <TextField
                label="Author"
                value={draft.author ?? ""}
                placeholder="Your name"
                onChange={(value) => edit({ kind: "meta", field: "author", value })}
              />

              <Section title="Colours" />
              {HEADLINE.map(({ token, label }) => (
                <ColourField
                  key={token}
                  label={label}
                  value={draft.colors[token]}
                  onChange={(value) => edit({ kind: "color", token, value })}
                />
              ))}

              <details className="mt-3 border-t border-border/60 pt-2">
                <summary className="cursor-pointer list-none text-xs text-muted-foreground transition hover:text-foreground">
                  Everything else ({REST.length})
                </summary>
                <div className="mt-1">
                  {REST.map((token) => (
                    <ColourField
                      key={token}
                      label={token.replace(/-/g, " ")}
                      value={draft.colors[token]}
                      onChange={(value) => edit({ kind: "color", token, value })}
                    />
                  ))}
                </div>
              </details>
            </>
          )}

          {tab === "assets" &&
            SLOTS.map(({ slot, label }) => (
              <AssetField
                key={slot}
                slot={slot}
                label={label}
                // Falls back to what Kiza ships, so a designer sees the
                // picture they are about to replace rather than an empty box
                // over a launcher that visibly has a logo in it.
                url={draft.assets?.[slot] ?? bundledAsset(slot)}
                isVideo={isMotionAsset(draft.assets?.[slot] ?? "")}
                isDefault={draft.assets?.[slot] === undefined}
                over={over === slot}
                onPick={() => void pick(slot)}
                onRevert={() => revert(slot)}
              />
            ))}

          {/* Only once there is a background to dim.

              It belongs here rather than in the Inspector's list of
              components: the layer it dims is behind everything and takes no
              clicks, so there is nothing to point at. The control that changes
              a picture and the control that decides how much of it shows are
              the same decision anyway. */}
          {tab === "assets" && draft.assets?.background && (
            <SliderField
              label="Background dimming"
              value={Math.round(Number(draft.components?.backdrop?.veil ?? "0.62") * 100)}
              min={0}
              max={100}
              unit="%"
              onChange={(percent) =>
                edit({
                  kind: "component",
                  component: "backdrop",
                  property: "veil",
                  value: (percent / 100).toFixed(2),
                })
              }
            />
          )}

          {tab === "effects" && (
            <>
              <Section title="Material" />
              <ToggleField
                label="Panels are see-through"
                hint="What this theme asks for, unless the person using it says otherwise."
                checked={effects.translucency}
                overridden={overridden.translucency}
                onChange={(value) => edit({ kind: "effect", field: "translucency", value })}
              />
              <ToggleField
                label="Blur behind panels"
                hint="Costs a little on a modest machine; some themes are better without it."
                checked={effects.backgroundBlur}
                overridden={overridden.backgroundBlur}
                onChange={(value) => edit({ kind: "effect", field: "backgroundBlur", value })}
              />

              <Section title="Shape" />
              <SliderField
                label="Corner rounding"
                value={draft.radius ?? 12}
                min={0}
                max={28}
                unit="px"
                onChange={(value) => edit({ kind: "radius", value })}
              />

              <Section title="The glow behind the window" />
              {[0, 1].map((index) => (
                <div key={index} className="border-t border-border/50 pt-1 first:border-t-0">
                  <ColourField
                    label={index === 0 ? "Top left" : "Top right"}
                    value={draft.ambient[index].color}
                    onChange={(color) =>
                      edit({ kind: "ambient", index: index as 0 | 1, stop: { color } })
                    }
                  />
                  <SliderField
                    label="Strength"
                    value={Math.round(draft.ambient[index].alpha * 100)}
                    min={0}
                    max={40}
                    unit="%"
                    onChange={(value) =>
                      edit({
                        kind: "ambient",
                        index: index as 0 | 1,
                        stop: { alpha: value / 100 },
                      })
                    }
                  />
                </div>
              ))}
            </>
          )}
        </div>
        </>
        )}
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
          body="This theme has changes that are not saved to a file. Closing the Maker without saving them loses them."
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

function Section({ title }: { title: string }) {
  return (
    <div className="mb-1 mt-4 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {title}
    </div>
  );
}

function Action({
  icon: Icon,
  label,
  disabled = false,
  active = false,
  onClick,
}: {
  icon: typeof Save;
  label: string;
  disabled?: boolean;
  /** A tool that stays on, rather than an action that happens once. */
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-lg p-1.5 transition disabled:opacity-30",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground enabled:hover:bg-secondary/60 enabled:hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/**
 * What the selected component lets a designer change.
 *
 * The panel's body while something is selected. Every control comes from the
 * catalogue rather than from this file: a component that exposes a new
 * property gains a control by saying so. That is also what keeps the panel
 * honest, because there is no way to show a control for something the
 * stylesheet does not read.
 *
 * Editing changes the component everywhere it appears, which is what the
 * heading says out loud. Selecting one card and quietly restyling every card
 * would be the sort of surprise a designer only finds after saving.
 */
function ComponentProperties({
  kind,
  component,
  draft,
  edit,
}: {
  kind: ComponentKind;
  component: EditableComponent;
  draft: ThemeDefinition;
  edit: (edit: ThemeEdit) => void;
}) {
  const values = draft.components?.[kind] ?? {};
  const clear = useInspector((state) => state.clear);

  const set = (property: EditableProperty, value: string | undefined) =>
    edit({ kind: "component", component: kind, property: property.key, value });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="border-b border-border/60 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{component.name}</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {component.scope}
            </p>
          </div>
          <button
            type="button"
            onClick={clear}
            title="Put this down"
            aria-label="Put this down"
            className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="px-4 py-2">
        {component.properties.map((property) => {
          const stored = values[property.key];
          // While a property is unset the control shows what the launcher is
          // actually painting: for a colour that follows a theme token, that
          // is the token's own value, not the text `var(--border)`.
          const value =
            stored ??
            (property.follows ? draft.colors[property.follows as ColorToken] : property.fallback);

          return (
            <div key={property.key} className="border-t border-border/50 pt-1 first:border-t-0">
              <div className="flex items-baseline justify-between gap-2 pt-1.5">
                <span className="text-[10px] leading-tight text-muted-foreground/70">
                  {property.hint ?? ""}
                </span>
                {stored !== undefined && (
                  <button
                    type="button"
                    onClick={() => set(property, undefined)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-secondary/50 hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Default
                  </button>
                )}
              </div>

              {property.kind === "colour" && (
                <ColourField
                  label={property.label}
                  value={value}
                  onChange={(next) => set(property, next)}
                />
              )}
              {property.kind === "length" && (
                <SliderField
                  label={property.label}
                  value={Number.parseFloat(value) || 0}
                  min={property.min ?? 0}
                  max={property.max ?? 40}
                  unit="px"
                  onChange={(next) => set(property, `${next}px`)}
                />
              )}
              {property.kind === "alpha" && (
                <SliderField
                  label={property.label}
                  value={Math.round((Number.parseFloat(value) || 0) * 100)}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(next) => set(property, `${next / 100}`)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * About to lose work that is not written down anywhere.
 *
 * The same three answers whatever is about to happen — closing the Maker, or
 * opening another theme over this one. Two dialogues that ask the same question
 * differently is how one of them ends up quietly missing the Save button.
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-card p-5 shadow-2xl">
        <h3 className="text-base font-semibold">Keep your changes?</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-border/70 px-4 py-2 text-sm font-medium transition hover:bg-secondary/50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-xl px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10"
          >
            {discardLabel}
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
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
