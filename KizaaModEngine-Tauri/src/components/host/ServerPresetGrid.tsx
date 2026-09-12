import { ArrowRight, Box, Cloud, Cuboid, Sparkles, Users } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { SERVER_PRESETS, type ServerPreset } from "../../lib/serverPresets";

const ICONS = {
  cube: Cuboid,
  sparkles: Sparkles,
  box: Box,
  cloud: Cloud,
  users: Users,
} satisfies Record<ServerPreset["icon"], typeof Box>;

interface ServerPresetGridProps {
  selectedId: string | null;
  onPick: (preset: ServerPreset) => void;
}

/** "Choose a preset": five cards, the last two wide, as in the reference. */
export function ServerPresetGrid({ selectedId, onPick }: ServerPresetGridProps) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-6 gap-4">
      {SERVER_PRESETS.map((preset) => {
        const Icon = ICONS[preset.icon];
        const active = preset.id === selectedId;
        return (
          <button
            key={preset.id}
            type="button"
            data-anim="preset"
            aria-pressed={active}
            onClick={() => onPick(preset)}
            {...editable("card")}
            className={cn(
              "kiza-card group relative flex min-h-[270px] flex-col overflow-hidden border bg-card/30 text-left transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/50",
              preset.wide ? "col-span-3" : "col-span-2",
              active && "border-primary/70 shadow-[0_0_30px_-8px_hsl(var(--primary)/0.7)]",
            )}
          >
            <PresetScene preset={preset} />
            <div className="relative mt-auto flex items-end gap-3 p-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xl font-bold">{t(preset.name)}</span>
                <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                  {t(preset.description)}
                </span>
              </span>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/60 text-foreground transition-colors group-hover:border-primary/60 group-hover:text-primary">
                <ArrowRight className="h-4 w-4" />
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The card's picture: a horizon, a sky and a light, from three colours.
 *
 * Every preset gets a different sky and a different glow; the fade at the
 * bottom is what keeps the caption readable over it.
 */
function PresetScene({ preset }: { preset: ServerPreset }) {
  const [ground, sky, light] = preset.scene;
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: [
            `radial-gradient(ellipse at 70% 30%, ${light}cc 0%, ${light}33 22%, transparent 45%)`,
            `radial-gradient(ellipse at 20% 85%, ${sky}99 0%, transparent 50%)`,
            `linear-gradient(180deg, ${sky} 0%, ${ground} 70%)`,
          ].join(","),
        }}
      />
      {/* A few blocks on the horizon, so it reads as a place and not a swatch. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[55%] opacity-40"
        style={{
          backgroundImage: `repeating-linear-gradient(90deg, ${ground} 0 14px, transparent 14px 26px, ${ground} 26px 52px, transparent 52px 60px)`,
          maskImage: "linear-gradient(180deg, transparent 0%, black 45%)",
          WebkitMaskImage: "linear-gradient(180deg, transparent 0%, black 45%)",
        }}
      />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[58%] bg-gradient-to-t from-background via-background/90 to-transparent" />
    </>
  );
}
