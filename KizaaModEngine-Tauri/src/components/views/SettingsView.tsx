import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Gamepad2,
  HardDrive,
  Info,
  Sparkles,
  Palette,
  Search,
  ShieldCheck,
  Shirt,
  SlidersHorizontal,
  Users,
  Wrench,
} from "lucide-react";
import { useAppStore } from "../../lib/store";
import { useMinecraftAccount } from "../../lib/queries";
import { SkinHead } from "../common/SkinHead";
import { cn } from "../../lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
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
import { SkinSettings } from "../settings/SkinSettings";
import { StorageSettings } from "../settings/StorageSettings";
import { part } from "../../lib/theme/parts";

type SettingsTab =
  | "system"
  | "customisation"
  | "notifications"
  | "minecraft"
  | "downloads"
  | "accounts"
  | "skins"
  | "advanced"
  | "maker"
  | "about";

/**
 * Pages that were merged into another, and where a link to them now lands.
 * Deep links from elsewhere (the tray, the account menu, older code) keep
 * working without knowing the sidebar changed.
 */
const MERGED: Record<string, SettingsTab> = {
  language: "system",
  storage: "downloads",
  apis: "advanced",
};

function landing(requested: string | null): SettingsTab | null {
  if (!requested) return null;
  return (MERGED[requested] ?? requested) as SettingsTab;
}

interface Tab {
  id: SettingsTab;
  label: string;
  icon: typeof ShieldCheck;
  /** The tile behind the icon, as on the system's own settings. */
  tile: string;
  /** Words someone might type looking for this page, beyond its own label. */
  finds: string[];
}

/**
 * Nine pages, in four groups set apart by space rather than headings.
 *
 * There were twelve. Language sat on its own page for three rows, Storage
 * and Downloads answered one question -- what the launcher puts on your disk
 * -- from two places, and the service status was a diagnostic, not a
 * setting. Each joined the page it belongs with; the old names still find
 * them and old links still land on them.
 */
const groups: Array<{ title: string; tabs: Tab[] }> = [
  {
    title: "Launcher",
    tabs: [
      {
        id: "system",
        label: "General",
        icon: SlidersHorizontal,
        tile: "bg-zinc-500",
        finds: ["startup", "window", "tray", "crash", "discord", "update", "channel", "language", "french", "date", "clock", "time", "format", "region", "langue"],
      },
      {
        id: "customisation",
        label: "Appearance",
        icon: Palette,
        tile: "bg-gradient-to-br from-fuchsia-500 to-indigo-500",
        finds: ["theme", "dark", "light", "colour", "color", "density", "text size", "animation"],
      },
      {
        id: "notifications",
        label: "Notifications",
        icon: Bell,
        tile: "bg-rose-500",
        finds: ["notification", "windows", "alert", "background", "sound", "quiet", "disturb", "toast", "chime"],
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
        tile: "bg-emerald-600",
        finds: ["java", "runtime", "version", "snapshot", "memory", "ram", "performance"],
      },
      {
        id: "downloads",
        label: "Downloads and storage",
        icon: HardDrive,
        tile: "bg-sky-500",
        finds: ["download", "speed", "concurrent", "bandwidth", "queue", "storage", "disk", "space", "cache", "clear", "free", "folder", "stockage", "telechargements"],
      },
    ],
  },
  {
    title: "Account",
    tabs: [
      {
        id: "accounts",
        label: "Accounts",
        icon: Users,
        tile: "bg-blue-500",
        finds: ["account", "microsoft", "login", "offline", "profile"],
      },
      {
        id: "skins",
        label: "Skins",
        icon: Shirt,
        tile: "bg-orange-500",
        finds: ["skin", "cape", "avatar", "character", "slim", "classic", "png", "apparence"],
      },
    ],
  },
  {
    title: "Support",
    tabs: [
      {
        id: "advanced",
        label: "Advanced",
        icon: Wrench,
        tile: "bg-slate-500",
        finds: ["logs", "diagnostic", "reset", "debug", "problem", "maintenance", "cache", "report", "rebuild", "modrinth", "curseforge", "api", "service", "network", "status", "latency", "ping", "reachable", "connections", "connexions"],
      },
      {
        id: "maker",
        label: "Kiza Maker",
        icon: Sparkles,
        tile: "bg-pink-500",
        finds: ["maker", "theme", "design", "editor", "colour", "color", "brand"],
      },
      {
        id: "about",
        label: "About",
        icon: Info,
        tile: "bg-violet-500",
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
    .replace(/[\u0300-\u036f]/g, "");
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

/** Two pages that answer one question, one above the other. */
function Stacked(...pages: Array<() => React.ReactElement | null>) {
  return function StackedPage() {
    return (
      <div className="space-y-8">
        {pages.map((Page, index) => (
          <Page key={index} />
        ))}
      </div>
    );
  };
}

/**
 * Every page is a component of its own; this only decides which one shows.
 *
 * A page may render nothing: the Maker page is a component in every edition and
 * an empty one in all but the Maker, which is how its code stays out of the
 * other bundles.
 */
const PAGES: Record<SettingsTab, () => React.ReactElement | null> = {
  system: Stacked(GeneralSettings, LanguageSettings),
  customisation: AppearanceSettings,
  notifications: NotificationSettings,
  minecraft: MinecraftSettings,
  downloads: Stacked(DownloadSettings, StorageSettings),
  accounts: AccountSettings,
  skins: SkinSettings,
  advanced: Stacked(AdvancedSettings, ConnectionSettings),
  maker: MakerSettingsHost,
  about: AboutSettings,
};

export function SettingsView() {
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const { data: account } = useMinecraftAccount();
  const { t } = useI18n();

  // "Manage accounts" opens straight on the accounts page.
  const requestedTab = useAppStore((state) => state.settingsTab);
  const [activeTab, setActiveTab] = useState<SettingsTab>(landing(requestedTab) ?? "system");
  useEffect(() => {
    const wanted = landing(requestedTab);
    if (wanted) setActiveTab(wanted);
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
   * The panel is one scrolling element that every page is drawn into, so its
   * scroll position survived the switch: leaving one page halfway down landed
   * you halfway down the next, or at its very bottom.
   */
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  const Page = PAGES[activeTab];
  const current = allTabs.find((tab) => tab.id === activeTab);

  return (
    <Dialog open onOpenChange={(open) => !open && setShowSettings(false)}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[820px] w-[min(1080px,calc(100vw-24px))] max-w-none flex-row gap-0 overflow-hidden rounded-2xl border-0 bg-background p-0 [&>button:last-child]:z-20 [&>button:last-child]:rounded-full [&>button:last-child]:bg-secondary/70 [&>button:last-child]:p-1.5 [&>button:last-child]:opacity-100 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.09),0_30px_80px_hsl(242_30%_2%/0.7)]">
        {/* Said to screen readers; the page title below says it to the eye. */}
        <DialogTitle className="sr-only">{t("Settings")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("Manage Kiza Launcher, your accounts, and Minecraft.")}
        </DialogDescription>

        <aside {...part("settings.sidebar")} className="hidden w-[250px] shrink-0 flex-col bg-secondary/[0.22] px-3 pb-3 pt-4 md:flex">
          <div className="relative mb-3 shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search")}
              aria-label={t("Search a setting...")}
              className="h-8 w-full rounded-[9px] bg-secondary/70 pl-8 pr-2 text-[0.8125rem] outline-none transition-[box-shadow,background-color] duration-150 placeholder:text-muted-foreground focus:bg-secondary focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.3)]"
            />
          </div>

          {/* Who is signed in, first: the way into the account it describes. */}
          {!query && (
            <button
              type="button"
              onClick={() => setActiveTab("accounts")}
              className={cn(
                "mb-3 flex shrink-0 items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors duration-150",
                activeTab === "accounts" ? "bg-secondary/80" : "hover:bg-secondary/50",
              )}
            >
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-secondary">
                {account ? (
                  <SkinHead url={account.skin_head_url} className="h-full w-full" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <Users className="h-5 w-5" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[0.8438rem] font-semibold">
                  {account?.username ?? t("Not signed in")}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {account ? t("Minecraft account") : t("Sign in to play online")}
                </div>
              </div>
            </button>
          )}

          <nav className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            {visibleGroups.map((group) => {
              const visible = group.tabs.filter((tab) => matches.includes(tab.id));
              if (visible.length === 0) return null;
              return (
                <div key={group.title} className="mb-3 space-y-px">
                  {visible.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2 text-left text-[0.8438rem] transition-colors duration-100",
                          active ? "bg-primary text-primary-foreground" : "text-foreground/90 hover:bg-secondary/55",
                        )}
                      >
                        <span className={cn("flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-white shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.15)]", tab.tile)}>
                          <Icon className="h-[13px] w-[13px]" strokeWidth={2.4} />
                        </span>
                        <span className="truncate">{t(tab.label)}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {matches.length === 0 && (
              <p className="px-2 py-6 text-center text-[0.8125rem] text-muted-foreground">
                {t("No setting matches that.")}
              </p>
            )}
          </nav>
        </aside>

        <main ref={panelRef} className="min-w-0 flex-1 overflow-y-auto">
          {/* The page's name, over a bar that frosts what scrolls under it. */}
          <div className="sticky top-0 z-10 bg-background/80 px-8 pb-3 pt-5 backdrop-blur-xl">
            <h2 {...part("settings.title")} className="text-[1.375rem] font-bold tracking-[-0.02em]">{current ? t(current.label) : ""}</h2>
          </div>
          {/* Narrow tabs for a narrow window, where the sidebar is hidden. */}
          <div className="flex gap-1 overflow-x-auto px-6 pb-2 md:hidden">
            {allTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium",
                  activeTab === tab.id ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-foreground/80",
                )}
              >
                {t(tab.label)}
              </button>
            ))}
          </div>
          <div className="mx-auto max-w-[760px] px-8 pb-12 pt-2">
            <Page />
          </div>
        </main>
      </DialogContent>
    </Dialog>
  );
}
