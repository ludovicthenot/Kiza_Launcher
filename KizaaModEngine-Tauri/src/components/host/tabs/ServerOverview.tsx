import { useEffect, useState } from "react";
import { AlertTriangle, AtSign, Copy, Cpu, Globe, HardDrive, Loader2, Lock, MemoryStick, Timer, Unlock, Users, X } from "lucide-react";
import { Input } from "../../ui/primitives";
import { toast } from "sonner";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { editable } from "../../../lib/maker/editable";
import { formatBytes } from "../../../lib/units";
import {
  isUp,
  useCancelInstall,
  useClaimServerAddress,
  useCloseServerPort,
  useReleaseServerAddress,
  useOpenServerPort,
  useServerCrash,
  useServerMetrics,
  useServerNetwork,
  useServerSync,
  type HostedServer,
} from "../../../lib/hostQueries";
import { formatUptime } from "../format";
import { usePageShown } from "../../common/FrontPages";

/**
 * The first tab: what the server is doing, what it costs, where to join it,
 * and — when it fell over — why.
 */
export function ServerOverview({ server }: { server: HostedServer }) {
  const { t } = useI18n();
  const status = server.status;
  const up = isUp(status.state);
  const { data: metrics } = useServerMetrics(server.id, usePageShown());
  const [askPublic, setAskPublic] = useState(false);
  const { data: network, isFetching: networkFetching } = useServerNetwork(server.id, askPublic);
  const openPort = useOpenServerPort();
  const closePort = useCloseServerPort();
  const claimAddress = useClaimServerAddress();
  const releaseAddress = useReleaseServerAddress();
  const [wantedName, setWantedName] = useState("");
  const { data: findings } = useServerCrash(server.id, status.state === "crashed");
  const { data: sync } = useServerSync(server.id, !!server.linked_instance_id && server.loader !== "vanilla");
  const cancelInstall = useCancelInstall();
  const uptime = useUptime(up ? status.started_at_ms : null);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("Copied"));
    } catch {
      toast.error(t("Could not copy"));
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {status.install && !status.install.finished && (
        <section {...editable("panel")} className="kiza-panel border p-5 lg:col-span-2">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t(status.install.message)}</p>
              {status.install.total ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary/60">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.min(100, (status.install.done / status.install.total) * 100)}%` }}
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => cancelInstall.mutate(server.id)}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
              {t("Cancel")}
            </button>
          </div>
        </section>
      )}

      {status.install?.finished && status.install.error && (
        <Notice tone="error" title={t("The install failed")} body={status.install.error} />
      )}

      {status.state === "crashed" && (
        <section className="rounded-xl border border-red-400/30 bg-red-400/10 p-5 lg:col-span-2">
          <p className="inline-flex items-center gap-2 font-semibold text-red-200">
            <AlertTriangle className="h-4 w-4" />
            {t("The server stopped unexpectedly")}
            {status.exit_code != null && <span className="text-red-200/70">· {t("exit code")} {status.exit_code}</span>}
          </p>
          {findings && findings.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {findings.map((finding, index) => (
                <li key={index} className="text-sm">
                  <span className="font-medium">{finding.title}</span>
                  {finding.detail ? <span className="text-red-100/80"> — {finding.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-red-100/80">{t("Nothing in the log named a cause. The Console tab has the last lines; Files opens the crash reports.")}</p>
          )}
        </section>
      )}

      <section {...editable("panel")} className="kiza-panel border p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("Right now")}</h3>
          {!up && <span className="truncate text-xs text-muted-foreground/80">{t("Live numbers show once it runs.")}</span>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Metric icon={Timer} label={t("Uptime")} value={up ? formatUptime(uptime) : "—"} muted={!up} />
          <Metric icon={Users} label={t("Players")} value={up ? String(status.players.length) : "—"} muted={!up} />
          <Metric icon={MemoryStick} label={t("Memory")} value={up && metrics?.memory_bytes != null ? `${formatBytes(metrics.memory_bytes)} / ${server.max_memory_mb} MB` : `${server.max_memory_mb} MB ${t("allowed")}`} />
          <Metric icon={Cpu} label={t("CPU")} value={up && metrics?.cpu_percent != null ? `${metrics.cpu_percent.toFixed(0)} %` : "—"} muted={!up} />
          <Metric icon={HardDrive} label={t("World")} value={metrics ? formatBytes(metrics.world_bytes) : "—"} />
          <Metric icon={Globe} label={t("Port")} value={`${server.port} · ${up ? (metrics?.port_open ? t("open") : t("not answering yet")) : t("closed")}`} />
        </div>
        {status.players.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("Online")}: {status.players.join(", ")}
          </p>
        )}
      </section>

      <section {...editable("panel")} className="kiza-panel border p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("Join from")}</h3>
        <div className="flex flex-col gap-2">
          <Address label={t("This computer")} value={network?.local_address ?? `localhost:${server.port}`} onCopy={copy} />
          <Address
            label={t("Same network (LAN)")}
            value={network?.lan_address ?? t("no network address found")}
            onCopy={network?.lan_address ? copy : undefined}
          />
          {askPublic ? (
            <Address
              label={t("Internet")}
              value={
                networkFetching && !network?.public_address
                  ? t("asking…")
                  : network?.public_address ?? t("no public address found")
              }
              onCopy={network?.public_address ? copy : undefined}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAskPublic(true)}
              className="self-start text-sm text-primary hover:underline"
            >
              {t("Show the internet address and the router")}
            </button>
          )}
        </div>
        {askPublic && (
          <div className="mt-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2.5 text-sm">
            {server.kiza_address ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 text-emerald-300">
                  <AtSign className="h-4 w-4" />
                  {t("Kiza address")}
                </span>
                <code className="min-w-0 flex-1 truncate">{server.kiza_address.address}</code>
                <button type="button" onClick={() => copy(server.kiza_address!.address)} aria-label="Copy" className="text-muted-foreground hover:text-foreground">
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={releaseAddress.isPending}
                  onClick={() => releaseAddress.mutate(server.id)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {t("Give it back")}
                </button>
                <p className="w-full text-xs text-muted-foreground">
                  {t("Points here only while the server runs, and follows your connection on every start. The port still has to be forwarded below.")}
                </p>
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  claimAddress.mutate({ serverId: server.id, name: wantedName });
                }}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <AtSign className="h-4 w-4" />
                  {t("Kiza address")}
                </span>
                <Input
                  value={wantedName}
                  onChange={(event) => setWantedName(event.target.value.toLowerCase())}
                  placeholder={server.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}
                  className="h-8 w-44 text-sm"
                />
                <button
                  type="submit"
                  disabled={claimAddress.isPending}
                  className="kiza-action inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {claimAddress.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AtSign className="h-3.5 w-3.5" />}
                  {t("Get a name")}
                </button>
                <p className="w-full text-xs text-muted-foreground">
                  {t("A name instead of the address above — friends type it, it follows your connection, and the port travels with it. Needs a signed-in launcher.")}
                </p>
              </form>
            )}
          </div>
        )}
        {askPublic && network && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2.5 text-sm">
            <span className={cn("inline-flex items-center gap-2", network.forwarded ? "text-emerald-300" : "text-muted-foreground")}>
              {network.forwarded ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {network.forwarded
                ? `${t("Port")} ${network.port} ${t("is forwarded by the router")}${network.opened_by_kiza ? ` · ${t("opened by Kiza")}` : ""}`
                : network.upnp_available
                  ? `${t("Port")} ${network.port} ${t("is not forwarded")}`
                  : t("No UPnP router answered")}
            </span>
            <span className="ml-auto flex gap-2">
              {network.upnp_available && !network.forwarded && (
                <button
                  type="button"
                  disabled={openPort.isPending}
                  onClick={() => openPort.mutate(server.id)}
                  className="kiza-action inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {openPort.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                  {t("Open the port (UPnP)")}
                </button>
              )}
              {network.forwarded && network.opened_by_kiza && (
                <button
                  type="button"
                  disabled={closePort.isPending}
                  onClick={() => closePort.mutate(server.id)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {closePort.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                  {t("Close the port")}
                </button>
              )}
            </span>
            {!network.upnp_available && (
              <p className="w-full text-xs text-muted-foreground">
                {t("Forward TCP port {port} to {lan} in your router's settings, or turn on UPnP there and try again.")
                  .replace("{port}", String(network.port))
                  .replace("{lan}", network.lan_address?.split(":")[0] ?? "this machine")}
              </p>
            )}
            {network.upnp_available && (
              <p className="w-full text-xs text-muted-foreground">
                {t("A port Kiza opens is closed again when the server stops. Some routers ignore UPnP; a friend who cannot connect is the test.")}
              </p>
            )}
          </div>
        )}
      </section>

      {sync && (
        <section {...editable("panel")} className="kiza-panel border p-5 lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("Against the paired instance")}</h3>
          {sync.differences.length === 0 ? (
            <p className="text-sm text-emerald-300">{t("Client and server mods are in step.")} · {sync.in_step} {t("mods")}</p>
          ) : (
            <ul className="grid gap-1.5 text-sm md:grid-cols-2">
              {sync.differences.map((difference) => (
                <li key={`${difference.kind}-${difference.mod_id}`} className="flex items-center justify-between gap-3 rounded-lg bg-secondary/25 px-3 py-2">
                  <span className="truncate">{difference.name}</span>
                  <span className={cn("shrink-0 text-xs", difference.kind === "version_mismatch" ? "text-amber-300" : "text-muted-foreground")}>
                    {difference.kind === "missing_on_server" && t("missing on the server")}
                    {difference.kind === "missing_on_client" && t("missing on the client")}
                    {difference.kind === "version_mismatch" && `${difference.client_version} ≠ ${difference.server_version}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{t("A report, not a change: nothing is copied or removed from here.")}</p>
        </section>
      )}
    </div>
  );
}

/** Seconds since the start, counted here every second rather than fetched. */
function useUptime(startedAtMs: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAtMs]);
  if (startedAtMs == null) return null;
  return Math.max(0, Math.floor((now - startedAtMs) / 1000));
}

/** A live figure; `muted` while the server is not running to give it. */
function Metric({ icon: Icon, label, value, muted }: { icon: typeof Timer; label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-xl bg-secondary/30 px-3.5 py-3 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className={cn("mt-0.5 block truncate text-lg font-semibold tabular-nums tracking-[-0.01em] transition-colors duration-300", muted && "text-muted-foreground/45")}>
        {value}
      </span>
    </div>
  );
}

function Address({ label, value, onCopy }: { label: string; value: string; onCopy?: (text: string) => void }) {
  return (
    <div className="flex min-h-11 items-center gap-3 rounded-xl bg-secondary/30 px-3.5 py-2 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
      <span className="w-40 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate text-sm">{value}</code>
      {onCopy && (
        <button
          type="button"
          onClick={() => onCopy(value)}
          aria-label="Copy"
          className="-mr-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-white/[0.08] hover:text-foreground active:scale-[0.9]"
        >
          <Copy className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Notice({ tone, title, body }: { tone: "error" | "warn" | "info"; title: string; body: string }) {
  const classes = {
    error: "border-red-400/30 bg-red-400/10 text-red-100",
    warn: "border-amber-400/30 bg-amber-400/10 text-amber-100",
    info: "border-border/60 bg-secondary/20 text-foreground",
  }[tone];
  return (
    <section className={cn("rounded-xl border p-4 text-sm lg:col-span-2", classes)}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 opacity-80">{body}</p>
    </section>
  );
}
