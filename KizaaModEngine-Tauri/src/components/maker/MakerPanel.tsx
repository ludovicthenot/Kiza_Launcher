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

import { useEffect, useMemo, useState } from "react";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  Download,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { COLOR_TOKENS, type AssetSlot, type ColorToken } from "../../lib/theme/definition";
import { hasUnsavedChanges, useThemeStore } from "../../lib/theme/store";
import {
  closeMaker,
  loadInstalled,
  PANEL_WIDTH,
  toManifest,
  type InstalledTheme,
} from "../../lib/maker/session";
import { ASSET_LIMITS } from "../../lib/theme/assets";
import { cn } from "../../lib/utils";
import { AssetField, ColourField, SliderField, TextField } from "./controls";

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
  const undo = useThemeStore((state) => state.undo);
  const redo = useThemeStore((state) => state.redo);

  const [tab, setTab] = useState<Tab>("theme");
  const [paths, setPaths] = useState<AssetPaths>({});
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const dirty = hasUnsavedChanges(session);
  const draft = session?.draft;

  // A file dropped anywhere on the panel is offered to whichever slot the
  // pointer is over; Tauri reports the path, the DOM only reports that
  // something is being dragged.
  const [dropped, setDropped] = useState<string[] | null>(null);
  useEffect(() => {
    // Dropping a file is a convenience, and the file picker does the same job.
    // Losing it must not be able to take the launcher down with it, so a
    // listener that cannot be attached is simply a Maker without drag and drop.
    let stop: (() => void) | null = null;
    let cancelled = false;
    // Detaching can throw as easily as attaching — in development React mounts
    // an effect twice, so the first listener is always released while its own
    // promise is still in flight.
    const release = (unlisten: () => void) => {
      // Detaching is asynchronous, so a synchronous try/catch around it catches
      // nothing: the failure arrives later as a rejected promise, and an
      // unhandled one takes the whole window down.
      try {
        void Promise.resolve(unlisten()).catch(() => {});
      } catch {
        // Already gone.
      }
    };
    listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      setDropped(event.payload.paths);
    })
      .then((unlisten) => {
        if (cancelled) release(unlisten);
        else stop = unlisten;
      })
      .catch(() => {
        // No drag and drop here. The picker still works.
      });
    return () => {
      cancelled = true;
      if (stop) release(stop);
    };
  }, []);

  const usable = useMemo(
    () => new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]),
    [],
  );

  if (!session || !draft) return null;

  /**
   * Accepts a picture for a slot.
   *
   * Checked here for the things a browser can answer cheaply — the extension,
   * and the dimensions once it has decoded it, which it was going to do anyway.
   * Everything else is the backend's job when the theme is written out, and it
   * is the backend that has the final say.
   */
  const usePicture = async (slot: AssetSlot, path: string) => {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    if (!usable.has(extension)) {
      toast.error(`${extension || "That file"} is not a picture a theme can use.`);
      return;
    }
    const url = convertFileSrc(path);
    const measured = await new Promise<{ width: number; height: number } | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = url;
    });
    if (!measured) {
      toast.error("That picture could not be read.");
      return;
    }
    const longest = Math.max(measured.width, measured.height);
    const animated = extension === "gif" || extension === "webp";
    const ceiling = animated ? ASSET_LIMITS.maxAnimatedDimension : ASSET_LIMITS.maxDimension;
    if (longest > ceiling) {
      toast.error(
        `That picture is ${longest}px on its longest edge; ${animated ? "an animated one" : "a picture"} may be ${ceiling}px.`,
      );
      return;
    }

    setPaths((current) => ({ ...current, [slot]: path }));
    edit({ kind: "asset", slot, url });
  };

  const pick = async (slot: AssetSlot) => {
    const chosen = await openFileDialog({
      multiple: false,
      filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] }],
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

  const importTheme = async () => {
    const chosen = await openFileDialog({
      multiple: false,
      filters: [{ name: "Kiza theme", extensions: ["kizatheme"] }],
    });
    if (typeof chosen !== "string") return;
    setBusy(true);
    try {
      const installed = await invoke<InstalledTheme>("import_theme", { archivePath: chosen });
      await loadInstalled(convertFileSrc);
      const next: AssetPaths = {};
      for (const [slot, path] of Object.entries(installed.assets)) {
        next[slot as AssetSlot] = path;
        edit({ kind: "asset", slot: slot as AssetSlot, url: convertFileSrc(path) });
      }
      setPaths(next);
      for (const [token, value] of Object.entries(installed.manifest.colors)) {
        edit({ kind: "color", token: token as ColorToken, value });
      }
      edit({ kind: "meta", field: "name", value: installed.manifest.name });
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
          </div>
        </header>

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
                label={label}
                url={draft.assets?.[slot]}
                isDefault={draft.assets?.[slot] === undefined}
                onPick={() => void pick(slot)}
                onDrop={() => {
                  const path = dropped?.[0];
                  if (path) void usePicture(slot, path);
                }}
                onRevert={() => revert(slot)}
              />
            ))}

          {tab === "effects" && (
            <>
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
      </aside>

      {leaving && (
        <LeavingDialog
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
  disabled,
  onClick,
}: {
  icon: typeof Save;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg p-1.5 text-muted-foreground transition enabled:hover:bg-secondary/60 enabled:hover:text-foreground disabled:opacity-30"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** Leaving with work that is not written down anywhere. */
function LeavingDialog({
  onSave,
  onDiscard,
  onCancel,
}: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-card p-5 shadow-2xl">
        <h3 className="text-base font-semibold">Keep your changes?</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          This theme has changes that are not saved to a file. Closing the Maker without saving
          them loses them.
        </p>
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
            Discard
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
