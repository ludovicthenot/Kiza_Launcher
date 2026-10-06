import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, Tag } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MinecraftVersionEntry } from "../../lib/queries";
import {
  filterMinecraftVersions,
  formatMinecraftVersionType,
} from "../../lib/minecraftVersions";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

interface MinecraftVersionPickerProps {
  versions: MinecraftVersionEntry[];
  value: string;
  onValueChange: (value: string) => void;
  releasesOnly: boolean;
  disabled?: boolean;
}

/**
 * The series a release belongs to: "1.21" for 1.21.11, "26" for 26.3.
 *
 * Grouping by series is what makes eighty releases scannable — you look
 * for "1.20", then the patch — where one flat column made you read them all.
 */
function seriesOf(id: string): string {
  const parts = id.split(".");
  return parts[0] === "1" ? parts.slice(0, 2).join(".") : parts[0];
}

/**
 * Choosing a Minecraft version, shaped like a menu: a pane of glass, one
 * compact line per version, grouped by series with the newest first, the
 * chosen one filled with the accent as a selected menu item is.
 */
export function MinecraftVersionPicker({
  versions,
  value,
  onValueChange,
  releasesOnly,
  disabled = false,
}: MinecraftVersionPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedOptionRef = useRef<HTMLButtonElement>(null);

  const supportedVersions = useMemo(
    () => filterMinecraftVersions(versions, releasesOnly),
    [releasesOnly, versions],
  );
  const selectedVersion = versions.find((version) => version.id === value);
  const visibleVersions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return supportedVersions;
    return supportedVersions.filter((version) =>
      `${version.id} ${version.type}`.toLocaleLowerCase().includes(needle),
    );
  }, [search, supportedVersions]);

  // Releases by series, in the catalogue's own order (newest first); the
  // previews in one group of their own at the end.
  const groups = useMemo(() => {
    const series = new Map<string, MinecraftVersionEntry[]>();
    const previews: MinecraftVersionEntry[] = [];
    for (const version of visibleVersions) {
      if (version.type !== "release") {
        previews.push(version);
        continue;
      }
      const key = seriesOf(version.id);
      series.set(key, [...(series.get(key) ?? []), version]);
    }
    const list = [...series.entries()].map(([key, entries]) => ({ key, label: key === "1" ? "1.x" : `${key}${key.includes(".") ? "" : ".x"}`, entries }));
    if (previews.length) list.push({ key: "previews", label: t("Snapshots and previews"), entries: previews });
    return list;
  }, [t, visibleVersions]);
  const latestRelease = supportedVersions.find((version) => version.type === "release")?.id;

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

  const release = selectedVersion?.type === "release";

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
          aria-label={t("Choose a Minecraft version")}
          className={cn(
            "flex min-h-11 w-full items-center gap-3 rounded-xl bg-secondary/45 px-3 text-left",
            "transition-[background-color,box-shadow] duration-150 hover:bg-secondary/65",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]",
              release ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300",
            )}
          >
            <Tag className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.8438rem] font-semibold tabular-nums">
              {value ? `Minecraft ${value}` : t("Select a version")}
            </span>
            <span className="block text-[0.7188rem] text-muted-foreground">
              {selectedVersion
                ? value === latestRelease
                  ? t("Latest release")
                  : t(formatMinecraftVersionType(selectedVersion.type))
                : t("Official Mojang catalog")}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          side="bottom"
          align="start"
          collisionPadding={16}
          onWheelCapture={(event) => event.stopPropagation()}
          className={cn(
            "pointer-events-auto z-[70] grid w-[var(--radix-popover-trigger-width)] min-w-[280px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl",
            "bg-popover/90 text-popover-foreground backdrop-blur-2xl backdrop-saturate-150",
            "shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.1),0_24px_60px_-12px_hsl(242_30%_2%/0.75)]",
            "max-h-[min(440px,var(--radix-popover-content-available-height))]",
            "origin-[var(--radix-popover-content-transform-origin)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-[0.97] data-[state=closed]:zoom-out-[0.97] duration-150",
          )}
        >
          <div className="p-2">
            <label className="flex h-9 items-center gap-2 rounded-[10px] bg-secondary/55 px-3 focus-within:shadow-[0_0_0_2px_hsl(var(--primary)/0.35)]">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Search 1.21.8, 1.12.2…")}
                className="min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-muted-foreground/60"
              />
            </label>
          </div>

          <div
            role="listbox"
            aria-label={t("Minecraft versions")}
            className="min-h-0 overflow-y-auto overscroll-contain px-1.5 pb-1.5"
          >
            {groups.length > 0 ? (
              groups.map((group) => (
                <section key={group.key} aria-label={group.label}>
                  <div className="sticky top-0 z-10 bg-popover/90 px-2.5 pb-1 pt-2.5 text-[0.6875rem] font-semibold text-muted-foreground backdrop-blur-xl">
                    {group.label}
                  </div>
                  {group.entries.map((version) => {
                    const selected = version.id === value;
                    return (
                      <button
                        ref={selected ? selectedOptionRef : undefined}
                        key={version.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-label={`Minecraft ${version.id} ${formatMinecraftVersionType(version.type)}`}
                        onClick={() => selectVersion(version)}
                        className={cn(
                          "group flex h-8 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[0.8125rem] outline-none transition-colors duration-75",
                          selected
                            ? "bg-primary text-primary-foreground"
                            : "text-foreground/90 hover:bg-white/[0.07] focus-visible:bg-white/[0.07]",
                        )}
                      >
                        <Check className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} strokeWidth={2.75} />
                        <span className="min-w-0 flex-1 truncate font-medium tabular-nums">{version.id}</span>
                        {version.id === latestRelease && (
                          <span className={cn("text-[0.6875rem]", selected ? "text-primary-foreground/80" : "text-emerald-300/90")}>
                            {t("Latest")}
                          </span>
                        )}
                        {version.type !== "release" && (
                          <span className={cn("text-[0.6875rem] capitalize", selected ? "text-primary-foreground/80" : "text-amber-300/90")}>
                            {t(formatMinecraftVersionType(version.type))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </section>
              ))
            ) : (
              <div className="px-4 py-10 text-center">
                <div className="text-[0.8125rem] font-semibold">{t("No matching version")}</div>
                <p className="mt-1 text-xs text-muted-foreground">{t("Try a version number such as 1.20.1.")}</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-3.5 pb-2.5 pt-1.5 text-[0.6875rem] text-muted-foreground">
            <span>{t("Minecraft 1.7 and newer")}</span>
            <span className="tabular-nums">
              {supportedVersions.length} {supportedVersions.length === 1 ? t("version") : t("versions")}
            </span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
