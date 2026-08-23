import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Globe,
  Loader2,
  Play,
  Plus,
  Download,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Signal,
  SignalZero,
  Trash2,
  Users,
} from "lucide-react";
import {
  SavedServer,
  ServerStatus,
  useAddServer,
  useBindServerInstance,
  useImportServersFromInstance,
  useInstances,
  useJoinServer,
  usePingAllServers,
  useRemoveServer,
  useServerHub,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";
import { Button, EmptyState, Input, Panel } from "../ui/primitives";
import { LauncherOptionPicker } from "../ui/launcher-option-picker";
import { cn } from "../../lib/utils";

type Entry = { status: ServerStatus | null; error: string | null };

/**
 * A stable hue for a server, derived from its address.
 *
 * Servers do not publish artwork — the protocol carries a 64×64 icon and
 * nothing else. Rather than invent a banner that pretends to be theirs, each
 * card gets a colour that is always the same for the same address, so a server
 * stays recognisable in the grid.
 */
function hueOf(address: string): number {
  let hash = 0;
  for (let index = 0; index < address.length; index += 1) {
    hash = (hash * 31 + address.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

function ServerBanner({ server, status }: { server: SavedServer; status: ServerStatus | null }) {
  const hue = hueOf(server.address);

  return (
    <div
      className="relative h-36 overflow-hidden"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 55% 22%), hsl(${(hue + 45) % 360} 60% 12%))`,
      }}
    >
      {/* The server's own icon, blown up and blurred, is the only imagery that
          genuinely belongs to it. */}
      {status?.favicon && (
        <img
          src={status.favicon}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-150 object-cover opacity-40 blur-2xl"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />

      {status && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm">
          <Signal className="h-3 w-3 text-emerald-400" />
          {status.latency_ms} ms
          <span className="text-white/40">·</span>
          {status.version}
        </div>
      )}

      <div className="absolute inset-x-4 bottom-3">
        <p className="line-clamp-2 text-sm leading-snug text-white/90 drop-shadow">
          {status?.motd || server.address}
        </p>
      </div>
    </div>
  );
}

/**
 * Saved servers as a browsable grid, the way a player expects to pick one.
 *
 * Every card reaches the same place in one click: the Play button launches the
 * instance the server is bound to. Without a binding there is nothing sensible
 * to launch, so the card asks for one instead of guessing.
 */
export function ServerHubView() {
  const { t } = useI18n();
  const setShowServerHub = useAppStore((state) => state.setShowServerHub);
  const { data: servers, isLoading } = useServerHub();
  const { data: instances } = useInstances();
  const addServer = useAddServer();
  const removeServer = useRemoveServer();
  const bindInstance = useBindServerInstance();
  const pingAll = usePingAllServers();
  const importServers = useImportServersFromInstance();
  const join = useJoinServer();

  const pendingJoinAddress = useAppStore((state) => state.pendingJoinAddress);
  const setPendingJoinAddress = useAppStore((state) => state.setPendingJoinAddress);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [query, setQuery] = useState("");
  const [openSettings, setOpenSettings] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});

  // A kiza:// link fills the form in and stops there. It is a suggestion from
  // a web page, so the player is the one who decides to save it and play.
  useEffect(() => {
    if (!pendingJoinAddress) return;
    const known = (servers ?? []).find((server) => server.address === pendingJoinAddress);
    if (known) {
      setQuery(pendingJoinAddress);
      setOpenSettings(known.id);
    } else {
      setAddress(pendingJoinAddress);
      setShowAdd(true);
    }
    setPendingJoinAddress(null);
  }, [pendingJoinAddress, servers, setPendingJoinAddress]);

  const minecraftInstances = (instances ?? []).filter(
    (instance) => instance.game_id === "minecraft",
  );

  const refreshAll = pingAll.mutate;
  const serverCount = servers?.length ?? 0;

  // Fill the grid as soon as there is something to fill it with, and again
  // whenever a server is added or removed.
  useEffect(() => {
    if (serverCount === 0) return;
    refreshAll(undefined, {
      onSuccess: (results) => {
        setEntries(
          Object.fromEntries(
            results.map((result) => [result.id, { status: result.status, error: result.error }]),
          ),
        );
      },
    });
  }, [refreshAll, serverCount]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return servers ?? [];
    return (servers ?? []).filter(
      (server) =>
        server.name.toLowerCase().includes(needle) ||
        server.address.toLowerCase().includes(needle),
    );
  }, [servers, query]);

  const totalOnline = Object.values(entries).reduce(
    (sum, entry) => sum + (entry.status?.players_online ?? 0),
    0,
  );

  const handleAdd = () => {
    if (!name.trim() || !address.trim()) return;
    addServer.mutate(
      { name: name.trim(), address: address.trim() },
      {
        onSuccess: () => {
          setName("");
          setAddress("");
          setShowAdd(false);
        },
      },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Server className="h-5 w-5 text-primary" />
            {t("Servers")}
          </h2>
          {totalOnline > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {totalOnline.toLocaleString()} {t("online")}
            </span>
          )}

          <div className="relative ml-auto min-w-52 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search your servers…")}
              className="pl-9"
            />
          </div>

          <Button
            onClick={() =>
              refreshAll(undefined, {
                onSuccess: (results) =>
                  setEntries(
                    Object.fromEntries(
                      results.map((result) => [
                        result.id,
                        { status: result.status, error: result.error },
                      ]),
                    ),
                  ),
              })
            }
            disabled={pingAll.isPending || serverCount === 0}
            title={t("Refresh every server")}
          >
            {pingAll.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button onClick={() => setShowAdd((open) => !open)} variant="primary">
            <Plus className="h-4 w-4" />
            {t("Add server")}
          </Button>
          {/* The player built their multiplayer list inside the game long
              before opening the launcher; re-typing it is the wrong way round. */}
          {minecraftInstances.length > 0 && (
            <Button
              onClick={() => setShowImport((open) => !open)}
              title={t("Import the multiplayer list of an instance")}
            >
              <Download className="h-4 w-4" />
              {t("Import")}
            </Button>
          )}
          <Button onClick={() => setShowServerHub(false)}>
            <ArrowLeft className="h-4 w-4" />
            {t("Back")}
          </Button>
        </div>

        {showAdd && (
          <Panel className="mb-5 p-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1">
                <label className="text-xs font-medium text-muted-foreground">{t("Name")}</label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Hypixel"
                  className="mt-1"
                  autoFocus
                />
              </div>
              <div className="min-w-52 flex-1">
                <label className="text-xs font-medium text-muted-foreground">{t("Address")}</label>
                <Input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleAdd();
                  }}
                  placeholder="mc.hypixel.net"
                  className="mt-1"
                />
              </div>
              <Button
                onClick={handleAdd}
                disabled={!name.trim() || !address.trim() || addServer.isPending}
                variant="primary"
              >
                {addServer.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {t("Add")}
              </Button>
            </div>
          </Panel>
        )}

        {showImport && (
          <Panel className="mb-5 p-4">
            <p className="mb-3 text-sm text-muted-foreground">
              {t("Pick an instance to copy its in-game multiplayer list. Servers you already have are left alone.")}
            </p>
            <div className="flex flex-wrap gap-2">
              {minecraftInstances.map((instance) => (
                <Button
                  key={instance.id}
                  onClick={() =>
                    importServers.mutate(instance.id, {
                      onSuccess: () => setShowImport(false),
                    })
                  }
                  disabled={importServers.isPending}
                >
                  {importServers.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {instance.display_name}
                </Button>
              ))}
            </div>
          </Panel>
        )}

        {isLoading && <Loader2 className="h-6 w-6 animate-spin text-primary" />}

        {!isLoading && serverCount === 0 && (
          <EmptyState
            icon={Globe}
            title={t("No server saved")}
            description={t("Add a server to see who is online and join it in one click.")}
          />
        )}

        {!isLoading && serverCount > 0 && visible.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("No server matches that search.")}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((server) => {
            const entry = entries[server.id];
            const status = entry?.status ?? null;
            const unreachable = !!entry?.error;
            const bound = !!server.instance_id;
            const boundInstance = minecraftInstances.find(
              (instance) => instance.id === server.instance_id,
            );

            return (
              <div
                key={server.id}
                className="overflow-hidden rounded-xl border border-border/70 bg-card transition hover:border-primary/40"
              >
                <ServerBanner server={server} status={status} />

                <div className="flex items-center gap-3 p-3">
                  {status?.favicon ? (
                    <img
                      src={status.favicon}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-md border border-border/70 object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border/70 bg-secondary/30">
                      {unreachable ? (
                        <SignalZero className="h-4 w-4 text-destructive" />
                      ) : (
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{server.name}</div>
                    <div
                      className={cn(
                        "flex items-center gap-1.5 text-xs",
                        unreachable ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {status ? (
                        <>
                          <Users className="h-3 w-3" />
                          {status.players_online.toLocaleString()} {t("online")}
                        </>
                      ) : unreachable ? (
                        t("Unreachable")
                      ) : (
                        t("Checking…")
                      )}
                    </div>
                  </div>

                  <Button
                    onClick={() =>
                      setOpenSettings(openSettings === server.id ? null : server.id)
                    }
                    title={t("Server settings")}
                    aria-label={t("Server settings")}
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => join.mutate({ id: server.id, username: "Player" })}
                    // Joining without a bound instance would be a guess about
                    // which set of mods the player meant.
                    disabled={!bound || join.isPending}
                    title={
                      bound
                        ? `${t("Play on")} ${boundInstance?.display_name ?? server.name}`
                        : t("Choose an instance first")
                    }
                    variant="primary"
                  >
                    {join.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {!bound && (
                  <button
                    type="button"
                    onClick={() => setOpenSettings(server.id)}
                    className="w-full border-t border-border/60 bg-amber-500/5 px-3 py-2 text-left text-xs text-amber-300 transition hover:bg-amber-500/10"
                  >
                    {t("Choose the instance to play this server with")}
                  </button>
                )}

                {openSettings === server.id && (
                  <div className="space-y-3 border-t border-border/60 p-3">
                    <div className="font-mono text-xs text-muted-foreground">{server.address}</div>
                    <LauncherOptionPicker
                      ariaLabel={t("Instance to launch for this server")}
                      options={[
                        { value: "", label: t("No instance bound") },
                        ...minecraftInstances.map((instance) => ({
                          value: instance.id,
                          label: instance.display_name,
                        })),
                      ]}
                      value={server.instance_id ?? ""}
                      onValueChange={(value) =>
                        bindInstance.mutate({ id: server.id, instanceId: value || null })
                      }
                      placeholder={t("No instance bound")}
                    />
                    <Button
                      onClick={() => removeServer.mutate({ id: server.id })}
                      disabled={removeServer.isPending}
                      variant="danger"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("Remove this server")}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
