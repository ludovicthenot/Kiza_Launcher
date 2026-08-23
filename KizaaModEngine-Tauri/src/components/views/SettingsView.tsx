import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CloudDownload,
  Gamepad2,
  Globe,
  HardDrive,
  Info,
  Palette,
  PlugZap,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useAppStore } from "../../lib/store";
import { useApiConnections } from "../../lib/queries";
import { cn } from "../../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useI18n } from "../../lib/i18n";
import { AboutSettings } from "../settings/AboutSettings";
import { AccountSettings } from "../settings/AccountSettings";
import { AdvancedSettings } from "../settings/AdvancedSettings";
import { AppearanceSettings } from "../settings/AppearanceSettings";
import { ConnectionSettings } from "../settings/ConnectionSettings";
import { DownloadSettings } from "../settings/DownloadSettings";
import { GeneralSettings } from "../settings/GeneralSettings";
import { LanguageSettings } from "../settings/LanguageSettings";
import { MinecraftSettings } from "../settings/MinecraftSettings";
import { NotificationSettings } from "../settings/NotificationSettings";
import { StorageSettings } from "../settings/StorageSettings";

type SettingsTab =
  | "system"
  | "customisation"
  | "language"
  | "minecraft"
  | "downloads"
  | "storage"
  | "accounts"
  | "apis"
  | "notifications"
  | "advanced"
  | "about";

/**
 * The order is the order someone looks for things in: how the launcher behaves,
 * how it looks, what language it speaks, then the game, then the plumbing, and
 * finally what this even is.
 */
const tabs: Array<{ id: SettingsTab; label: string; icon: typeof ShieldCheck }> = [
  { id: "system", label: "General", icon: ShieldCheck },
  { id: "customisation", label: "Appearance", icon: Palette },
  { id: "language", label: "Language and region", icon: Globe },
  { id: "minecraft", label: "Minecraft and Java", icon: Gamepad2 },
  { id: "downloads", label: "Downloads", icon: CloudDownload },
  { id: "storage", label: "Storage", icon: HardDrive },
  { id: "accounts", label: "Accounts", icon: Users },
  { id: "apis", label: "Connections", icon: PlugZap },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
  { id: "about", label: "About", icon: Info },
];

/** Every page is a component of its own; this only decides which one shows. */
const PAGES: Record<SettingsTab, () => React.ReactElement> = {
  system: GeneralSettings,
  customisation: AppearanceSettings,
  language: LanguageSettings,
  minecraft: MinecraftSettings,
  downloads: DownloadSettings,
  storage: StorageSettings,
  accounts: AccountSettings,
  apis: ConnectionSettings,
  notifications: NotificationSettings,
  advanced: AdvancedSettings,
  about: AboutSettings,
};

export function SettingsView() {
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const { data: connections, isLoading: loadingConnections } = useApiConnections();
  const { t } = useI18n();

  // "Manage accounts" opens straight on the accounts page.
  const requestedTab = useAppStore((state) => state.settingsTab);
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    (requestedTab as SettingsTab | null) ?? "system",
  );
  useEffect(() => {
    if (requestedTab) setActiveTab(requestedTab as SettingsTab);
  }, [requestedTab]);

  const connectionSummary = useMemo(() => {
    const list = connections ?? [];
    const connected = list.filter(
      (item) =>
        item.status === "connected" || item.status === "available" || item.status === "configured",
    ).length;
    return { connected, total: list.length };
  }, [connections]);

  const Page = PAGES[activeTab];

  return (
    <Dialog open onOpenChange={(open) => !open && setShowSettings(false)}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[820px] w-[min(1120px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden rounded-lg border-border/80 bg-background p-0 shadow-2xl">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-xl">{t("Settings")}</DialogTitle>
              <DialogDescription className="truncate">
                {t("Manage Kiza Launcher, your accounts, and Minecraft.")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
          {/* Eleven tabs no longer fit a three-column grid on a narrow window,
              so the list scrolls on its own rather than pushing the page. */}
          <aside className="border-b border-border/70 bg-secondary/10 p-3 md:flex md:min-h-0 md:flex-col md:border-b-0 md:border-r">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:min-h-0 md:flex-1 md:grid-cols-1 md:overflow-y-auto md:pr-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex h-10 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition md:justify-start",
                      activeTab === tab.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t(tab.label)}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 hidden shrink-0 rounded-md border border-border/70 bg-background/40 p-3 text-xs leading-5 text-muted-foreground md:block">
              <div className="mb-1 font-medium text-foreground">{t("Connection health")}</div>
              {loadingConnections
                ? t("Loading...")
                : `${connectionSummary.connected}/${connectionSummary.total} ${t("services ready")}`}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-4 pb-10 sm:p-6">
            <Page />
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
