import { useRef, useState } from "react";
import { ArrowUpDown, Database, Plus, Search } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { part } from "../../lib/theme/parts";
import { useAppStore, type HostTab } from "../../lib/store";
import { Input } from "../ui/primitives";
import { LibraryModeSwitch } from "../common/LibraryModeSwitch";
import { CreatorPage } from "../host/CreatorPage";
import { ManagerPage } from "../host/ManagerPage";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";

/**
 * Host: the servers this launcher runs.
 *
 * Two pages under one header — Creator, where a server is made, and
 * Manager, where the ones made are run — with the same title row as the
 * library so flipping Instances | Host moves nothing else.
 */
export function HostView() {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const tab = useAppStore((state) => state.hostTab);
  const setHostTab = useAppStore((state) => state.setHostTab);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");

  useGSAP(() => {
    if (prefersReducedMotion()) return;
    gsap
      .timeline({ defaults: { ease: "power3.out" } })
      .fromTo('[data-anim="header"]', { y: -16 }, { y: 0, duration: 0.45, clearProps: "transform" })
      .fromTo(
        '[data-anim="creator"], [data-anim="server"]',
        { y: 24, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.45, stagger: 0.06, clearProps: "transform,opacity" },
        "-=0.25",
      )
      .fromTo(
        '[data-anim="preset"]',
        { y: 24, scale: 0.97 },
        { y: 0, scale: 1, duration: 0.45, stagger: 0.06, clearProps: "transform" },
        "-=0.35",
      );
  }, { dependencies: [tab], scope: containerRef });

  const tabs: Array<{ id: HostTab; label: string }> = [
    { id: "creator", label: t("Creator") },
    { id: "manager", label: t("Manager") },
  ];

  return (
    <div
      ref={containerRef}
      className="flex min-w-0 max-w-full flex-1 flex-col overflow-x-hidden overflow-y-auto px-6 py-5 sm:px-8 sm:py-7 xl:px-11 xl:py-9"
    >
      <div
        data-anim="header"
        className="mb-6 flex min-h-[64px] shrink-0 flex-nowrap items-center gap-4 xl:mb-8"
      >
        <div className="flex min-w-0 items-center gap-4">
          <div {...part("host.icon")} className="flex h-12 w-12 shrink-0 items-center justify-center">
            <Database className="h-11 w-11 text-primary" strokeWidth={1.7} />
          </div>
          <div className="min-w-0">
            <h1 {...part("host.title")} className="kiza-heading truncate font-bold tracking-tight">
              {t("Servers")}
            </h1>
            <p {...part("host.subtitle")} className="mt-1 truncate text-base text-muted-foreground">
              {tab === "creator" ? t("Create and manage your Minecraft servers") : t("Manage your Minecraft servers")}
            </p>
          </div>
        </div>

        <div className="mx-auto">
          <LibraryModeSwitch />
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <div role="tablist" aria-label={t("Servers")} {...editable("secondary")} className="kiza-secondary flex h-[54px] items-center gap-1 border p-1">
            {tabs.map((entry) => {
              const active = entry.id === tab;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setHostTab(entry.id)}
                  className={cn(
                    "h-full rounded-[10px] px-6 text-base font-semibold transition-[background-image,color] duration-150",
                    active ? "kiza-action text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
          {tab === "manager" && (
            <>
              <button
                type="button"
                onClick={() => setSearchOpen((open) => !open)}
                {...part("host.search")}
                title={t("Search your servers")}
                aria-label={t("Search your servers")}
                {...editable("secondary")}
                className={cn(
                  "flex h-[54px] w-[58px] items-center justify-center rounded-xl border transition-colors",
                  searchOpen ? "border-primary/50 bg-primary/10 text-primary" : "kiza-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                <Search className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setSortBy((current) => (current === "recent" ? "name" : "recent"))}
                {...part("host.sort")}
                title={sortBy === "recent" ? t("Sorted by newest") : t("Sorted by name")}
                aria-label={t("Change the order")}
                {...editable("secondary")}
                className="kiza-secondary flex h-[54px] w-[68px] items-center justify-center border text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowUpDown className="h-5 w-5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setHostTab("creator")}
            {...part("host.create")}
            {...editable("action")}
            className="inline-flex h-[54px] items-center gap-3 rounded-xl kiza-action px-8 text-base font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
          >
            <Plus className="h-5 w-5" />
            {t("New Server")}
          </button>
        </div>
      </div>

      {tab === "manager" && searchOpen && (
        <div className="mb-5">
          <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search your servers…")} />
        </div>
      )}

      {tab === "creator" ? <CreatorPage /> : <ManagerPage query={query} sortBy={sortBy} />}
    </div>
  );
}
