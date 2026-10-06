import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Box, Check, Hammer, Loader2, Play } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { useAppStore } from "../../lib/store";
import { useInstances } from "../../lib/queries";
import { useBuildFromInstance, useInstanceAnalysis, type ModVerdict } from "../../lib/hostQueries";
import { MINECRAFT_LOADER_LABELS } from "../../lib/minecraftLoaders";
import { formatBytes } from "../../lib/units";
import { Checkbox } from "../ui/checkbox";
import { ChoiceField, NumberField, TextField, ToggleField } from "./fields";

/**
 * Create Server From Instance.
 *
 * Pick an instance, read what Kiza found — version, loader, Java, and a
 * verdict for every mod with the reason behind it — untick what should not
 * travel, tick what should, and build. The unknowns are listed first and
 * ticked by default: a server missing a mod it needs does not start, a
 * server carrying a jar it ignores merely wastes a little memory.
 */
export function InstanceSourcePanel() {
  const { t } = useI18n();
  const { data: instances } = useInstances();
  const chosen = useAppStore((state) => state.creatorInstanceId);
  const setCreatorSource = useAppStore((state) => state.setCreatorSource);
  const setSelectedServerId = useAppStore((state) => state.setSelectedServerId);
  const minecraftInstances = useMemo(
    () => (instances ?? []).filter((instance) => instance.game_id === "minecraft"),
    [instances],
  );

  const { data: analysis, isLoading, error } = useInstanceAnalysis(chosen);
  const build = useBuildFromInstance();

  const [name, setName] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [copyConfig, setCopyConfig] = useState(true);
  const [world, setWorld] = useState("");
  const [port, setPort] = useState(25565);
  const [memory, setMemory] = useState(4096);

  // A fresh analysis resets the review to its recommendation.
  useEffect(() => {
    if (!analysis) return;
    setName((current) => current || `${analysis.display_name} Server`);
    setTicked(new Set(analysis.mods.filter((m) => m.verdict === "server" || m.verdict === "unknown").map((m) => m.id)));
    setCopyConfig(analysis.has_config);
    setWorld("");
    setMemory(analysis.loader === "vanilla" ? 4096 : 6144);
  }, [analysis]);

  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const groups = useMemo(() => {
    const by = (kind: ModVerdict["verdict"]) => (analysis?.mods ?? []).filter((m) => m.verdict === kind);
    return [
      { kind: "unknown" as const, title: t("To review"), hint: t("Nothing said which side these run on. Included unless you untick them."), mods: by("unknown") },
      { kind: "server" as const, title: t("Server mods"), hint: t("Needed on the server."), mods: by("server") },
      { kind: "excluded" as const, title: t("Client-only, left out"), hint: t("Tick one to take it anyway."), mods: by("excluded") },
      { kind: "disabled" as const, title: t("Disabled in the instance"), hint: "", mods: by("disabled") },
    ].filter((group) => group.mods.length > 0);
  }, [analysis, t]);

  const deploy = () => {
    if (!analysis || !name.trim()) return;
    build.mutate(
      {
        instance_id: analysis.instance_id,
        name: name.trim(),
        mod_ids: [...ticked],
        copy_config: copyConfig,
        world_folder: world || null,
        port,
        max_memory_mb: memory,
      },
      {
        onSuccess: (outcome) => {
          setCreatorSource("scratch", null);
          setSelectedServerId(outcome.server.id);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-3xl font-bold tracking-tight">{t("From an instance")}</h2>
        <p className="mb-4 mt-1 text-base text-muted-foreground">
          {t("Kiza reads the instance and keeps what a server needs.")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {minecraftInstances.map((instance) => {
            const active = instance.id === chosen;
            return (
              <button
                key={instance.id}
                type="button"
                aria-pressed={active}
                onClick={() => setCreatorSource("instance", instance.id)}
                {...editable("card")}
                className={cn(
                  "kiza-card flex items-center gap-3 border bg-card/30 px-4 py-3 text-left transition-colors hover:border-primary/50",
                  active && "border-primary/70 bg-primary/10",
                )}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Box className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{instance.display_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {instance.minecraft?.mc_version} · {MINECRAFT_LOADER_LABELS[instance.minecraft?.loader ?? "vanilla"]} · {instance.mod_count} {t("mods")}
                  </span>
                </span>
                {active && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
          {minecraftInstances.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("No Minecraft instance to start from.")}</p>
          )}
        </div>
      </section>

      {chosen && isLoading && (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("Reading the instance…")}
        </p>
      )}
      {error != null && <p className="text-sm text-destructive">{String(error)}</p>}

      {analysis && (
        <>
          <section {...editable("panel")} className="kiza-panel border p-6">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base">
              <span className="font-semibold">Minecraft {analysis.mc_version}</span>
              <span>{MINECRAFT_LOADER_LABELS[analysis.loader]} {analysis.loader_version ?? ""}</span>
              <span>Java {analysis.java_major}</span>
              <span className="text-muted-foreground">{analysis.total} {t("mods detected")}</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Stat value={analysis.server_mods} label={t("compatible server mods")} tone="text-emerald-300" />
              <Stat value={analysis.client_only} label={t("client-only mods excluded")} tone="text-muted-foreground" />
              <Stat value={analysis.unknown} label={t("unknown mods to review")} tone={analysis.unknown ? "text-amber-300" : "text-muted-foreground"} />
            </div>
            {analysis.issues.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm">
                <p className="inline-flex items-center gap-2 font-medium text-amber-200">
                  <AlertTriangle className="h-4 w-4" />
                  {t("The instance has problems a server would inherit")}
                </p>
                <ul className="mt-1 list-disc pl-6 text-amber-100/80">
                  {analysis.issues.slice(0, 6).map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {groups.map((group) => (
            <section key={group.kind}>
              <h3 className="text-lg font-semibold">
                {group.title} <span className="text-muted-foreground">· {group.mods.length}</span>
              </h3>
              {group.hint && <p className="mb-3 text-sm text-muted-foreground">{group.hint}</p>}
              <div className="grid gap-2 md:grid-cols-2">
                {group.mods.map((mod) => (
                  <label
                    key={mod.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2",
                      group.kind === "disabled" && "opacity-50",
                    )}
                  >
                    <Checkbox
                      checked={ticked.has(mod.id)}
                      disabled={group.kind === "disabled"}
                      onChange={() => toggle(mod.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{mod.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{mod.version}</span>
                    </span>
                    <BasisBadge mod={mod} />
                  </label>
                ))}
              </div>
            </section>
          ))}

          <section {...editable("panel")} className="kiza-panel border p-6">
            <h3 className="mb-4 text-lg font-semibold">{t("The server")}</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label={t("Server name")} value={name} onChange={setName} />
              <ChoiceField
                label={t("World")}
                value={world}
                onChange={setWorld}
                options={[
                  { value: "", label: t("New world") },
                  ...analysis.worlds.map((w) => ({ value: w.folder, label: `${w.display_name} · ${formatBytes(w.size_bytes)}` })),
                ]}
                hint={t("A copy; the instance keeps its own.")}
              />
              <NumberField label={t("Port")} value={port} min={1024} max={65535} onChange={setPort} />
              <NumberField label={t("Memory")} value={memory} min={512} step={512} unit="MB" onChange={setMemory} />
              <ToggleField
                label={t("Copy the config folder")}
                hint={analysis.has_config ? t("Mod settings travel with the mods.") : t("The instance has no config folder.")}
                checked={copyConfig && analysis.has_config}
                onChange={setCopyConfig}
              />
            </div>
            <button
              type="button"
              onClick={deploy}
              disabled={build.isPending || !name.trim()}
              {...editable("action")}
              className="kiza-action mt-5 inline-flex h-12 items-center gap-3 rounded-xl px-6 text-base font-semibold text-primary-foreground transition-[filter] hover:brightness-110 disabled:opacity-60"
            >
              {build.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Hammer className="h-5 w-5" />}
              {t("Build the server")} · {ticked.size} {t("mods")}
            </button>
          </section>
        </>
      )}
      {!chosen && minecraftInstances.length > 0 && (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Play className="h-4 w-4" />
          {t("Choose an instance above.")}
        </p>
      )}
    </div>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
      <span className={cn("block text-2xl font-bold tabular-nums", tone)}>{value}</span>
      <span className="block text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function BasisBadge({ mod }: { mod: ModVerdict }) {
  const { t } = useI18n();
  const side = mod.side ? { client: t("client"), server: t("server"), both: t("both sides") }[mod.side] : t("unknown");
  const basis = { jar: "jar", modrinth: "Modrinth", curseforge: "CurseForge", none: "" }[mod.basis];
  return (
    <span className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-[0.6875rem] text-muted-foreground" title={basis ? `${t("Said by")} ${basis}` : undefined}>
      {side}
      {basis ? ` · ${basis}` : ""}
    </span>
  );
}
