import { Activity, CheckCircle2, Loader2, Plug, RefreshCw, Server, XCircle } from "lucide-react";
import {
  ApiConnectionStatus,
  ServiceCheck,
  useApiConnections,
  useCheckServices,
  useValidateApiConnection,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { useSettingsDraft } from "../../lib/useSettingsDraft";
import { cn } from "../../lib/utils";
import { Row, Section, Toggle } from "./controls";

/**
 * The services Kiza talks to, and whether each one is answering.
 *
 * Every reading on this page was measured. There is no summary saying "4/4
 * operational" invented from nothing, and no latency figure that came from
 * anywhere but a request that was timed — a green light nobody checked is
 * exactly what people believe right up until it matters.
 *
 * Which is also why there is no proxy or DNS block here yet. Those would need
 * the HTTP client to read them, and until it does, a proxy field would be a box
 * that accepts an address and ignores it.
 */

function statusTone(status: string) {
  if (status === "connected" || status === "available")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "configured") return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  if (status === "offline_ready") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (status === "disabled") return "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";
  return "border-red-500/30 bg-red-500/10 text-red-300";
}

/**
 * A latency, coloured by what it means for someone browsing mods.
 *
 * The thresholds are about perception rather than about the network: under
 * 300 ms a search feels instant, past a second it feels broken.
 */
function LatencyBadge({ ms }: { ms: number }) {
  const tone =
    ms < 300 ? "text-emerald-300" : ms < 1000 ? "text-amber-300" : "text-red-300";
  return <span className={cn("text-sm tabular-nums", tone)}>{ms} ms</span>;
}

function ApiConnectionRow({
  connection,
  onValidate,
  busy,
  latency,
}: {
  connection: ApiConnectionStatus;
  onValidate: () => void;
  busy: boolean;
  latency?: number | null;
}) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/70 py-4 last:border-b-0">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-sm font-semibold">{connection.label}</div>
          <div
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-normal",
              statusTone(connection.status),
            )}
          >
            {t(connection.status.replace("_", " "))}
          </div>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">{t(connection.detail)}</p>
      </div>
      <div className="flex items-center gap-3">
        {typeof latency === "number" && <LatencyBadge ms={latency} />}
        <button
          onClick={onValidate}
          disabled={busy}
          className="inline-flex h-9 min-w-20 items-center justify-center rounded-md border border-border bg-secondary/30 px-3 text-sm transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Test")}
        </button>
      </div>
    </div>
  );
}

/** One tile in the reachability grid. */
function ServiceTile({ check }: { check: ServiceCheck }) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        check.reachable ? "border-emerald-500/25 bg-emerald-500/5" : "border-red-500/25 bg-red-500/5",
      )}
    >
      <div className="flex items-center gap-2">
        {check.reachable ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
        ) : (
          <XCircle className="h-4 w-4 shrink-0 text-red-400" />
        )}
        <span className="truncate text-sm font-medium">{check.label}</span>
      </div>
      <div className="mt-1 pl-6 text-xs text-muted-foreground">
        {check.reachable && check.latency_ms !== null ? (
          <LatencyBadge ms={check.latency_ms} />
        ) : (
          // A refusal is not silence, and the two used to read the same. A
          // rejected API key showed "No answer" beside a service that had
          // answered immediately, which sends you looking at your network.
          <span className="break-words">{check.detail ?? t("No answer")}</span>
        )}
      </div>
    </div>
  );
}

export function ConnectionSettings() {
  const { t } = useI18n();
  const { data: connections, isLoading } = useApiConnections();
  const validateApiConnection = useValidateApiConnection();
  const checkServices = useCheckServices();
  const { draft, update } = useSettingsDraft();

  const checks = checkServices.data;
  const latencyFor = (id: string) => checks?.find((check) => check.id === id)?.latency_ms;

  // Stated only once something has been measured. Before that the honest
  // summary is that nothing has been checked, not that everything is fine.
  const summary = checks
    ? {
        up: checks.filter((check) => check.reachable).length,
        total: checks.length,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/10 p-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {summary
              ? summary.up === summary.total
                ? t("Every service answered")
                : t("{up} of {total} services answered")
                    .replace("{up}", String(summary.up))
                    .replace("{total}", String(summary.total))
              : t("Nothing has been checked yet")}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("Each check is a real request. Nothing here is reported as working until it has answered.")}
          </p>
        </div>
        <button
          onClick={() => checkServices.mutate()}
          disabled={checkServices.isPending}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 text-sm transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
        >
          {checkServices.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("Check everything")}
        </button>
      </div>

      <div>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Server className="h-4 w-4 text-muted-foreground" />
          {t("Where mods come from")}
        </h3>
        <div className="rounded-xl border border-border/60 bg-secondary/10 px-4">
          {isLoading && (
            <div className="space-y-3 py-5">
              <div className="h-12 animate-pulse rounded-md bg-secondary/50" />
              <div className="h-12 animate-pulse rounded-md bg-secondary/40" />
            </div>
          )}

          {connections
            ?.filter((connection) => connection.id !== "microsoft")
            .map((connection) => (
              <ApiConnectionRow
                key={connection.id}
                connection={connection}
                latency={latencyFor(connection.id)}
                onValidate={() =>
                  validateApiConnection.mutate({ provider: connection.id, secret: null })
                }
                busy={validateApiConnection.isPending}
              />
            ))}
        </div>
      </div>

      {draft && (
        <Section
          icon={Plug}
          title={t("Integrations")}
          hint={t("Other programs Kiza talks to on this machine.")}
        >
          <Row
            label={t("Discord Rich Presence")}
            hint={t("Shows what you are playing on your Discord profile. Server addresses are never shared.")}
          >
            <Toggle
              label={t("Discord Rich Presence")}
              checked={draft.enable_discord_rpc}
              onChange={(value) => update({ enable_discord_rpc: value })}
            />
          </Row>
        </Section>
      )}

      <div>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-muted-foreground" />
          {t("Reachability")}
        </h3>
        <p className="mb-2 text-xs text-muted-foreground">
          {t("The four services a launch depends on, checked together.")}
        </p>

        {checks ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {checks.map((check) => (
              <ServiceTile key={check.id} check={check} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            {checkServices.isPending
              ? t("Asking each of them…")
              : t("Press Check everything to measure them.")}
          </div>
        )}
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        {t("Microsoft sign-in lives under Accounts, because it is about who you play as rather than about a service being reachable.")}
      </p>
    </div>
  );
}
