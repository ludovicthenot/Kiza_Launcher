import { useState } from "react";
import { Check, Monitor, Moon, Palette, Play, Sparkles, Star, Sun } from "lucide-react";
import {
  ACCENT_PRESETS,
  Appearance,
  applyAppearance,
  ColorScheme,
  Density,
  effectiveEffects,
  getStoredAppearance,
  hexToHslTriple,
} from "../../lib/appearance";
import { applyTheme, getStoredTheme, THEMES, ThemeId } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

/** A switch that reads as fixed when something above it is overriding it. */
function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-2.5",
        disabled && "opacity-50",
      )}
    >
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition",
          checked ? "bg-primary" : "bg-muted",
          disabled && "cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-4 w-4 rounded-full bg-white transition-all",
            checked ? "left-6" : "left-1",
          )}
        />
      </button>
    </div>
  );
}

/**
 * Everything about how the launcher looks.
 *
 * Each control writes straight through to the document, so the page you are
 * changing is the preview: there is no Apply button because there is nothing
 * to apply later.
 */
export function AppearanceSettings() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<ThemeId>(() => getStoredTheme());
  const [appearance, setAppearance] = useState<Appearance>(() => getStoredAppearance());

  const update = (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    applyAppearance(next);
  };

  // What is actually in force, so an overridden switch shows as off rather
  // than lying about its stored value.
  const effects = effectiveEffects(appearance);

  const schemes: { id: ColorScheme; label: string; icon: typeof Sun }[] = [
    { id: "dark", label: t("Dark"), icon: Moon },
    { id: "light", label: t("Light"), icon: Sun },
    { id: "system", label: t("System"), icon: Monitor },
  ];

  const densities: { id: Density; label: string }[] = [
    { id: "compact", label: t("Compact") },
    { id: "comfortable", label: t("Comfortable") },
    { id: "spacious", label: t("Spacious") },
  ];

  return (
    <div className="space-y-7">
      <section>
        <h3 className="mb-3 text-sm font-semibold">{t("Colour scheme")}</h3>
        <div className="grid grid-cols-3 gap-3">
          {schemes.map((entry) => {
            const Icon = entry.icon;
            const active = appearance.scheme === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => update({ scheme: entry.id })}
                aria-pressed={active}
                className={cn(
                  "relative flex flex-col items-center gap-2 rounded-xl border p-4 transition",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border/70 hover:border-primary/40",
                )}
              >
                {active && (
                  <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />
                )}
                <Icon className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium">{entry.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold">{t("Theme")}</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          {t("Choose the launcher's look. The change applies immediately.")}
        </p>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {THEMES.map((item) => {
            const active = theme === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTheme(item.id);
                  applyTheme(item.id);
                }}
                aria-pressed={active}
                title={item.description}
                className={cn(
                  "relative rounded-xl border p-3 text-left transition",
                  active ? "border-primary bg-primary/5" : "border-border/70 hover:border-primary/40",
                )}
              >
                {active && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />}
                <div className="mb-3 flex gap-1.5">
                  {item.swatches.map((swatch, index) => (
                    <span
                      key={index}
                      className="h-6 w-6 rounded-full border border-white/10"
                      style={{ background: swatch }}
                    />
                  ))}
                </div>
                <div className="truncate text-sm font-medium">{item.name}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Palette className="h-4 w-4 text-muted-foreground" />
          {t("Accent colour")}
        </h3>
        <p className="mb-3 text-sm text-muted-foreground">
          {t("Buttons, highlights and the selection you are looking at right now.")}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {/* Following the theme is a choice of its own, not the absence of
              one, so it gets a swatch like the rest. */}
          <button
            type="button"
            onClick={() => update({ accent: null })}
            aria-pressed={appearance.accent === null}
            title={t("Follow the theme")}
            aria-label={t("Follow the theme")}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full border-2 transition",
              appearance.accent === null
                ? "border-foreground"
                : "border-border/70 hover:border-primary/50",
            )}
          >
            <Star className="h-4 w-4 text-muted-foreground" />
          </button>

          {ACCENT_PRESETS.map((colour) => (
            <button
              key={colour}
              type="button"
              onClick={() => update({ accent: colour })}
              aria-pressed={appearance.accent?.toLowerCase() === colour.toLowerCase()}
              aria-label={colour}
              title={colour}
              style={{ background: colour }}
              className={cn(
                "h-9 w-9 rounded-full border-2 transition",
                appearance.accent?.toLowerCase() === colour.toLowerCase()
                  ? "border-foreground"
                  : "border-transparent hover:border-white/40",
              )}
            />
          ))}

          <label className="ml-1 flex items-center gap-2 rounded-lg border border-border/70 bg-secondary/25 px-2 py-1.5">
            <span className="text-xs text-muted-foreground">{t("Custom")}</span>
            <input
              type="color"
              aria-label={t("Custom accent colour")}
              value={appearance.accent ?? "#8B5CF6"}
              onChange={(event) => update({ accent: event.target.value })}
              className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {appearance.accent ? appearance.accent.toUpperCase() : t("theme")}
            </span>
          </label>
        </div>

        {appearance.accent && !hexToHslTriple(appearance.accent) && (
          <p className="mt-2 text-xs text-destructive">
            {t("That is not a colour Kiza can read, so the theme's own accent is being used.")}
          </p>
        )}

        {/* An instance card, drawn from the same components the library uses,
            so that what is previewed is what will be there. */}
        <div className="mt-4 rounded-xl border border-border/60 bg-secondary/10 p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("Preview")}
          </div>
          <div className="flex max-w-sm items-center gap-3 rounded-[var(--radius)] border border-border/70 bg-background p-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[calc(var(--radius)-4px)] bg-primary text-lg font-bold text-primary-foreground">
              K
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">Kiza Nebula</div>
              <div className="text-xs text-muted-foreground">1.20.4 · {t("Ready to play")}</div>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-4px)] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              <Play className="h-3.5 w-3.5" />
              {t("Play")}
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">{t("Interface")}</h3>

        <div className="mb-4 flex items-center justify-between gap-4">
          <span className="text-sm">{t("Density")}</span>
          <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-secondary/30 p-1">
            {densities.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => update({ density: entry.id })}
                aria-pressed={appearance.density === entry.id}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  appearance.density === entry.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <label className="mb-4 flex items-center gap-4">
          <span className="w-40 shrink-0 text-sm">{t("Text size")}</span>
          <input
            type="range"
            min={85}
            max={130}
            step={5}
            value={appearance.textScale}
            onChange={(event) => update({ textScale: Number(event.target.value) })}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
          <span className="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
            {appearance.textScale} %
          </span>
        </label>

        <label className="flex items-center gap-4">
          <span className="w-40 shrink-0 text-sm">{t("Corner radius")}</span>
          <input
            type="range"
            min={0}
            max={20}
            step={2}
            value={appearance.radius}
            onChange={(event) => update({ radius: Number(event.target.value) })}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
          <span className="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
            {appearance.radius} px
          </span>
        </label>

        <div className="mt-2 divide-y divide-border/50">
          <Toggle
            label={t("Show instance artwork")}
            hint={t("Hidden, not deleted: the card falls back to its gradient.")}
            checked={appearance.showInstanceArt}
            onChange={(value) => update({ showInstanceArt: value })}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold">{t("Visual effects")}</h3>
        <div className="divide-y divide-border/50">
          <Toggle
            label={t("Reduce effects on modest machines")}
            hint={t("Turns the three below off without forgetting how you had them.")}
            checked={appearance.reduceEffects}
            onChange={(value) => update({ reduceEffects: value })}
          />
          {/* Shown as off and locked while the switch above overrides them,
              rather than silently rewritten — turning it back off restores
              exactly what was chosen here. */}
          <Toggle
            label={t("Interface animations")}
            checked={effects.animations}
            disabled={appearance.reduceEffects}
            onChange={(value) => update({ animations: value })}
          />
          <Toggle
            label={t("Panel translucency")}
            checked={effects.translucency}
            disabled={appearance.reduceEffects}
            onChange={(value) => update({ translucency: value })}
          />
          <Toggle
            label={t("Background blur")}
            checked={effects.backgroundBlur}
            disabled={appearance.reduceEffects}
            onChange={(value) => update({ backgroundBlur: value })}
          />
        </div>
      </section>

      <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        {t("Every change here applies at once and is kept for next time.")}
      </p>
    </div>
  );
}
