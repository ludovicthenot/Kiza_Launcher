import { useEffect, useRef } from "react";
import { Database, Server } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { part } from "../../lib/theme/parts";
import { useAppStore } from "../../lib/store";
import { updateDiscordStatus } from "../../lib/queries";
import { useHostedServers } from "../../lib/hostQueries";
import { LibraryModeSwitch } from "../common/LibraryModeSwitch";
import { usePageShown } from "../common/FrontPages";
import { CreatorPage } from "../host/CreatorPage";
import { ServerDetail } from "../host/ServerDetail";
import { ServerSidebar } from "../host/ServerSidebar";
import { EmptyState } from "../ui/primitives";
import { arrivingSideways, gsap, useGSAP, prefersReducedMotion, useSwapIn } from "../../lib/animation";
import { PartIcon, PartLabel } from "../common/PartContent";

/**
 * Host: the servers this launcher runs, as a source list and its page.
 *
 * The servers on the left -- "New server" pinned above them -- and on the
 * right whatever is chosen there: a server with its controls and tabs, or
 * the Creator. Making and running are one place rather than two tabs, so a
 * server just made is already selected beside the button that made it.
 * The title row is the library's, so flipping Instances | Host moves
 * nothing else.
 */
export function HostView() {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const tab = useAppStore((state) => state.hostTab);
  const setHostTab = useAppStore((state) => state.setHostTab);
  const selectedId = useAppStore((state) => state.selectedServerId);
  const setSelectedServerId = useAppStore((state) => state.setSelectedServerId);
  const { data: servers, isLoading } = useHostedServers(usePageShown());

  const selected = servers?.find((server) => server.id === selectedId) ?? null;
  const creating = tab === "creator" || (!isLoading && (servers?.length ?? 0) === 0);

  // "Managing Minecraft servers" -- unless one is up, in which case the
  // backend keeps announcing that server instead.
  useEffect(() => {
    updateDiscordStatus(null, "managing_servers");
  }, []);

  // A deleted or never-chosen selection falls back to the newest server.
  useEffect(() => {
    if (selected || !servers?.length) return;
    const newest = [...servers].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    setSelectedServerId(newest.id);
  }, [selected, servers, setSelectedServerId]);

  useGSAP(() => {
    if (prefersReducedMotion() || arrivingSideways()) return;
    gsap.fromTo('[data-anim="header"]', { y: -16 }, { y: 0, duration: 0.45, ease: "power3.out", clearProps: "transform" });
  }, { scope: containerRef });

  // The page beside the list changes in place: it rises into view.
  useSwapIn(paneRef, creating ? "creator" : selected?.id);

  return (
    <div
      ref={containerRef}
      className="flex min-w-0 max-w-full flex-1 flex-col kiza-under-bar overflow-x-hidden overflow-y-auto px-6 pb-5 sm:px-8 sm:pb-7 sm:[--kiza-under-bar-gap:1.75rem] xl:px-11 xl:pb-9 xl:[--kiza-under-bar-gap:2.25rem]"
    >
      <div data-anim="header" className="mb-6 shrink-0 xl:mb-8">
        <div className="flex min-w-0 items-center gap-4">
          <div {...part("host.icon", { icon: true })} className="flex h-12 w-12 shrink-0 items-center justify-center">
            <PartIcon name="host.icon" icon={Database} className="h-11 w-11 text-primary" strokeWidth={1.7} />
          </div>
          <div className="min-w-0">
            <h1 {...part("host.title", { label: true })} className="kiza-heading truncate font-bold tracking-tight">
              <PartLabel name="host.title">{t("Servers")}</PartLabel>
            </h1>
            <p {...part("host.subtitle")} className="mt-1 truncate text-base text-muted-foreground">
              {t("Create and manage your Minecraft servers")}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <LibraryModeSwitch />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 items-start gap-6 lg:grid-cols-[264px_minmax(0,1fr)] xl:gap-8">
        <ServerSidebar
          servers={servers ?? []}
          selectedId={selectedId}
          creating={creating}
          onSelect={(id) => setSelectedServerId(id)}
          onCreate={() => setHostTab("creator")}
        />

        <div ref={paneRef} className="min-w-0">
          {creating ? (
            <CreatorPage />
          ) : selected ? (
            <ServerDetail key={selected.id} server={selected} />
          ) : (
            <EmptyState
              icon={Server}
              className="min-h-[360px]"
              title={t("No server yet")}
              description={t("Make one in the Creator: from scratch, from an instance, or from a folder.")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
