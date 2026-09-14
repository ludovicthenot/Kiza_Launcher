import { LayoutGrid, Server } from "lucide-react";
import { useAppStore, type LibraryMode } from "../../lib/store";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { part } from "../../lib/theme/parts";

/**
 * Instances | Host — the two halves of the front page.
 *
 * One control shared by both pages, so it sits in the same place whichever
 * side you are on and switching reads as flipping the page over rather than
 * going somewhere else. The height matches the header buttons beside it.
 */
export function LibraryModeSwitch() {
  const { t } = useI18n();
  const mode = useAppStore((state) => state.libraryMode);
  const setMode = useAppStore((state) => state.setLibraryMode);

  const options: Array<{ id: LibraryMode; label: string; icon: typeof LayoutGrid }> = [
    { id: "instances", label: t("Instances"), icon: LayoutGrid },
    { id: "host", label: t("Host"), icon: Server },
  ];

  return (
    <div
      role="tablist"
      aria-label={t("Front page")}
      {...part("library.mode")}
      {...editable("secondary")}
      className="kiza-secondary flex h-[54px] shrink-0 items-center gap-1 border p-1"
    >
      {options.map((option) => {
        const active = option.id === mode;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setMode(option.id)}
            className={cn(
              "inline-flex h-full items-center gap-2.5 rounded-[10px] px-6 text-base font-semibold transition-[background-image,color,filter] duration-150",
              active
                ? "kiza-action text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <option.icon className="h-[18px] w-[18px]" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
