import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Check, FileUp, Loader2, Palette, Play, RotateCcw, Sparkles, Star, Trash2 } from "lucide-react";
import {
  ACCENT_PRESETS,
  Appearance,
  applyAppearance,
  Density,
  effectiveEffects,
  getStoredAppearance,
  FALLBACK_RADIUS,
  hexToHslTriple,
} from "../../lib/appearance";
import { applyTheme, useAppliedThemeId, useThemes } from "../../lib/theme";
import { activeTheme } from "../../lib/theme/engine";
import { DEFAULT_THEME_ID } from "../../lib/theme/builtin";
import { importThemeFile, isBuiltIn, removeInstalledTheme } from "../../lib/theme/installed";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { ColourPicker } from "../ui/colour-picker";

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
            // Moved by transform on a spring, not by `left`: no layout per frame.
            "absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-300 ease-spring",
            checked ? "translate-x-5" : "translate-x-0",
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
  const themes = useThemes();
  const theme = useAppliedThemeId();
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  /**
   * Adds a theme somebody was given, and wears it.
   *
   * What the Maker exports is a `.kizatheme`, and until now the launcher had
   * the commands to open one and no way to ask for them: a theme made in the
   * Maker could not be worn anywhere but the Maker.
   */
  const importTheme = async () => {
    const chosen = await openFileDialog({
      multiple: false,
      directory: false,
      filters: [{ name: t("Kiza theme"), extensions: ["kizatheme"] }],
    }).catch(() => null);
    if (typeof chosen !== "string") return;
    setImporting(true);
    try {
      const added = await importThemeFile(chosen);
      applyTheme(added.id);
      toast.success(t("{name} is on.").replace("{name}", added.name));
    } catch (problem) {
      toast.error(t("That theme could not be opened: {reason}").replace("{reason}", String(problem)));
    } finally {
      setImporting(false);
    }
  };

  const removeTheme = async (id: string) => {
    setRemoving(id);
    try {
      // Off the theme being worn first, so the window never paints one whose
      // pictures have just been deleted.
      if (id === theme) applyTheme(DEFAULT_THEME_ID);
      await removeInstalledTheme(id);
    } catch (problem) {
      toast.error(String(problem));
    } finally {
      setRemoving(null);
    }
  };
  const [appearance, setAppearance] = useState<Appearance>(() => getStoredAppearance());

  const update = (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    applyAppearance(next);
  };

  // What is actually in force, so an overridden switch shows as off rather
  // than lying about its stored value.
  const effects = effectiveEffects(appearance);

  const densities: { id: Density; label: string }[] = [
    { id: "compact", label: t("Compact") },
    { id: "comfortable", label: t("Comfortable") },
    { id: "spacious", label: t("Spacious") },
  ];

  return (
    <div className="space-y-7">
      <section>
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h3 className="mb-1 text-sm font-semibold">{t("Theme")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("Choose the launcher's look. The change applies immediately.")}
            </p>
          </div>
          {isTauri() && (
            <button
              type="button"
              onClick={() => void importTheme()}
              disabled={importing}
              className="inline-flex shrink-0 items-center gap-2 rounded-[9px] bg-secondary/70 px-3.5 py-2 text-sm transition hover:bg-secondary disabled:opacity-60"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {t("Import a theme")}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {themes.map((item) => {
            const active = theme === item.id;
            const imported = !isBuiltIn(item.id);
            return (
              <div key={item.id} className="group relative">
              <button
                type="button"
                onClick={() => applyTheme(item.id)}
                aria-pressed={active}
                title={item.description}
                className={cn(
                  "relative w-full rounded-xl border p-3 text-left transition",
                  active ? "border-primary bg-primary/5" : "border-border/70 hover:bg-secondary",
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
                {imported && (
                  <div className="truncate text-xs text-muted-foreground">{t("Imported")}</div>
                )}
              </button>
              {/* Only an imported theme can go: the four Kiza ships with are
                  part of the launcher, not files somebody added. */}
              {imported && (
                <button
                  type="button"
                  onClick={() => void removeTheme(item.id)}
                  disabled={removing === item.id}
                  title={t("Remove this theme")}
                  aria-label={t("Remove this theme")}
                  className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-destructive/[0.15] hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  {removing === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              </div>
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

          <div className="ml-1 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("Custom")}</span>
            <ColourPicker
              label={t("Custom accent colour")}
              value={appearance.accent}
              onChange={(hex) => update({ accent: hex })}
            />
          </div>
        </div>

        {appearance.accent && !hexToHslTriple(appearance.accent) && (
          <p className="mt-2 text-xs text-destructive">
            {t("That is not a colour Kiza can read, so the theme's own accent is being used.")}
          </p>
        )}

        {/* An instance card, drawn from the same components the library uses,
            so that what is previewed is what will be there. */}
        <div className="mt-4 rounded-xl bg-secondary/[0.32] p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("Preview")}
          </div>
          <div className="flex max-w-sm items-center gap-3 rounded-[var(--radius)] border border-border/70 bg-background p-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[calc(var(--radius)-4px)] bg-primary text-lg font-bold text-primary-foreground">
              K
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {themes.find((item) => item.id === theme)?.name ?? "Kiza"}
              </div>
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
          <div className="flex items-center gap-1 rounded-[9px] bg-secondary/70 p-1">
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
            value={appearance.radius ?? activeTheme()?.radius ?? FALLBACK_RADIUS}
            onChange={(event) => update({ radius: Number(event.target.value) })}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
          <span className="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
            {appearance.radius ?? activeTheme()?.radius ?? FALLBACK_RADIUS} px
          </span>
          {/* Moving the slider is a choice; this hands the corners back to
              whichever theme is on. Hidden while there is nothing to undo. */}
          <button
            type="button"
            onClick={() => update({ radius: null })}
            title={t("Follow the theme")}
            aria-label={t("Follow the theme")}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground",
              appearance.radius === null && "invisible",
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
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
