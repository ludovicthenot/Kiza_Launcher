/**
 * The controls a designer touches.
 *
 * Nobody using the Maker is expected to know what an HSL triplet is, so every
 * one of these is a thing you point at: a swatch, a slider, a switch, a
 * picture. They are the rows of the launcher's own grouped lists — a label on
 * the left, its control on the right, hairlines between — so the editor reads
 * like the settings it sits beside rather than like a developer's panel.
 */

import type { ReactNode } from "react";
import { Image as ImageIcon, RotateCcw, Upload } from "lucide-react";
import { cn } from "../../lib/utils";
import { hexToTriple, tripleToHex } from "../../lib/maker/session";
import { ColourPicker } from "../ui/colour-picker";
import { Toggle } from "../settings/controls";

/** A titled group of rows: the grouped list of the launcher's settings. */
export function Panel({
  title,
  trailing,
  hint,
  children,
}: {
  title?: string;
  trailing?: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section>
      {(title || trailing) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
          {title && <h3 className="text-[0.7812rem] font-semibold text-foreground/90">{title}</h3>}
          {trailing}
        </div>
      )}
      {hint && <p className="-mt-0.5 mb-2 px-1 text-[0.7188rem] leading-snug text-muted-foreground">{hint}</p>}
      <div className="divide-y divide-border/40 rounded-xl bg-secondary/[0.32] px-3.5 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
        {children}
      </div>
    </section>
  );
}

/**
 * Back to what the launcher does by default.
 *
 * Small and quiet, beside the control it resets, and only there when there is
 * something to undo — a row full of reset buttons would read as a row full of
 * changes.
 */
export function ResetButton({ onClick, label = "Back to the default" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-white/[0.07] hover:text-foreground active:scale-90"
    >
      <RotateCcw className="h-3.5 w-3.5" />
    </button>
  );
}

/** A label, an optional line under it, and whatever it controls. */
function Line({
  label,
  hint,
  warning,
  children,
}: {
  label: string;
  hint?: string;
  warning?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.8125rem] leading-snug">{label}</div>
        {warning ? (
          <div className="mt-0.5 text-[0.6875rem] leading-snug text-amber-300/90">{warning}</div>
        ) : hint ? (
          <div className="mt-0.5 text-[0.6875rem] leading-snug text-muted-foreground">{hint}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

/** A colour, as a round swatch with its hex beside it. */
export function ColourRow({
  label,
  hint,
  value,
  onChange,
  onReset,
}: {
  label: string;
  hint?: string;
  /** An HSL triple, as a theme stores colours. */
  value: string;
  onChange: (triple: string) => void;
  /** Shown when the colour has been changed from the launcher's own. */
  onReset?: () => void;
}) {
  return (
    <Line label={label} hint={hint}>
      {onReset && <ResetButton onClick={onReset} />}
      {/* The launcher's own picker, not the operating system's: the Windows
          dialogue is a white modal box that hides the live repaint, which is
          the whole reason to pick a colour here. Portalled, because the panel
          scrolls and would clip it. */}
      <ColourPicker
        portal
        variant="swatch"
        label={label}
        value={tripleToHex(value)}
        onChange={(hex) => {
          const triple = hexToTriple(hex);
          if (triple) onChange(triple);
        }}
      />
    </Line>
  );
}

/** A number on a slider, with the number above it. */
export function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
  onReset,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  onReset?: () => void;
}) {
  const fill = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div className="py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[0.8125rem] leading-snug">{label}</div>
          {hint && <div className="mt-0.5 text-[0.6875rem] leading-snug text-muted-foreground">{hint}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onReset && <ResetButton onClick={onReset} />}
          <span className="min-w-[3.25rem] rounded-md bg-white/[0.05] px-1.5 py-0.5 text-right font-mono text-[0.7188rem] tabular-nums text-foreground/90">
            {value}
            {unit}
          </span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="kiza-slider"
        style={{ ["--fill" as string]: `${fill}%` }}
      />
    </div>
  );
}

/**
 * A switch for something the theme recommends.
 *
 * Says who is being obeyed rather than only what is set: a designer turning
 * blur off in a theme somebody has already overridden in Settings would
 * otherwise flick a switch and watch nothing happen.
 */
export function SwitchRow({
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
    <Line
      label={label}
      hint={hint}
      warning={overridden ? "Your own setting overrides this, so the window will not change." : undefined}
    >
      <Toggle label={label} checked={checked} onChange={onChange} />
    </Line>
  );
}

/**
 * One of a few words, as a row of pills: a font, a pace, a side. The
 * launcher's own choice is marked as such, and picking it again clears the
 * theme's opinion rather than repeating the default.
 */
export function ChoiceRow<T extends string>({
  label,
  hint,
  options,
  value,
  fallback,
  onChange,
}: {
  label: string;
  hint?: string;
  options: { value: T; label: string; style?: React.CSSProperties }[];
  /** What the theme says, or undefined for the launcher's own. */
  value: T | undefined;
  /** The launcher's own choice. */
  fallback: T;
  onChange: (value: T | undefined) => void;
}) {
  const current = value ?? fallback;
  return (
    <div className="py-2.5">
      <div className="mb-2">
        <div className="text-[0.8125rem] leading-snug">{label}</div>
        {hint && <div className="mt-0.5 text-[0.6875rem] leading-snug text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(option.value === fallback ? undefined : option.value)}
              style={option.style}
              className={cn(
                "h-7 rounded-full px-3 text-[0.75rem] font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]",
                on ? "bg-primary text-primary-foreground" : "bg-secondary/55 text-foreground/85 hover:bg-secondary",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A short piece of text — a name, an author — typed straight into its row. */
export function TextRow({
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
    <label className="flex min-h-11 cursor-text items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[0.8125rem]">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-right text-[0.8125rem] text-foreground/90 outline-none placeholder:text-muted-foreground/60"
      />
    </label>
  );
}

/**
 * A picture, with what it looks like now.
 *
 * Dropping a file works because dragging one onto the thing it replaces is
 * what anybody would try first. The picture shown is the one the launcher is
 * drawing — the same URL, through the same resolver — so what is in this
 * frame is what is on screen.
 */
export function AssetCard({
  slot,
  label,
  hint,
  url,
  isVideo,
  isDefault,
  over,
  onPick,
  onRevert,
}: {
  slot: string;
  label: string;
  hint: string;
  url: string | undefined;
  isVideo: boolean;
  isDefault: boolean;
  over: boolean;
  onPick: () => void;
  onRevert: () => void;
}) {
  return (
    <section className="rounded-xl bg-secondary/[0.32] p-3 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
      <div className="mb-2.5 flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <h3 className="text-[0.8125rem] font-semibold text-foreground/90">{label}</h3>
          <p className="mt-0.5 text-[0.7188rem] leading-snug text-muted-foreground">{hint}</p>
        </div>
        {!isDefault && (
          <span className="shrink-0 rounded-full bg-primary/[0.16] px-2 py-0.5 text-[0.6562rem] font-semibold text-primary">
            Replaced
          </span>
        )}
      </div>
      {/*
        The drop zone is marked, not wired. Tauri takes a dragged file before
        the page sees it — which is what makes a drop a *path* rather than a
        copy of the bytes — so the panel listens once for the runtime's events
        and asks the document what is under the pointer. This attribute is
        the answer.
      */}
      <div
        data-kiza-drop={slot}
        className={cn(
          "flex h-28 items-center justify-center overflow-hidden rounded-[10px] bg-black/25 p-2 transition-[box-shadow,background-color] duration-200",
          over
            ? "bg-primary/[0.12] shadow-[inset_0_0_0_1.5px_hsl(var(--primary))]"
            : "shadow-[inset_0_0_0_1px_hsl(0_0%_100%/0.06)]",
        )}
      >
        {url ? (
          isVideo ? (
            <video src={url} className="max-h-full max-w-full rounded-md object-contain" muted loop playsInline autoPlay />
          ) : (
            <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
          )
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-[0.7188rem] text-muted-foreground">
            <ImageIcon className="h-5 w-5 opacity-70" />
            Drop a picture here
          </span>
        )}
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={onPick}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[9px] bg-secondary/70 text-[0.7812rem] font-medium text-foreground/90 transition-[background-color,scale] duration-150 hover:bg-secondary active:scale-[0.97]"
        >
          <Upload className="h-3.5 w-3.5" />
          Choose…
        </button>
        {!isDefault && (
          <button
            type="button"
            onClick={onRevert}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[0.7812rem] font-medium text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-white/[0.06] hover:text-foreground active:scale-[0.97]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Kiza's own
          </button>
        )}
      </div>
    </section>
  );
}
