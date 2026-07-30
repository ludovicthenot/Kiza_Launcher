import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, Tag } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { MinecraftVersionEntry } from "../../lib/queries";
import {
  filterMinecraftVersions,
  formatMinecraftVersionType,
} from "../../lib/minecraftVersions";
import { cn } from "../../lib/utils";

interface MinecraftVersionPickerProps {
  versions: MinecraftVersionEntry[];
  value: string;
  onValueChange: (value: string) => void;
  releasesOnly: boolean;
  disabled?: boolean;
}

function VersionGroup({
  label,
  versions,
  selectedValue,
  onSelect,
  selectedOptionRef,
}: {
  label: string;
  versions: MinecraftVersionEntry[];
  selectedValue: string;
  onSelect: (version: MinecraftVersionEntry) => void;
  selectedOptionRef: RefObject<HTMLButtonElement | null>;
}) {
  if (versions.length === 0) return null;

  return (
    <section aria-label={label}>
      <div className="sticky top-0 z-10 flex items-center justify-between bg-popover/95 px-3 py-2 backdrop-blur-sm">
        <span className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">{versions.length}</span>
      </div>
      <div className="space-y-0.5 px-1.5 pb-2">
        {versions.map((version) => {
          const selected = version.id === selectedValue;
          return (
            <button
              ref={selected ? selectedOptionRef : undefined}
              key={version.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(version)}
              className={cn(
                "flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                "transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                selected
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                  version.type === "release"
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/25 bg-amber-500/10 text-amber-300",
                )}
              >
                <Tag className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold tabular-nums text-foreground">
                  Minecraft {version.id}
                </span>
                <span className="block text-xs capitalize text-muted-foreground">
                  {formatMinecraftVersionType(version.type)}
                </span>
              </span>
              <Check className={cn("h-4 w-4 shrink-0 text-primary", selected ? "opacity-100" : "opacity-0")} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function MinecraftVersionPicker({
  versions,
  value,
  onValueChange,
  releasesOnly,
  disabled = false,
}: MinecraftVersionPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedOptionRef = useRef<HTMLButtonElement>(null);

  const supportedVersions = useMemo(
    () => filterMinecraftVersions(versions, releasesOnly),
    [releasesOnly, versions],
  );
  const selectedVersion = versions.find((version) => version.id === value);
  const visibleVersions = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    if (!normalizedSearch) return supportedVersions;
    return supportedVersions.filter((version) =>
      `${version.id} ${version.type}`.toLocaleLowerCase().includes(normalizedSearch),
    );
  }, [search, supportedVersions]);
  const releases = visibleVersions.filter((version) => version.type === "release");
  const previews = visibleVersions.filter((version) => version.type !== "release");

  const selectVersion = (version: MinecraftVersionEntry) => {
    onValueChange(version.id);
    setOpen(false);
    setSearch("");
  };

  useEffect(() => {
    if (!open || search) return;
    const frame = window.requestAnimationFrame(() => {
      selectedOptionRef.current?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, search]);

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
          disabled={disabled}
          aria-label="Choose a Minecraft version"
          className={cn(
            "flex min-h-12 w-full items-center gap-3 rounded-lg border border-border bg-secondary/25 px-3 text-left",
            "shadow-[inset_0_1px_0_hsl(0_0%_100%/0.03)] transition-[background-color,border-color,box-shadow] duration-150",
            "hover:border-primary/35 hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
              selectedVersion?.type === "release"
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/25 bg-amber-500/10 text-amber-300",
            )}
          >
            <Tag className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold tabular-nums">
              {value ? `Minecraft ${value}` : "Select a version"}
            </span>
            <span className="block text-xs capitalize text-muted-foreground">
              {selectedVersion ? formatMinecraftVersionType(selectedVersion.type) : "Official Mojang catalog"}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          side="bottom"
          align="start"
          collisionPadding={16}
          onWheelCapture={(event) => event.stopPropagation()}
          className={cn(
            "pointer-events-auto z-[70] grid w-[var(--radix-popover-trigger-width)] min-w-[320px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl border border-border/80 bg-popover text-popover-foreground kiza-elevated",
            "max-h-[min(420px,var(--radix-popover-content-available-height))]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          )}
        >
          <div className="border-b border-border/70 p-2.5">
            <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-secondary/25 px-3 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search 1.21.8, 1.12.2..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          </div>

          <div role="listbox" aria-label="Minecraft versions" className="min-h-0 overflow-y-auto overscroll-contain py-1">
            {visibleVersions.length > 0 ? (
              <>
                <VersionGroup
                  label="Stable releases"
                  versions={releases}
                  selectedValue={value}
                  onSelect={selectVersion}
                  selectedOptionRef={selectedOptionRef}
                />
                <VersionGroup
                  label="Snapshots and previews"
                  versions={previews}
                  selectedValue={value}
                  onSelect={selectVersion}
                  selectedOptionRef={selectedOptionRef}
                />
              </>
            ) : (
              <div className="px-4 py-10 text-center">
                <div className="text-sm font-semibold">No matching version</div>
                <p className="mt-1 text-xs text-muted-foreground">Try a version number such as 1.20.1.</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border/70 bg-secondary/15 px-3 py-2 text-[11px] text-muted-foreground">
            <span>Minecraft 1.7 and newer</span>
            <span className="tabular-nums">
              {supportedVersions.length} {supportedVersions.length === 1 ? "version" : "versions"}
            </span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
