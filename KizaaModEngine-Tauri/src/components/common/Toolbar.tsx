import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Filter, Search } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { part } from "../../lib/theme/parts";

/**
 * The search field of a front page: always on the page rather than behind a
 * button, because a field you can see is one you type into without
 * deciding to. Ctrl+K (⌘K on a Mac) lands the cursor in it from anywhere.
 */
export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  className,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  /** Its name for a theme that places it (`library.search`). */
  name?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <label
      {...editable("secondary")}
      {...(name ? part(name) : {})}
      className={cn(
        "kiza-secondary flex h-[54px] min-w-0 items-center gap-3 border px-5 text-muted-foreground transition-colors",
        "focus-within:border-primary/50 focus-within:text-foreground",
        className,
      )}
    >
      <Search className="h-5 w-5 shrink-0" />
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
      />
      <kbd className="hidden shrink-0 items-center gap-1 rounded-md border border-border/70 bg-background/40 px-2 py-0.5 font-sans text-xs text-muted-foreground sm:inline-flex">
        {mac ? "⌘" : "Ctrl"} K
      </kbd>
    </label>
  );
}

export interface FilterSection {
  title: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
}

/**
 * "Filter ▾": one button, a small menu of choices under it. Each section is
 * a question with one answer at a time — the order, the loader — and the
 * button lights up when any answer is not the default, so a shelf that
 * looks short says why.
 */
export function FilterMenu({ sections, active, className }: { sections: FilterSection[]; active: boolean; className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        {...editable("secondary")}
        className={cn(
          "kiza-secondary inline-flex h-[54px] items-center gap-3 border px-6 text-base font-medium transition-colors",
          open || active ? "border-primary/50 text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Filter className={cn("h-5 w-5", active && "text-primary")} />
        {t("Filter")}
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="menu" className="kiza-enter kiza-elevated absolute right-0 top-[62px] z-40 w-56 rounded-xl border border-border/80 bg-popover p-1.5">
          {sections.map((section, index) => (
            <div key={section.title} className={cn(index > 0 && "mt-1.5 border-t border-border/60 pt-1.5")}>
              <div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </div>
              {section.options.map((option) => {
                const chosen = option.id === section.value;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={chosen}
                    onClick={() => section.onChange(option.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition",
                      chosen ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )}
                  >
                    {option.label}
                    {chosen && <Check className="h-4 w-4 text-primary" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
