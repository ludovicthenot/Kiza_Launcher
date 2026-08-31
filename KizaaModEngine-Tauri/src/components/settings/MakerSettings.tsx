/**
 * Settings → Kiza Maker.
 *
 * Present only in the Maker edition, and reached only from a settings page that
 * is itself only listed there. The button does not open a window: it starts an
 * editing session, and the panel that appears is beside the launcher you are
 * already looking at.
 */

import { Palette, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { EDITION_NAME } from "../../lib/edition";
import { openMaker } from "../../lib/maker/session";
import { effectiveTheme, useThemeStore } from "../../lib/theme/store";
import { THEMES } from "../../lib/theme";

export function MakerSettings() {
  const session = useThemeStore((state) => state.session);
  const state = useThemeStore();
  const current = effectiveTheme(state);

  const start = async (fromId?: string) => {
    const from = fromId ? state.available.find((theme) => theme.id === fromId) : current;
    await openMaker(from);
    if (from?.readOnly) {
      toast.success(`Editing a copy of ${from.name}. The original is untouched.`);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="h-5 w-5 text-primary" />
          Kiza Maker
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          This is {EDITION_NAME.maker}: the launcher with the theme tools in it. Opening the Maker
          widens the window and puts an editor beside Kiza. Everything on the left stays the real
          launcher — browse it, open an instance, look at any page — and it repaints as you edit.
        </p>
      </header>

      <section className="rounded-xl border border-border/70 bg-card/40 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {session ? "The Maker is open" : `Start from ${current.name}`}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {session
                ? "The panel is beside the launcher."
                : current.readOnly
                  ? "Kiza's own themes are read-only, so this makes a copy to work on."
                  : "Picks up where this theme left off."}
            </p>
          </div>
          <button
            type="button"
            disabled={session !== null}
            onClick={() => void start()}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl kiza-action px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
          >
            <Palette className="h-4 w-4" />
            Open Kiza Maker
          </button>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Or start from one of Kiza's own
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              disabled={session !== null}
              onClick={() => void start(theme.id)}
              className="flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/20 p-3 text-left transition hover:border-primary/40 disabled:opacity-50"
            >
              <span className="flex shrink-0 gap-1">
                {theme.swatches.map((swatch, index) => (
                  <span
                    key={index}
                    className="h-6 w-3 rounded-sm border border-border/50"
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{theme.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  Copy and edit
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
