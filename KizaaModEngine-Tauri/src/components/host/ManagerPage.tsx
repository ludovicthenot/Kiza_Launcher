import { useEffect, useMemo } from "react";
import { Plus, Server } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";
import { useHostedServers } from "../../lib/hostQueries";
import { EmptyState } from "../ui/primitives";
import { ServerCard } from "./ServerCard";
import { ServerDetail } from "./ServerDetail";

/**
 * Servers → Manager: the cards, and the one that is selected underneath.
 *
 * Laid out like the library — a row of cards that wraps, the selection a
 * violet edge, the detail below it — so someone who knows one page knows
 * the other.
 */
export function ManagerPage({ query, sortBy }: { query: string; sortBy: "recent" | "name" }) {
  const { t } = useI18n();
  const { data: servers, isLoading } = useHostedServers();
  const selectedId = useAppStore((state) => state.selectedServerId);
  const setSelectedServerId = useAppStore((state) => state.setSelectedServerId);
  const setHostTab = useAppStore((state) => state.setHostTab);

  const visible = useMemo(() => {
    const sorted = [...(servers ?? [])];
    if (sortBy === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const needle = query.trim().toLowerCase();
    return needle ? sorted.filter((s) => s.name.toLowerCase().includes(needle)) : sorted;
  }, [servers, sortBy, query]);

  const selected = servers?.find((s) => s.id === selectedId) ?? null;

  // A deleted or never-chosen selection falls back to the first card.
  useEffect(() => {
    if (selected || !servers?.length) return;
    setSelectedServerId(servers[0].id);
  }, [selected, servers, setSelectedServerId]);

  if (!isLoading && (servers?.length ?? 0) === 0) {
    return (
      <EmptyState
        icon={Server}
        className="min-h-[360px]"
        title={t("No server yet")}
        description={t("Make one in the Creator: from scratch, from an instance, or from a folder.")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
      >
        {visible.map((server) => (
          <ServerCard key={server.id} server={server} selected={server.id === selectedId} onSelect={() => setSelectedServerId(server.id)} />
        ))}
        <button
          type="button"
          data-anim="server"
          onClick={() => setHostTab("creator")}
          className="kiza-card flex min-h-[220px] flex-col items-center justify-center gap-3 border border-transparent bg-card/40 text-primary transition-[background-color] hover:bg-primary/[0.06]"
        >
          <Plus className="h-9 w-9" strokeWidth={1.6} />
          <span className="text-lg font-medium">{t("New Server")}</span>
        </button>
      </div>
      {query.trim() && visible.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("No server matches that search.")}</p>
      )}
      {selected && <ServerDetail key={selected.id} server={selected} />}
    </div>
  );
}
