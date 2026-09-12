import { useMemo, useRef, useState } from "react";
import { ArrowUpDown, Database, Plus, Search } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { part } from "../../lib/theme/parts";
import { useHostedServers } from "../../lib/queries";
import type { ServerPreset } from "../../lib/serverPresets";
import { Input } from "../ui/primitives";
import { LibraryModeSwitch } from "../common/LibraryModeSwitch";
import { ServerCreatorCard } from "../host/ServerCreatorCard";
import { ServerPresetGrid } from "../host/ServerPresetGrid";
import { HostedServerCard } from "../host/HostedServerCard";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";

/**
 * Host: the servers this launcher runs, and how a new one is made.
 *
 * The creator card on the left is always there; the right column lists the
 * servers already made and, under them, the presets to make one from. On a
 * fresh install the list is empty and the page is the reference layout:
 * the card and the presets, nothing else.
 */
export function HostView() {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const creatorRef = useRef<HTMLDivElement>(null);
  const { data: servers } = useHostedServers();

  const [preset, setPreset] = useState<ServerPreset | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");

  const visibleServers = useMemo(() => {
    const sorted = [...(servers ?? [])];
    if (sortBy === "name") {
      sorted.sort((left, right) => left.name.localeCompare(right.name));
    } else {
      sorted.sort((left, right) => right.created_at.localeCompare(left.created_at));
    }
    const needle = query.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter((server) => server.name.toLowerCase().includes(needle));
  }, [servers, sortBy, query]);

  const focusCreator = () => {
    creatorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    creatorRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  };

  useGSAP(() => {
    if (prefersReducedMotion()) return;
    gsap
      .timeline({ defaults: { ease: "power3.out" } })
      .fromTo('[data-anim="header"]', { y: -16 }, { y: 0, duration: 0.45, clearProps: "transform" })
      .fromTo(
        '[data-anim="creator"]',
        { x: -18, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.5, clearProps: "transform,opacity" },
        "-=0.2",
      )
      .fromTo(
        '[data-anim="preset"]',
        { y: 24, scale: 0.97 },
        { y: 0, scale: 1, duration: 0.45, stagger: 0.06, clearProps: "transform" },
        "-=0.35",
      );
  }, { scope: containerRef });

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
              {t("Create and manage your Minecraft servers")}
            </p>
          </div>
        </div>

        <div className="mx-auto">
          <LibraryModeSwitch />
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <button
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            {...part("host.search")}
            title={t("Search your servers")}
            aria-label={t("Search your servers")}
            {...editable("secondary")}
            className={cn(
              "flex h-[54px] w-[58px] items-center justify-center rounded-xl border transition-colors",
              searchOpen
                ? "border-primary/50 bg-primary/10 text-primary"
                : "kiza-secondary text-muted-foreground hover:text-foreground",
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
          <button
            type="button"
            onClick={focusCreator}
            {...part("host.create")}
            {...editable("action")}
            className="inline-flex h-[54px] items-center gap-3 rounded-xl kiza-action px-8 text-base font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
          >
            <Plus className="h-5 w-5" />
            {t("New Server")}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="mb-5">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search your servers…")}
          />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] xl:gap-8">
        <div data-anim="creator" className="xl:sticky xl:top-0 xl:self-start">
          <ServerCreatorCard ref={creatorRef} preset={preset} />
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          {(servers?.length ?? 0) > 0 && (
            <section>
              <h2 className="text-3xl font-bold tracking-tight">{t("Your servers")}</h2>
              <p className="mb-4 mt-1 text-base text-muted-foreground">
                {visibleServers.length}{" "}
                {visibleServers.length === 1 ? t("server") : t("servers")}
              </p>
              <div className="flex flex-col gap-3">
                {visibleServers.map((server) => (
                  <HostedServerCard key={server.id} server={server} />
                ))}
                {query.trim() && visibleServers.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("No server matches that search.")}
                  </p>
                )}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-3xl font-bold tracking-tight">{t("Choose a preset")}</h2>
            <p className="mb-4 mt-1 text-base text-muted-foreground">
              {t("Start with a template and get the perfect setup for your server.")}
            </p>
            <ServerPresetGrid
              selectedId={preset?.id ?? null}
              onPick={(picked) => {
                setPreset(picked);
                focusCreator();
              }}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
