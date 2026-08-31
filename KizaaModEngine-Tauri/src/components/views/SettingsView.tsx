import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CloudDownload,
  Gamepad2,
  Globe,
  HardDrive,
  Info,
  Sparkles,
  Palette,
  Search,
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
import { IS_MAKER } from "../../lib/edition";
import { MakerSettingsHost } from "../maker/MakerHost";
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
  | "maker"
  | "about";

interface Tab {
  id: SettingsTab;
  label: string;
  icon: typeof ShieldCheck;
  /** Words someone might type looking for this page, beyond its own label. */
  finds: string[];
}

/**
 * Eleven pages, in four groups.
 *
 * The groups are not decoration: eleven flat entries is past the point where a
 * list is scanned rather than read, and the headings say which of four
 * questions a page answers — how the launcher behaves, how the game runs, who
 * you are, and where to go when something is wrong.
 */
const groups: Array<{ title: string; tabs: Tab[] }> = [
  {
    title: "Launcher",
    tabs: [
      {
        id: "system",
        label: "General",
        icon: ShieldCheck,
        finds: ["startup", "window", "tray", "crash", "discord", "update", "channel"],
      },
      {
        id: "customisation",
        label: "Appearance",
        icon: Palette,
        finds: ["theme", "dark", "light", "colour", "color", "density", "text size", "animation"],
      },
      {
        id: "language",
        label: "Language and region",
        icon: Globe,
        finds: ["language", "french", "date", "clock", "time", "format"],
      },
    ],
  },
  {
    title: "Game",
    tabs: [
      {
        id: "minecraft",
        label: "Minecraft and Java",
        icon: Gamepad2,
        finds: ["java", "runtime", "version", "snapshot", "memory", "ram", "performance"],
      },
      {
        id: "downloads",
        label: "Downloads",
        icon: CloudDownload,
        finds: ["download", "speed", "concurrent", "bandwidth", "queue"],
      },
      {
        id: "storage",
        label: "Storage",
        icon: HardDrive,
        finds: ["storage", "disk", "space", "cache", "clear", "free", "folder"],
      },
    ],
  },
  {
    title: "Account and services",
    tabs: [
      {
        id: "accounts",
        label: "Accounts",
        icon: Users,
        finds: ["account", "microsoft", "login", "offline", "profile", "skin"],
      },
      {
        id: "apis",
        label: "Connections",
        icon: PlugZap,
        finds: ["modrinth", "curseforge", "api", "service", "network", "status", "discord", "latency", "ping", "reachable"],
      },
    ],
  },
  {
    title: "Support",
    tabs: [
      {
        id: "notifications",
        label: "Notifications",
        icon: Bell,
        finds: ["notification", "windows", "alert", "background", "sound", "quiet", "disturb", "toast", "chime"],
      },
      {
        id: "maker",
        label: "Kiza Maker",
        icon: Sparkles,
        finds: ["maker", "theme", "design", "editor", "colour", "color", "brand"],
      },
      {
        id: "advanced",
        label: "Advanced",
        icon: SlidersHorizontal,
        finds: ["logs", "diagnostic", "reset", "debug", "problem", "maintenance", "cache", "report", "rebuild"],
      },
      {
        id: "about",
        label: "About",
        icon: Info,
        finds: ["version", "update", "licence", "license", "credits", "github"],
      },
    ],
  },
];

/**
 * Every page, minus the ones this edition has no business showing.
 *
 * The Maker page exists in one edition. `IS_MAKER` is a literal after bundling,
 * so in Stable this filter removes a page that was never going to be reachable
 * and the bundler drops the component behind it.
 */
const visibleGroups: Array<{ title: string; tabs: Tab[] }> = groups
  .map((group) => ({
    ...group,
    tabs: group.tabs.filter((tab) => tab.id !== "maker" || IS_MAKER),
  }))
  .filter((group) => group.tabs.length > 0);

const allTabs: Tab[] = visibleGroups.flatMap((group) => group.tabs);

/**
 * Which pages match what was typed.
 *
 * Matched against the label and a short list of words per page rather than
 * against every string on every screen: a search that returns ten pages for
 * "colour" has not helped anyone. Accents are stripped so "reglage" finds
 * "réglage".
 */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function matchTabs(query: string, translate: (key: string) => string): SettingsTab[] {
  const needle = normalise(query.trim());
  if (!needle) return allTabs.map((tab) => tab.id);

  return allTabs
    .filter((tab) => {
      const haystack = [tab.label, translate(tab.label), ...tab.finds].map(normalise);
      return haystack.some((word) => word.includes(needle));
    })
    .map((tab) => tab.id);
}

/**
 * Every page is a component of its own; this only decides which one shows.
 *
 * A page may render nothing: the Maker page is a component in every edition and
 * an empty one in all but the Maker, which is how its code stays out of the
 * other bundles.
 */
const PAGES: Record<SettingsTab, () => React.ReactElement | null> = {
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
  maker: MakerSettingsHost,
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

  const [query, setQuery] = useState("");
  const matches = useMemo(() => matchTabs(query, t), [query, t]);

  // Typing until one page is left should land on it, rather than leaving the
  // reader looking at a single result they still have to click.
  useEffect(() => {
    if (query && matches.length === 1 && matches[0] !== activeTab) {
      setActiveTab(matches[0]);
    }
  }, [query, matches, activeTab]);

  /**
   * Every page opens at its top.
   *
   * The panel is one scrolling element that all eleven pages are drawn into, so
   * its scroll position survived the switch: leaving Storage halfway down and
   * opening Minecraft and Java landed you halfway down that one too — and since
   * it is shorter, often at the very bottom, where the wheel does nothing at
   * all. It reads as a broken scrollbar rather than as a position nobody reset.
   */
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

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
          <aside className="border-b border-border/70 bg-secondary/10 p-3 md:flex md:min-h-0 md:flex-col md:border-b-0 md:border-r">
            <div className="relative mb-3 shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Search a setting...")}
                aria-label={t("Search a setting...")}
                className="h-9 w-full rounded-md border border-border/60 bg-background/50 pl-8 pr-2 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/50"
              />
            </div>

            {/* Eleven entries no longer fit a three-column grid on a narrow
                window, so the list scrolls on its own rather than pushing the
                page. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:min-h-0 md:flex-1 md:grid-cols-1 md:overflow-y-auto md:pr-1">
              {visibleGroups.map((group) => {
                const visible = group.tabs.filter((tab) => matches.includes(tab.id));
                if (visible.length === 0) return null;

                return (
                  <div key={group.title} className="contents md:block">
                    {/* The headings only earn their space when the list is
                        whole; while filtering, four of them for two results
                        would be more furniture than answer. */}
                    {!query && (
                      <div className="col-span-full mb-1 mt-3 hidden px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground first:mt-0 md:block">
                        {t(group.title)}
                      </div>
                    )}
                    {visible.map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={cn(
                            "flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition md:justify-start",
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
                );
              })}

              {matches.length === 0 && (
                <p className="col-span-full px-3 py-6 text-center text-sm text-muted-foreground">
                  {t("No setting matches that.")}
                </p>
              )}
            </div>

            <div className="mt-4 hidden shrink-0 rounded-md border border-border/70 bg-background/40 p-3 text-xs leading-5 text-muted-foreground md:block">
              <div className="mb-1 font-medium text-foreground">{t("Connection health")}</div>
              {loadingConnections
                ? t("Loading...")
                : `${connectionSummary.connected}/${connectionSummary.total} ${t("services ready")}`}
            </div>
          </aside>

          <main ref={panelRef} className="min-h-0 overflow-y-auto p-4 pb-10 sm:p-6">
            <Page />
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
