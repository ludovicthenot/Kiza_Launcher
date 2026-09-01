import { useRef } from "react";
import { ArrowLeft, Box, Globe2, ScrollText, Search, Settings2 } from "lucide-react";
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
import { CONTENT_CATEGORIES } from "./content/contentCategories";

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
 */
export function InstanceSidebar() {
  const { t } = useI18n();
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const contentCategory = useAppStore((state) => state.contentCategory);
  const setContentCategory = useAppStore((state) => state.setContentCategory);
  const selectedInstanceId = useAppStore((state) => state.selectedInstanceId);
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);

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
      className={cn(
        "kiza-nav relative flex h-11 w-full items-center gap-3 px-3 text-sm font-medium transition",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary"
        />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate text-left">{t(label)}</span>
      {badge !== undefined && (
        <span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {badge}
        </span>
      )}
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

  const categories = CONTENT_CATEGORIES.filter((category) => category.id !== "modpack");
  const [mod, ...otherCategories] = categories;

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

  return (
    <aside className="kiza-sidebar flex w-[280px] shrink-0 flex-col gap-5 border-r p-3 xl:w-[300px]">
      <button
        type="button"
        onClick={() => setSelectedInstanceId(null)}
        className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("All instances")}
      </button>

      <div className="flex items-center gap-3 px-1">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-border/70 bg-secondary/40">
          {cover ? (
            <img src={cover.uri} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Box className="h-6 w-6 text-primary" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-base font-bold">{instance?.display_name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {instance?.minecraft?.mc_version}
            {loaderLabel && ` • ${loaderLabel}`}
          </div>
          <div
            className={cn(
              "mt-1 inline-flex items-center gap-1.5 text-xs",
              ready ? "text-emerald-400" : "text-amber-400",
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", ready ? "bg-emerald-400" : "bg-amber-400")}
            />
            {ready ? t("Instance ready") : t("Needs attention")}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          <span className="flex-1 truncate">{t("Content")}</span>
          {/* The counterpart of the "installed" row on the other side: one way
              in, one way back, and neither hidden in a menu. It carries the
              current kind across, so leaving installed shaders lands on
              shaders to browse. */}
          {!browsing && (
            <button
              type="button"
              onClick={() => openDiscover(contentCategory)}
              title={t("Find more to install")}
              aria-label={t("Find more to install")}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div ref={contentRef} className="space-y-0.5">
          {/* Two lists, one place. Managing what is installed and browsing for
              more are different jobs, so the whole list changes rather than one
              row being added to it. */}
          {browsing ? (
            <>
              {/* The way back, named for where it goes. */}
              {row({
                key: "installed",
                label: "Installed mods",
                Icon: mod.icon,
                active: false,
                badge: countOf("mod"),
                onClick: () => openInstalled("mod"),
              })}
              {row({
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
        <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {t("Instance")}
        </div>
        <div className="space-y-0.5">
          {plainRow("worlds", "Worlds & backups", Globe2)}
          {plainRow("profiles", "Profiles", Box)}
          {plainRow("settings", "Settings", Settings2)}
          {plainRow("logs", "Activity & logs", ScrollText)}
        </div>
      </div>
    </aside>
  );
}
