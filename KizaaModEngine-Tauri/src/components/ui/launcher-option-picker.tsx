import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/utils";

export interface LauncherOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  disabled?: boolean;
}

interface LauncherOptionPickerProps {
  ariaLabel: string;
  options: ReadonlyArray<LauncherOption>;
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
}

export function LauncherOptionPicker({
  ariaLabel,
  options,
  value,
  onValueChange,
  placeholder,
  disabled = false,
  loading = false,
}: LauncherOptionPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((option) => option.value === value);
  const visibleOptions = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      `${option.label} ${option.description ?? ""} ${option.badge ?? ""}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [options, search]);

  return (
    <Popover.Root
      modal
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={disabled || loading}
          className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-secondary/25 px-3 text-left transition-[background-color,border-color,box-shadow] duration-150 hover:border-primary/35 hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {loading ? "Loading compatible versions..." : selected?.label ?? placeholder}
            </span>
            {(selected?.description || selected?.badge) && (
              <span className="block truncate text-xs text-muted-foreground">
                {selected?.description ?? selected?.badge}
              </span>
            )}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")} />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="start"
          collisionPadding={16}
          onWheelCapture={(event) => event.stopPropagation()}
          className="pointer-events-auto z-[70] w-[var(--radix-popover-trigger-width)] min-w-[280px] overflow-hidden rounded-xl border border-border/80 bg-popover text-popover-foreground kiza-elevated data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
        >
          {options.length >= 8 && (
            <div className="border-b border-border/70 p-2.5">
              <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/25 px-3 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search versions..."
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                />
              </div>
            </div>
          )}
          <div role="listbox" aria-label={ariaLabel} className="max-h-[min(360px,50dvh)] overflow-y-auto p-1.5">
            {visibleOptions.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={option.disabled}
                  onClick={() => {
                    onValueChange(option.value);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={cn(
                    "flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40",
                    active ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{option.label}</span>
                    {(option.description || option.badge) && (
                      <span className="block truncate text-xs text-muted-foreground">{option.description ?? option.badge}</span>
                    )}
                  </span>
                  <Check className={cn("h-4 w-4 shrink-0 text-primary", active ? "opacity-100" : "opacity-0")} />
                </button>
              );
            })}
            {visibleOptions.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">No matching option</div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
