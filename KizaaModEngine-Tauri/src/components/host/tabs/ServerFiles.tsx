import { Boxes, FileText, FolderOpen, Globe, ScrollText, Settings2, ShieldCheck } from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import { editable } from "../../../lib/maker/editable";
import { useOpenHostedServerFolder, useServerLog, type HostedServer } from "../../../lib/hostQueries";

/**
 * The folders that matter, one button each, and the tail of the server's
 * own log. Not a file browser: the folder opens in the system's, which
 * already does that job.
 */
export function ServerFiles({ server, active }: { server: HostedServer; active: boolean }) {
  const { t } = useI18n();
  const open = useOpenHostedServerFolder();
  const { data: log, refetch } = useServerLog(server.id, active);

  const places: Array<{ sub?: string; label: string; hint: string; icon: typeof Globe }> = [
    { label: t("Server folder"), hint: t("server.properties, eula.txt, whitelist, ops, bans"), icon: FolderOpen },
    { sub: "mods", label: t("Mods"), hint: t("Every .jar the loader picks up"), icon: Boxes },
    { sub: "config", label: t("Config"), hint: t("Mod settings"), icon: Settings2 },
    { sub: "world", label: t("World"), hint: t("The world folder"), icon: Globe },
    { sub: "logs", label: t("Logs"), hint: t("latest.log and the archive"), icon: ScrollText },
    { sub: "crash-reports", label: t("Crash reports"), hint: t("One file per crash"), icon: ShieldCheck },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section {...editable("panel")} className="kiza-panel border p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("Open")}</h3>
        <div className="flex flex-col gap-2">
          {places.map((place) => {
            const Icon = place.icon;
            return (
              <button
                key={place.label}
                type="button"
                onClick={() => open.mutate({ serverId: server.id, subfolder: place.sub })}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{place.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{place.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 truncate text-xs text-muted-foreground" title={server.folder}>{server.folder}</p>
      </section>

      <section {...editable("panel")} className="kiza-panel border p-5">
        <div className="mb-3 flex items-center gap-3">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <FileText className="h-4 w-4" />
            logs/latest.log
          </h3>
          <button type="button" onClick={() => void refetch()} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            {t("Refresh")}
          </button>
        </div>
        <pre className="max-h-[420px] overflow-auto rounded-lg border border-border/60 bg-black/50 p-3 font-mono text-[0.75rem] leading-5 text-foreground/80">
          {log || t("No log yet.")}
        </pre>
      </section>
    </div>
  );
}
