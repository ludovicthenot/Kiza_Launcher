/**
 * The controls a designer touches.
 *
 * Nobody using the Maker is expected to know what an HSL triplet is, so every
 * one of these is a thing you point at: a swatch, a slider, a picture. The
 * precise value is there for the person who does want it — typing `258 90% 66%`
 * has to work, because a designer matching a brand has the number and not the
 * patience to nudge a picker onto it.
 */

import { useState } from "react";
import { Image as ImageIcon, RotateCcw, Upload } from "lucide-react";
import { cn } from "../../lib/utils";
import { hexToTriple, isTriple, tripleToHex } from "../../lib/maker/session";

/** A colour, as a swatch and as a value. */
export function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (triple: string) => void;
}) {
  // Typing is tracked separately: "258 90" is not a colour, and rejecting every
  // keystroke on the way to one would make the field impossible to type in.
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? value;
  const valid = isTriple(shown);

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <label className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{label}</label>
      <input
        type="text"
        value={shown}
        spellCheck={false}
        onChange={(event) => {
          setTyped(event.target.value);
          if (isTriple(event.target.value)) onChange(event.target.value.trim());
        }}
        onBlur={() => setTyped(null)}
        className={cn(
          "w-[7.5rem] rounded-md border bg-secondary/25 px-2 py-1 font-mono text-[11px] tabular-nums outline-none transition",
          valid ? "border-border/70 focus:border-primary/50" : "border-red-500/60",
        )}
      />
      <label
        className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border/70"
        style={{ backgroundColor: `hsl(${value})` }}
        title={label}
      >
        <input
          type="color"
          value={tripleToHex(value)}
          onChange={(event) => {
            const triple = hexToTriple(event.target.value);
            if (triple) {
              setTyped(null);
              onChange(triple);
            }
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

/** A number with a slider, and the number itself. */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-foreground">
          {value}
          {unit}
        </span>
      </div>
      {/* `bg-muted` rather than a translucent secondary, as the launcher's own
          sliders use. Turning panel translucency off repaints every
          `bg-secondary/…` surface solid card colour — right for a panel, wrong
          for a track whose only job is to be a visible fill. With the
          translucent class the rail vanished and the switch below read as off
          whether it was or not. */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
      />
    </div>
  );
}

/**
 * A switch for something the theme recommends.
 *
 * Says who is being obeyed rather than only what is set. A designer turning
 * blur off in a theme somebody has already overridden in Settings would
 * otherwise flick a switch and watch nothing happen.
 */
export function ToggleField({
  label,
  hint,
  checked,
  overridden,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  overridden?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        {overridden ? (
          <span className="mt-0.5 block text-[10px] leading-tight text-amber-400/80">
            Your own setting overrides this, so the window will not change.
          </span>
        ) : hint ? (
          <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground/70">
            {hint}
          </span>
        ) : null}
      </span>
      <span className="relative shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        {/* Solid, for the reason spelled out on the slider's rail above. */}
        <span className="block h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-foreground/90 transition peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

/** A short piece of text: a name, an author. */
export function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="py-1.5">
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border/70 bg-secondary/25 px-2.5 py-1.5 text-sm outline-none transition focus:border-primary/50"
      />
    </div>
  );
}

/**
 * A picture, with what it looks like now.
 *
 * Dropping a file works because dragging one onto the thing it replaces is what
 * anybody would try first. The picture shown is the one the launcher is drawing
 * — the same URL, through the same resolver — so what is in this square is what
 * is on screen.
 */
export function AssetField({
  slot,
  label,
  url,
  isVideo,
  isDefault,
  over,
  onPick,
  onRevert,
}: {
  slot: string;
  label: string;
  url: string | undefined;
  isVideo: boolean;
  isDefault: boolean;
  over: boolean;
  onPick: () => void;
  onRevert: () => void;
}) {
  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {!isDefault && (
          <button
            type="button"
            onClick={onRevert}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-secondary/50 hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Default
          </button>
        )}
      </div>
      {/*
        The drop zone is marked, not wired.

        Tauri intercepts a dragged file before the page ever sees it — the
        webview's own drag and drop is switched off in favour of the runtime's,
        which is what turns a drop into a *path* rather than a copy of the
        bytes. A video background would otherwise have to be carried through
        the bridge to reach the disk it is already on.

        So there are no drag handlers here. The panel listens once for the
        runtime's events and asks the document what is under the pointer; this
        attribute is the answer.
      */}
      <div
        data-kiza-drop={slot}
        className={cn(
          "flex min-h-[86px] items-center justify-center overflow-hidden rounded-xl border border-dashed p-2 transition",
          over
            ? "border-primary bg-primary/10"
            : "border-border/70 bg-secondary/20 hover:border-primary/40",
        )}
      >
        {url ? (
          isVideo ? (
            <video
              src={url}
              className="max-h-20 max-w-full object-contain"
              muted
              loop
              playsInline
              autoPlay
            />
          ) : (
            <img src={url} alt={label} className="max-h-20 max-w-full object-contain" />
          )
        ) : (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <ImageIcon className="h-4 w-4" />
            Kiza has no picture for this
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onPick}
        className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/70 bg-secondary/25 py-1.5 text-xs font-medium transition hover:border-primary/40"
      >
        <Upload className="h-3.5 w-3.5" />
        Choose a picture
      </button>
    </div>
  );
}
