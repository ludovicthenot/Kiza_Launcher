import { ActiveTab, useAppStore } from "../../lib/store";
import { Package, FileJson, ScrollText, ChevronDown, Search, Settings2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { CONTENT_CATEGORIES } from "./content/contentCategories";

export function InstanceSidebar() {
  const { t } = useI18n();
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const contentCategory = useAppStore((state) => state.contentCategory);
  const setContentCategory = useAppStore((state) => state.setContentCategory);
  const searchExpanded = activeTab === "discover";

  type TabItem = {
    id: ActiveTab;
    label: string;
    icon: typeof Package;
    badge?: number;
  };

  const primaryTabs: TabItem[] = [
    { id: 'mods', label: 'Installed content', icon: Package },
    { id: 'profiles', label: 'Profiles', icon: FileJson },
  ];

  const instanceTabs: TabItem[] = [
    { id: 'settings', label: 'Manage instance', icon: Settings2 },
    { id: 'logs', label: 'Activity & logs', icon: ScrollText },
  ];

  const renderTab = (tab: TabItem) => {
    const Icon = tab.icon;
    const isActive = activeTab === tab.id;
    return (
      <button
        key={tab.id}
        onClick={() => setActiveTab(tab.id)}
        className={cn(
          "relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 truncate text-left">{t(tab.label)}</span>
        {tab.badge !== undefined && (
          <span className="min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-bold text-primary-foreground">
            {tab.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className="flex w-52 shrink-0 flex-col gap-4 border-r border-border/50 bg-card p-3 xl:w-64">
      <div className="space-y-1">
        {renderTab(primaryTabs[0])}

        <div>
          <button
            type="button"
            onClick={() => setActiveTab("discover")}
            aria-expanded={searchExpanded}
            className={cn(
              "relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition",
              activeTab === "discover"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
            )}
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 truncate text-left">{t("Search content")}</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", searchExpanded && "rotate-180")} />
          </button>

          {searchExpanded && (
            <div className="mt-1 space-y-0.5 pl-6">
              {CONTENT_CATEGORIES.map((category) => {
                const Icon = category.icon;
                const active = activeTab === "discover" && contentCategory === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => {
                      setContentCategory(category.id);
                      setActiveTab("discover");
                    }}
                    className={cn(
                      "flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-3 text-sm transition",
                      active
                        ? "bg-secondary/70 font-medium text-foreground"
                        : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", active && "text-primary")} />
                    <span className="truncate">{t(category.label)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {renderTab(primaryTabs[1])}
      </div>

      <div className="mt-auto border-t border-border/60 pt-3">
        <div className="mb-2 flex items-center gap-2 px-3 text-xs font-medium uppercase tracking-normal text-muted-foreground">
          <Settings2 className="h-3.5 w-3.5" />
          {t("Instance")}
        </div>
        <div className="space-y-1">
          {instanceTabs.map(renderTab)}
        </div>
      </div>
    </aside>
  );
}
