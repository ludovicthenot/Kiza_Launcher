import { useMemo, useRef, useState } from "react";
import { Plus, Search, Server } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { part } from "../../lib/theme/parts";
import { MINECRAFT_LOADER_LABELS } from "../../lib/minecraftLoaders";
import { presetById } from "../../lib/serverPresets";
import { isUp, useServerIcon, type HostedServer } from "../../lib/hostQueries";
import { arrivingSideways, gsap, prefersReducedMotion, staggerFor, useGSAP } from "../../lib/animation";
import { PartIcon, PartLabel } from "../common/PartContent";
import { stateLabel, stateTone } from "./format";

/**
 * Servers, as a source list: "New server" pinned on top, then the servers
 * grouped by what they are doing -- the running ones first, since those are
 * the ones a person comes back for. The row chosen is the page beside it.
 */
export function ServerSidebar({
  servers,
  selectedId,
  creating,
  onSelect,
  onCreate,
}: {
  servers: HostedServer[];
  selectedId: string | null;
  creating: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = [...servers]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .filter((server) => !needle || server.name.toLowerCase().includes(needle));
    return [
      { id: "running", title: t("Running"), servers: shown.filter((s) => isUp(s.status.state) || s.status.state === "installing") },
      { id: "stopped", title: t("Stopped"), servers: shown.filter((s) => !isUp(s.status.state) && s.status.state !== "installing") },
    ].filter((group) => group.servers.length > 0);
  }, [servers, query, t]);

  // The rows deal themselves out once, when the page opens.
  useGSAP(
    () => {
      if (prefersReducedMotion() || arrivingSideways()) return;
      const rows = listRef.current?.querySelectorAll("[data-server-row]");
      if (!rows?.length) return;
      gsap.fromTo(
        rows,
        { x: -10, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.36, ease: "power3.out", stagger: staggerFor(rows.length, 0.03), clearProps: "transform,opacity" },
      );
    },
    { scope: listRef },
  );

  return (
    <aside className="flex min-h-0 flex-col gap-3 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-var(--kiza-titlebar,3.5rem)-3rem)]">
      <button
        type="button"
        onClick={onCreate}
        aria-pressed={creating}
        {...part("host.create", { label: true, icon: true })}
        {...editable("action")}
        className={cn(
          "inline-flex h-11 shrink-0 items-center gap-2.5 rounded-xl px-4 text-[0.9375rem] font-semibold transition-[filter,transform,background-color,color] duration-150 active:scale-[0.97]",
          creating
            ? "kiza-action text-primary-foreground shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.8)]"
            : "bg-primary/15 text-primary hover:bg-primary/20",
        )}
      >
        <PartIcon name="host.create" icon={Plus} className="h-[18px] w-[18px]" />
        <PartLabel name="host.create">{t("New Server")}</PartLabel>
      </button>

      {servers.length > 0 && (
        <label className="flex h-9 shrink-0 items-center gap-2 rounded-[10px] bg-secondary/40 px-3 text-sm text-muted-foreground transition-colors focus-within:bg-secondary/60">
          <Search className="h-4 w-4 shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search servers...")}
            aria-label={t("Search servers...")}
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </label>
      )}

      <div ref={listRef} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {groups.map((group) => (
          <section key={group.id} className="mt-3 first:mt-1">
            <h3 className="mb-1 px-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">
              {group.title}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {group.servers.map((server) => (
                <li key={server.id}>
                  <ServerRow server={server} selected={!creating && server.id === selectedId} onSelect={() => onSelect(server.id)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {servers.length === 0 && (
          <p className="px-2.5 pt-2 text-[0.8125rem] leading-relaxed text-muted-foreground">
            {t("No server yet")}. {t("Make one in the Creator: from scratch, from an instance, or from a folder.")}
          </p>
        )}
        {servers.length > 0 && groups.length === 0 && (
          <p className="px-2.5 pt-2 text-[0.8125rem] text-muted-foreground">{t("No server matches that search.")}</p>
        )}
      </div>
    </aside>
  );
}

function ServerRow({ server, selected, onSelect }: { server: HostedServer; selected: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  const { data: icon } = useServerIcon(server.id, server.has_icon);
  const preset = presetById(server.preset);
  const [ground, sky, light] = preset?.scene ?? ["#120a24", "#4c1d95", "#a78bfa"];
  const state = server.status.state;
  const tone = stateTone(state);
  const loader = server.loader === "vanilla" ? "Vanilla" : MINECRAFT_LOADER_LABELS[server.loader];

  return (
    <button
      type="button"
      data-server-row
      aria-current={selected ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2 text-left transition-[background-color,transform] duration-150 active:scale-[0.985]",
        selected ? "bg-white/[0.09] shadow-[inset_0_0.5px_0_hsl(0_0%_100%/0.08)]" : "hover:bg-white/[0.05]",
      )}
    >
      {/* The server's icon, or a swatch of its preset's scene. */}
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[9px] ring-1 ring-white/10"
        style={icon ? undefined : { backgroundImage: `radial-gradient(circle at 70% 25%, ${light}cc, transparent 60%), linear-gradient(160deg, ${sky}, ${ground})` }}
      >
        {icon ? (
          <img src={icon} alt="" className="h-full w-full object-cover [image-rendering:pixelated]" />
        ) : (
          <Server className="h-4 w-4 text-white/85" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[0.875rem] font-medium", selected ? "text-foreground" : "text-foreground/90")}>{server.name}</span>
        <span className="block truncate text-xs tabular-nums text-muted-foreground">
          {server.mc_version} · {loader}
        </span>
      </span>
      <span className="relative flex h-2 w-2 shrink-0" title={t(stateLabel(state))}>
        {state === "online" && (
          <span aria-hidden className="absolute inset-0 rounded-full bg-emerald-400/60 animate-ping [animation-duration:2.4s] motion-reduce:hidden" />
        )}
        <span className={cn("relative h-2 w-2 rounded-full", tone.dot)} />
      </span>
    </button>
  );
}
