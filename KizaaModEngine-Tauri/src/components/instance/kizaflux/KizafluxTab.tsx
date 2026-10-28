import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, Loader2, RefreshCw, Server, Zap } from "lucide-react";
import type { GameInstanceSummary, KizafluxCarry, KizafluxModStatus, KizafluxScannedFile, KizafluxServerCheck } from "../../../lib/types";
import {
  useKizafluxCarryMod,
  useKizafluxCheckServer,
  useKizafluxRemoveCarried,
  useKizafluxScan,
  useKizafluxSetModEnabled,
  useKizafluxStatus,
  useKizafluxUpdate,
} from "../../../lib/queries";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import { Button, EmptyState, Input } from "../../ui/primitives";

/**
 * A Kizaflux instance: the engine that plays it, what each of its files is
 * to that engine, and whether a server can be joined with it.
 *
 * Statuses come from Flux Diagnostics and are said as they are: a Java mod
 * is never shown as working, and "not tested" is not "compatible".
 */
export function KizafluxTab({ instance }: { instance: GameInstanceSummary }) {
  const { t } = useI18n();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <h2 className="flex items-center gap-2 text-xl font-bold text-balance">
            <Zap className="h-5 w-5 text-primary" />
            Kizaflux
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-primary">
              {t("Experimental")}
            </span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("This instance plays on Horizon, Minecraft rewritten in Rust. Java mods do not run on it.")}
          </p>
        </header>
        <EngineCard />
        <ServerCheck />
        <Files instanceId={instance.id} />
      </div>
    </div>
  );
}

function EngineCard() {
  const { t } = useI18n();
  const { data: status } = useKizafluxStatus();
  const update = useKizafluxUpdate();
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<string>("kizaflux-progress", (event) => setProgress(event.payload));
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  let state: string;
  if (!status?.installed) state = t("Not installed yet: it is downloaded and prepared at the first Play.");
  else if (!status.prepared) state = t("Installed, not prepared: the first Play prepares it (about 3 minutes, once).");
  else state = t("Ready");

  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-secondary/[0.32] p-4">
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("Engine")}</div>
        <div className="text-sm font-semibold">
          Horizon {status?.installed ?? ""}
          <span className="ml-2 font-normal text-muted-foreground">Minecraft {status?.minecraft_versions.join(", ")}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {update.isPending && progress ? t(progress) : state}
        </div>
      </div>
      <Button onClick={() => update.mutate()} disabled={update.isPending}>
        {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {status?.installed ? t("Update the engine") : t("Install the engine")}
      </Button>
    </section>
  );
}

function verdictText(check: KizafluxServerCheck, t: (s: string) => string): { text: string; tone: "good" | "maybe" | "bad" } {
  const verdict = check.verdict;
  switch (verdict.verdict) {
    case "protocol_matches":
      return { text: t("Same version as Kizaflux and no client mods asked: Kizaflux can join. Not yet tested on this server."), tone: "good" };
    case "multi_version_proxy":
      return { text: `${verdict.server_version}: ${t("accepts several versions. Kizaflux may join; not verified.")}`, tone: "maybe" };
    case "version_mismatch":
      return { text: `${t("This server is Minecraft")} ${verdict.server_version}; ${t("Kizaflux plays")} ${check.engine_minecraft}. ${t("Play it with a Java instance.")}`, tone: "bad" };
    case "needs_java_client": {
      if (!verdict.mods.length) {
        return { text: `${t("This server is modded (Forge or NeoForge).")} ${t("Play it with a Java instance.")}`, tone: "bad" };
      }
      const shown = verdict.mods.slice(0, 8).join(", ");
      const more = verdict.mods.length > 8 ? "…" : "";
      return { text: `${t("This server needs Java mods on the client")}: ${shown}${more}. ${t("Play it with a Java instance.")}`, tone: "bad" };
    }
    case "unreachable":
      return { text: `${t("No answer")}: ${verdict.reason}`, tone: "bad" };
  }
}

function ServerCheck() {
  const { t } = useI18n();
  const [address, setAddress] = useState("");
  const check = useKizafluxCheckServer();
  const result = check.data ? verdictText(check.data, t) : null;
  return (
    <section className="rounded-xl bg-secondary/[0.32] p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Server className="h-4 w-4 text-muted-foreground" />
        {t("Can Kizaflux join a server?")}
      </h3>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (address.trim()) check.mutate(address.trim());
        }}
      >
        <Input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="play.example.net"
          aria-label={t("Server address")}
          className="flex-1"
        />
        <Button type="submit" disabled={check.isPending || !address.trim()}>
          {check.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("Check")}
        </Button>
      </form>
      {result && (
        <p
          className={cn(
            "mt-2 text-sm",
            result.tone === "good" && "text-emerald-300",
            result.tone === "maybe" && "text-amber-300",
            result.tone === "bad" && "text-red-300",
          )}
        >
          {result.text}
          {check.data?.status?.players_online != null && (
            <span className="ml-1 text-muted-foreground">
              ({check.data.status.players_online}/{check.data.status.players_max} {t("players")})
            </span>
          )}
        </p>
      )}
      {check.error && <p className="mt-2 text-sm text-red-300">{String(check.error)}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        {t("A check asks the server what it is, like the server list does. It does not log in: plugins, anti-cheat and gameplay are only known by playing.")}
      </p>
    </section>
  );
}

const STATUS_ORDER: KizafluxModStatus[] = [
  "compatible_tested",
  "partially_compatible",
  "untested",
  "resources_only",
  "needs_adaptation",
  "incompatible",
];

const STATUS_LABEL: Record<KizafluxModStatus, string> = {
  compatible_tested: "Compatible and tested",
  partially_compatible: "Partially compatible",
  resources_only: "Resources only",
  needs_adaptation: "Needs adaptation",
  incompatible: "Incompatible",
  untested: "Not tested",
};

const STATUS_TONE: Record<KizafluxModStatus, string> = {
  compatible_tested: "bg-emerald-500/15 text-emerald-300",
  partially_compatible: "bg-amber-500/15 text-amber-300",
  resources_only: "bg-sky-500/15 text-sky-300",
  needs_adaptation: "bg-orange-500/15 text-orange-300",
  incompatible: "bg-red-500/15 text-red-300",
  untested: "bg-secondary text-muted-foreground",
};

function Files({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const { data: files, isLoading } = useKizafluxScan(instanceId);
  const counts = useMemo(() => {
    const out = new Map<KizafluxModStatus, number>();
    for (const file of files ?? []) out.set(file.report.status, (out.get(file.report.status) ?? 0) + 1);
    return out;
  }, [files]);
  const sorted = useMemo(
    () =>
      [...(files ?? [])].sort(
        (a, b) => STATUS_ORDER.indexOf(a.report.status) - STATUS_ORDER.indexOf(b.report.status) || a.report.file_name.localeCompare(b.report.file_name),
      ),
    [files],
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }
  if (!sorted.length) {
    return (
      <EmptyState
        title={t("Nothing installed")}
        description={t("Horizon mods go in horizon-mods, resource packs in resourcepacks. Each file found there is shown with what Kizaflux can do with it.")}
      />
    );
  }
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {STATUS_ORDER.filter((status) => counts.get(status)).map((status) => (
          <span key={status} className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums", STATUS_TONE[status])}>
            {t(STATUS_LABEL[status])} · {counts.get(status)}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-border/40 overflow-hidden rounded-xl bg-secondary/[0.2]">
        {sorted.map((file) => (
          <FileRow key={`${file.folder}/${file.report.file_name}`} file={file} instanceId={instanceId} />
        ))}
      </ul>
    </section>
  );
}

const CARRY_LABEL: Record<KizafluxCarry["verdict"], string> = {
  works: "Everything ports",
  partly: "Part ports",
  no: "Nothing ports",
};

function FileRow({ file, instanceId }: { file: KizafluxScannedFile; instanceId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const toggle = useKizafluxSetModEnabled(instanceId);
  const carryMod = useKizafluxCarryMod(instanceId);
  const removeCarried = useKizafluxRemoveCarried(instanceId);
  const { report, carry } = file;
  const modId = carry?.mod_id ?? report.descriptors[0]?.mods[0]?.id;
  const name = report.descriptors[0]?.mods[0]?.name ?? report.file_name;
  const isJava = typeof report.kind === "object" && report.kind.mod !== "horizon";
  // Horizon's carry-over, once run, says what came across: it comes first.
  const details = carry
    ? [carry.summary, ...carry.ports.map((line) => `+ ${line}`), ...carry.skipped.map((line) => `− ${line}`)]
    : [...report.reasons, ...report.unavailable];
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold", STATUS_TONE[report.status])}>
            {t(STATUS_LABEL[report.status])}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {file.folder}/{report.file_name}
              {carry && ` · Horizon : ${t(CARRY_LABEL[carry.verdict])}`}
              {!carry && isJava && ` · ${t("estimated from its files, not brought over yet")}`}
              {report.horizon_equivalent && ` · ${t("Horizon has its own")}: ${report.horizon_equivalent}`}
            </span>
          </span>
          <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {isJava && file.folder === "mods" && !carry?.installed && carry?.verdict !== "no" && (
          <Button onClick={() => carryMod.mutate(report.file_name)} disabled={carryMod.isPending}>
            {carryMod.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("Bring over")}
          </Button>
        )}
        {carry?.installed && (
          <Button onClick={() => removeCarried.mutate(carry.mod_id)} disabled={removeCarried.isPending}>
            {t("Remove")}
          </Button>
        )}
        {file.enabled !== null && modId && (
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={file.enabled}
              disabled={toggle.isPending}
              onChange={(event) => toggle.mutate({ modId, enabled: event.target.checked })}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            {file.enabled ? t("On") : t("Off")}
          </label>
        )}
      </div>
      {open && details.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
