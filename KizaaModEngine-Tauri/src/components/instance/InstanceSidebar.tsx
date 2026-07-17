import { ActiveTab, useAppStore } from "../../lib/store";
import { Package, ShieldAlert, FileJson, Activity, Download, Search, Sparkles, Wrench } from "lucide-react";
import { cn } from "../../lib/utils";
import { useDownloads } from "../../lib/queries";

export function InstanceSidebar() {
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const { data: downloads } = useDownloads();

  const activeDownloads = downloads?.filter(d => d.state === "Downloading" || d.state === "Queued" || d.state === "Resolving").length || 0;

  type TabItem = {
    id: ActiveTab;
    label: string;
    icon: typeof Package;
    badge?: number;
  };

  const primaryTabs: TabItem[] = [
    { id: 'mods', label: 'Installed mods', icon: Package },
    { id: 'discover', label: 'Discover mods', icon: Search },
    { id: 'shaders', label: 'Shaders', icon: Sparkles },
    { id: 'profiles', label: 'Profiles', icon: FileJson },
    { id: 'downloads', label: 'Downloads', icon: Download, badge: activeDownloads > 0 ? activeDownloads : undefined },
  ];

  const maintenanceTabs: TabItem[] = [
    { id: 'conflicts', label: 'Conflicts', icon: ShieldAlert },
    { id: 'health', label: 'Instance health', icon: Activity },
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
        <span className="flex-1 truncate text-left">{tab.label}</span>
        {tab.badge !== undefined && (
          <span className="min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-bold text-primary-foreground">
            {tab.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className="flex w-64 flex-col gap-4 border-r border-border/50 bg-card p-3">
      <div className="space-y-1">
        {primaryTabs.map(renderTab)}
      </div>

      <div className="mt-auto border-t border-border/60 pt-3">
        <div className="mb-2 flex items-center gap-2 px-3 text-xs font-medium uppercase tracking-normal text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" />
          Maintenance
        </div>
        <div className="space-y-1">
          {maintenanceTabs.map(renderTab)}
        </div>
      </div>
    </aside>
  );
}

