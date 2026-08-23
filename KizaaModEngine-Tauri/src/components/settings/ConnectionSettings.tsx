import { Loader2 } from "lucide-react";
import {
  ApiConnectionStatus,
  useApiConnections,
  useValidateApiConnection,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";

function statusTone(status: string) {
  if (status === "connected" || status === "available")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "configured") return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  if (status === "offline_ready") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (status === "disabled") return "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";
  return "border-red-500/30 bg-red-500/10 text-red-300";
}

function ApiConnectionRow({
  connection,
  onValidate,
  busy,
}: {
  connection: ApiConnectionStatus;
  onValidate: () => void;
  busy: boolean;
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
      <button
        onClick={onValidate}
        disabled={busy}
        className="inline-flex h-9 min-w-20 items-center justify-center rounded-md border border-border bg-secondary/30 px-3 text-sm transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Check")}
      </button>
    </div>
  );
}

/**
 * The services Kiza talks to, and whether each one is answering.
 *
 * Every line is the result of a real request to a real service. There is no
 * summary reading "4/4 operational" invented from nothing — the only status
 * worth showing is one that was measured, and a green light nobody checked is
 * exactly what people believe right up until it matters.
 */
export function ConnectionSettings() {
  const { t } = useI18n();
  const { data: connections, isLoading } = useApiConnections();
  const validateApiConnection = useValidateApiConnection();

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">{t("API connections")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Each check is a real request. Nothing here is reported as working until it has answered.")}
        </p>
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/10 px-4">
        {isLoading && (
          <div className="space-y-3 py-5">
            <div className="h-12 animate-pulse rounded-md bg-secondary/50" />
            <div className="h-12 animate-pulse rounded-md bg-secondary/40" />
            <div className="h-12 animate-pulse rounded-md bg-secondary/30" />
          </div>
        )}

        {connections
          ?.filter((connection) => connection.id !== "microsoft")
          .map((connection) => (
            <ApiConnectionRow
              key={connection.id}
              connection={connection}
              onValidate={() =>
                validateApiConnection.mutate({ provider: connection.id, secret: null })
              }
              busy={validateApiConnection.isPending}
            />
          ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {t("Microsoft sign-in lives under Accounts, because it is about who you play as rather than about a service being reachable.")}
      </p>
    </div>
  );
}
