import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Box,
  Globe2,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Search,
  Settings2,
} from "lucide-react";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";
import { ActiveTab, ContentCategoryId, useAppStore } from "../../lib/store";
import {
  useInstanceCover,
  useInstances,
  useMinecraftContent,
  useMods,
  useShaderpacks,
} from "../../lib/queries";
import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { acceptsMods, categoriesFor } from "./content/contentCategories";
import { LoaderLogo } from "../common/LoaderLogo";
import { part } from "../../lib/theme/parts";

const COLLAPSED_KEY = "kiza.instanceSidebar.collapsed";

/** A per-viewer convenience: a blocked store just means it starts open. */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(value));
  } catch {
    /* nothing to keep */
  }
}

/**
 * The instance's own navigation.
 *
 * The content kinds are top-level rather than folded under one "content" entry:
 * a player looking for their shaders looks for the word "shaders", and making
 * them find it inside "installed content" first is a step that buys nothing.
 *
 * The list is contextual. Browsing a platform is a different place from
 * managing what is installed, so while Discover is open the first row becomes
 * the way back to the installed mods, and Discover itself sits under it.
 *
 * It folds down to its icons. Discover in particular wants the width, and
 * someone who knows the icons has no use for the words; the names come back
 * as a label beside each icon on hover, and the choice is remembered.
 */
export function InstanceSidebar() {
  const { t } = useI18n();
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const contentCategory = useAppStore((state) => state.contentCategory);
  const setContentCategory = useAppStore((state) => state.setContentCategory);
  const selectedInstanceId = useAppStore((state) => state.selectedInstanceId);
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () => {
    setCollapsed((value) => {
      writeCollapsed(!value);
      return !value;
    });
  };
  // Ctrl+B, the shortcut most desktop apps give their sidebar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]");
      if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data: instances } = useInstances();
  const instance = instances?.find((entry) => entry.id === selectedInstanceId);
  const { data: cover } = useInstanceCover(selectedInstanceId ?? "");
  const { data: mods } = useMods(selectedInstanceId ?? null);
  const { data: shaders } = useShaderpacks(selectedInstanceId ?? null);
  const { data: resourcepacks } = useMinecraftContent(
    selectedInstanceId ?? null,
    "resourcepack",
  );

  const browsing = activeTab === "discover";

  const loaderLabel =
    instance?.minecraft?.loader === "fabric"
      ? "Fabric"
      : instance?.minecraft?.loader === "forge"
        ? "Forge"
        : instance?.minecraft
          ? "Vanilla"
          : null;
  const ready = instance?.status === "Valid";

  /**
   * How many of each kind are installed.
   *
   * Data packs are deliberately uncounted: they live inside a world, so the
   * number depends on which world, and the sidebar does not know that. A number
   * that means nothing is worse than no number.
   */
  const countOf = (id: ContentCategoryId): number | undefined => {
    if (id === "mod") return mods?.length;
    if (id === "shader") return shaders?.length;
    if (id === "resourcepack") return resourcepacks?.length;
    return undefined;
  };

  /** The name beside an icon, for the folded sidebar. */
  const tooltip = (text: string) =>
    collapsed && (
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 translate-x-[-4px] whitespace-nowrap rounded-lg bg-popover/95 px-2.5 py-1.5 text-xs font-medium text-foreground opacity-0 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.08),0_10px_28px_hsl(242_30%_2%/0.6)] backdrop-blur-xl transition-[opacity,transform] duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
      >
        {text}
      </span>
    );

  const row = ({
    key,
    label,
    Icon,
    active,
    badge,
    onClick,
  }: {
    key: string;
    label: string;
    Icon: typeof Search;
    active: boolean;
    badge?: number;
    onClick: () => void;
  }) => (
    <button
      key={key}
      type="button"
      data-anim="sidebar-row"
      onClick={onClick}
      aria-label={collapsed ? t(label) : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "kiza-nav group relative flex h-[calc(2.5rem*var(--kiza-density))] w-full items-center gap-3 rounded-[10px] px-3 text-[0.8438rem] font-medium outline-none transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-primary/60",
        collapsed && "justify-center px-0",
        active
          ? "!bg-primary/[0.14] text-foreground"
          : "text-muted-foreground hover:!bg-secondary/45 hover:text-foreground",
      )}
    >
      <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-colors duration-150", active && "text-primary")} />
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{t(label)}</span>}
      {!collapsed && badge !== undefined && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{badge}</span>
      )}
      {tooltip(badge !== undefined ? `${t(label)} · ${badge}` : t(label))}
    </button>
  );

  /** Shows what is installed of one kind. */
  const openInstalled = (id: ContentCategoryId) => {
    setContentCategory(id);
    setActiveTab("mods");
  };

  /** Browses a platform for one kind, staying on the Discover side. */
  const openDiscover = (id: ContentCategoryId) => {
    setContentCategory(id);
    setActiveTab("discover");
  };

  const plainRow = (id: ActiveTab, label: string, Icon: typeof Search) =>
    row({
      key: id,
      label,
      Icon,
      active: activeTab === id,
      onClick: () => setActiveTab(id),
    });

  // Only what this instance can hold. A Vanilla instance sees packs and
  // nothing else, and the mods-first layout below has no first row to draw.
  const loader = instance?.minecraft?.loader;
  const categories = categoriesFor(loader);
  const modded = acceptsMods(loader);
  const mod = modded ? categories[0] : undefined;
  const otherCategories = modded ? categories.slice(1) : categories;

  /**
   * The two lists swap with a horizontal slide, and the direction says which
   * way you went: leaving Discover, the installed list arrives from the right
   * and settles left; entering it, the browse list arrives from the left.
   */
  const contentRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (prefersReducedMotion()) return;
    gsap.from('[data-anim="sidebar-row"]', {
      x: browsing ? -28 : 28,
      opacity: 0,
      duration: 0.28,
      ease: "power3.out",
      stagger: 0.035,
      overwrite: "auto",
      clearProps: "transform,opacity",
    });
  }, { dependencies: [browsing], scope: contentRef });

  /** A section's name when open; a hairline when folded. */
  const sectionLabel = (text: string, trailing?: ReactNode) =>
    collapsed ? (
      <div aria-hidden className="mx-3 mb-2 h-px bg-border/50" />
    ) : (
      <div className="mb-1 flex h-7 items-center gap-2 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
        <span className="flex-1 truncate">{text}</span>
        {trailing}
      </div>
    );

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        // A theme may put it on the right (`--kiza-sidebar-order`).
        "kiza-sidebar flex shrink-0 flex-col gap-5 border-r pb-3 pt-[4.25rem] [order:var(--kiza-sidebar-order,0)] transition-[width,padding] duration-300 ease-drawer motion-reduce:transition-none",
        collapsed ? "w-[72px] px-3" : "w-[272px] px-3 xl:w-[288px]",
      )}
    >
      {/* Back, and the fold. */}
      <div className={cn("flex items-center gap-1", collapsed && "flex-col")}>
        <button
          type="button"
          onClick={() => setSelectedInstanceId(null)}
          aria-label={collapsed ? t("All instances") : undefined}
          className={cn(
            "group relative flex h-[calc(2.25rem*var(--kiza-density))] min-w-0 items-center gap-2 rounded-[10px] px-2 text-[0.8125rem] text-muted-foreground transition-[background-color,color] duration-150 hover:bg-secondary/45 hover:text-foreground",
            collapsed ? "w-full justify-center px-0" : "flex-1",
          )}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">{t("All instances")}</span>}
          {tooltip(t("All instances"))}
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t("Show the sidebar") : t("Hide the sidebar")}
          aria-expanded={!collapsed}
          title={`${collapsed ? t("Show the sidebar") : t("Hide the sidebar")} (Ctrl+B)`}
          className={cn(
            "flex h-9 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-secondary/45 hover:text-foreground active:scale-[0.94]",
            collapsed ? "w-full" : "w-9",
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
        </button>
      </div>

      {/* Which instance this is. Folded, the cover alone, its state a dot on it. */}
      <div {...part("sidebar.instance")} className={cn("group relative flex items-center gap-3", collapsed ? "justify-center" : "px-1")}>
        <div
          className={cn(
            "relative shrink-0 transition-[width,height,border-radius] duration-300 ease-drawer motion-reduce:transition-none",
            collapsed ? "h-11 w-11" : "h-14 w-14",
          )}
        >
          {/* The picture over the icon rather than instead of it, and marked
              as instance art: "Show instance artwork" off hides the picture,
              and the icon underneath is what is left, as on a library card. */}
          <div
            data-instance-poster=""
            className={cn("relative h-full w-full overflow-hidden bg-secondary/50", collapsed ? "rounded-[12px]" : "rounded-[15px]")}
          >
            <div className="flex h-full w-full items-center justify-center">
              <Box className={cn("text-primary", collapsed ? "h-5 w-5" : "h-6 w-6")} />
            </div>
            {cover && (
              <img src={cover.uri} alt="" className="absolute inset-0 h-full w-full object-cover outline outline-1 -outline-offset-1 outline-white/10" />
            )}
          </div>
          {collapsed && (
            <span
              aria-hidden
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full shadow-[0_0_0_2.5px_hsl(var(--background))]",
                ready ? "bg-emerald-400" : "bg-amber-400",
              )}
            />
          )}
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <div className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em]">{instance?.display_name}</div>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {instance?.minecraft && <LoaderLogo loader={instance.minecraft.loader} className="h-3.5 w-3.5 rounded-[3px] shadow-none" />}
              <span className="truncate">
                {instance?.minecraft?.mc_version}
                {loaderLabel && ` · ${loaderLabel}`}
              </span>
            </div>
            <div
              className={cn(
                "mt-0.5 inline-flex items-center gap-1.5 text-xs",
                ready ? "text-emerald-400" : "text-amber-400",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", ready ? "bg-emerald-400" : "bg-amber-400")} />
              {ready ? t("Instance ready") : t("Needs attention")}
            </div>
          </div>
        ) : (
          tooltip(
            `${instance?.display_name ?? ""} · ${instance?.minecraft?.mc_version ?? ""}${loaderLabel ? ` ${loaderLabel}` : ""}`,
          )
        )}
      </div>

      <div>
        {sectionLabel(
          t("Content"),
          // The counterpart of the "installed" row on the other side: one way
          // in, one way back, and neither hidden in a menu. It carries the
          // current kind across, so leaving installed shaders lands on
          // shaders to browse.
          !browsing && (
            <button
              type="button"
              onClick={() => openDiscover(contentCategory)}
              title={t("Find more to install")}
              aria-label={t("Find more to install")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color] duration-150 hover:bg-secondary/60 hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          ),
        )}
        <div {...part("sidebar.content")} ref={contentRef} className="space-y-0.5">
          {/* Folded, the way into Discover cannot hide in the section title. */}
          {collapsed && !browsing && row({
            key: "find",
            label: "Find more to install",
            Icon: Search,
            active: false,
            onClick: () => openDiscover(contentCategory),
          })}
          {/* Two lists, one place. Managing what is installed and browsing for
              more are different jobs, so the whole list changes rather than one
              row being added to it. */}
          {browsing ? (
            <>
              {/* The way back, named for where it goes. On Vanilla there are
                  no mods to go back to, so the row is the first pack instead. */}
              {mod && row({
                key: "installed",
                label: "Installed mods",
                Icon: mod.icon,
                active: false,
                badge: countOf("mod"),
                onClick: () => openInstalled("mod"),
              })}
              {mod && row({
                key: "discover-mod",
                label: "Discover",
                Icon: Search,
                active: contentCategory === "mod",
                onClick: () => openDiscover("mod"),
              })}
              {otherCategories.map((category) =>
                row({
                  key: `discover-${category.id}`,
                  label: category.label,
                  Icon: category.icon,
                  active: contentCategory === category.id,
                  onClick: () => openDiscover(category.id),
                }),
              )}
            </>
          ) : (
            categories.map((category) =>
              row({
                key: category.id,
                label: category.label,
                Icon: category.icon,
                active: activeTab === "mods" && contentCategory === category.id,
                badge: countOf(category.id),
                onClick: () => openInstalled(category.id),
              }),
            )
          )}
        </div>
      </div>

      <div className="mt-auto">
        {sectionLabel(t("Instance"))}
        <div {...part("sidebar.instance-pages")} className="space-y-0.5">
          {plainRow("worlds", "Worlds & backups", Globe2)}
          {plainRow("profiles", "Profiles", Box)}
          {plainRow("settings", "Settings", Settings2)}
          {plainRow("logs", "Activity & logs", ScrollText)}
        </div>
      </div>
    </aside>
  );
}
