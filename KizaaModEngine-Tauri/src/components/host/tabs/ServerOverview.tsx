import { AlertTriangle, Copy, Cpu, Globe, HardDrive, Loader2, MemoryStick, Timer, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { editable } from "../../../lib/maker/editable";
import { formatBytes } from "../../../lib/units";
import {
  isUp,
  useCancelInstall,
  useServerCrash,
  useServerMetrics,
  useServerNetwork,
  useServerSync,
  type HostedServer,
} from "../../../lib/hostQueries";
import { formatUptime } from "../format";

/**
 * The first tab: what the server is doing, what it costs, where to join it,
 * and — when it fell over — why.
 */
export function ServerOverview({ server }: { server: HostedServer }) {
  const { t } = useI18n();
  const status = server.status;
  const up = isUp(status.state);
  const { data: metrics } = useServerMetrics(server.id, true);
  const { data: network } = useServerNetwork(server.id);
  const { data: findings } = useServerCrash(server.id, status.state === "crashed");
  const { data: sync } = useServerSync(server.id, !!server.linked_instance_id && server.loader !== "vanilla");
  const cancelInstall = useCancelInstall();

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
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("Right now")}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Metric icon={Timer} label={t("Uptime")} value={up ? formatUptime(metrics?.uptime_s) : "—"} />
          <Metric icon={Users} label={t("Players")} value={up ? String(status.players.length) : "—"} />
          <Metric icon={MemoryStick} label={t("Memory")} value={up && metrics?.memory_bytes != null ? `${formatBytes(metrics.memory_bytes)} / ${server.max_memory_mb} MB` : `— / ${server.max_memory_mb} MB`} />
          <Metric icon={Cpu} label={t("CPU")} value={up && metrics?.cpu_percent != null ? `${metrics.cpu_percent.toFixed(0)} %` : "—"} />
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
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("Friends elsewhere would need port forwarding on your router; Kiza does not do that for you yet.")}
        </p>
      </section>

      {sync && (
        <section {...editable("panel")} className="kiza-panel border p-5 lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("Against the paired instance")}</h3>
          {sync.differences.length === 0 ? (
            <p className="text-sm text-emerald-300">{t("Client and server mods are in step.")} · {sync.in_step} {t("mods")}</p>
          ) : (
            <ul className="grid gap-1.5 text-sm md:grid-cols-2">
              {sync.differences.map((difference) => (
                <li key={`${difference.kind}-${difference.mod_id}`} className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-1.5">
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

function Metric({ icon: Icon, label, value }: { icon: typeof Timer; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2.5">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="block truncate text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Address({ label, value, onCopy }: { label: string; value: string; onCopy?: (text: string) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
      <span className="w-40 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate text-sm">{value}</code>
      {onCopy && (
        <button type="button" onClick={() => onCopy(value)} aria-label="Copy" className="text-muted-foreground hover:text-foreground">
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
