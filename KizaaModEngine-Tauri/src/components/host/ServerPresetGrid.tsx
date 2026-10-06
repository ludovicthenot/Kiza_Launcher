import { Box, Check, Cloud, Cuboid, Sparkles, Users } from "lucide-react";
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

/** "Choose a preset": even cards, each lit by its own colour. */
export function ServerPresetGrid({ selectedId, onPick }: ServerPresetGridProps) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
      {SERVER_PRESETS.map((preset) => {
        const Icon = ICONS[preset.icon];
        const active = preset.id === selectedId;
        const [, sky, light] = preset.scene;
        return (
          <button
            key={preset.id}
            type="button"
            data-anim="preset"
            aria-pressed={active}
            onClick={() => onPick(preset)}
            {...editable("card")}
            className={cn(
              "kiza-card group relative flex min-h-[148px] flex-col overflow-hidden border bg-card/50 p-4 text-left",
              "transition-[border-color,transform,box-shadow] duration-300 ease-drawer hover:-translate-y-0.5 active:scale-[0.98]",
              active
                ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.7),0_16px_36px_-18px_hsl(var(--primary)/0.7)]"
                : "hover:border-foreground/15",
            )}
          >
            {/* The preset's light, as a soft wash from the corner. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-60 transition-opacity duration-300 group-hover:opacity-90"
              style={{ backgroundImage: `radial-gradient(120% 90% at 0% 0%, ${light}40 0%, ${sky}26 35%, transparent 70%)` }}
            />
            <span className="relative flex items-start justify-between">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-[11px] text-white shadow-[inset_0_1px_0_hsl(0_0%_100%/0.2)]"
                style={{ background: `linear-gradient(145deg, ${light}, ${sky})` }}
              >
                <Icon className="h-5 w-5" />
              </span>
              {active && (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground animate-in zoom-in-50 fade-in-0 duration-200">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
              )}
            </span>
            <span className="relative mt-auto pt-4">
              <span className="block text-[0.9375rem] font-semibold">{t(preset.name)}</span>
              <span className="mt-0.5 block text-[0.7812rem] leading-snug text-muted-foreground">{t(preset.description)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
