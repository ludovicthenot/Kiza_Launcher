import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Save } from "lucide-react";
import { useI18n } from "../../../lib/i18n";
import { editable } from "../../../lib/maker/editable";
import { useInstances } from "../../../lib/queries";
import {
  isUp,
  useOpenHostedServerFolder,
  useSaveServerProperties,
  useServerProperties,
  useUpdateHostedServer,
  type HostedServer,
  type KnownProperty,
} from "../../../lib/hostQueries";
import { ChoiceField, NumberField, TextField, ToggleField } from "../fields";
import { JAVA_CHOICES } from "../DraftSettingsPanel";

/**
 * Two forms, two files.
 *
 * The first is Kiza's own line about the server — name, memory, Java, the
 * paired instance — and lives in the registry. The second is
 * `server.properties`, drawn from the keys the page knows and saved as an
 * edit of the file, so whatever else is in there stays exactly as it was.
 */
export function ServerSettings({ server }: { server: HostedServer }) {
  const up = isUp(server.status.state);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RegistryForm server={server} locked={up} />
      <PropertiesForm server={server} locked={up} />
    </div>
  );
}

function RegistryForm({ server, locked }: { server: HostedServer; locked: boolean }) {
  const { t } = useI18n();
  const update = useUpdateHostedServer();
  const { data: instances } = useInstances();
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const [maxMemory, setMaxMemory] = useState(server.max_memory_mb);
  const [minMemory, setMinMemory] = useState(server.min_memory_mb);
  const [java, setJava] = useState(server.java_major == null ? "" : String(server.java_major));
  const [jvmArgs, setJvmArgs] = useState(server.jvm_args.join(" "));
  const [linked, setLinked] = useState(server.linked_instance_id ?? "");

  useEffect(() => {
    setName(server.name);
    setDescription(server.description);
    setMaxMemory(server.max_memory_mb);
    setMinMemory(server.min_memory_mb);
    setJava(server.java_major == null ? "" : String(server.java_major));
    setJvmArgs(server.jvm_args.join(" "));
    setLinked(server.linked_instance_id ?? "");
  }, [server.id, server.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () =>
    update.mutate({
      serverId: server.id,
      patch: {
        name,
        description,
        max_memory_mb: maxMemory,
        min_memory_mb: minMemory,
        java_major: java ? Number(java) : null,
        jvm_args: jvmArgs.split(/\s+/).filter(Boolean),
        linked_instance_id: linked || null,
      },
    });

  return (
    <section {...editable("panel")} className="kiza-panel border p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("In Kiza")}</h3>
      <div className="grid gap-4">
        <TextField label={t("Server name")} value={name} onChange={setName} />
        <TextField label={t("Description")} value={description} onChange={setDescription} hint={t("Shown on the card. The MOTD players see is in server.properties.")} />
        <div className="grid grid-cols-2 gap-3">
          <NumberField label={t("Memory")} value={maxMemory} min={512} step={512} unit="MB" onChange={setMaxMemory} />
          <NumberField label={t("Minimum")} value={minMemory} min={256} step={256} unit="MB" onChange={setMinMemory} />
        </div>
        <ChoiceField label={t("Java")} value={java} onChange={setJava} options={JAVA_CHOICES.map((c) => ({ ...c, label: c.value ? c.label : t("Automatic") }))} />
        <TextField label={t("JVM arguments")} value={jvmArgs} onChange={setJvmArgs} placeholder="-XX:+UseG1GC" />
        <ChoiceField
          label={t("Paired instance")}
          value={linked}
          onChange={setLinked}
          options={[
            { value: "", label: t("None") },
            ...(instances ?? []).filter((i) => i.game_id === "minecraft").map((i) => ({ value: i.id, label: i.display_name })),
          ]}
          hint={t("The Overview compares this server's mods with that instance's.")}
        />
      </div>
      {locked && <p className="mt-3 text-xs text-amber-300">{t("Memory and Java apply on the next start.")}</p>}
      <button type="button" onClick={save} disabled={update.isPending || !name.trim()} className="kiza-action mt-4 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("Save")}
      </button>
    </section>
  );
}

function PropertiesForm({ server, locked }: { server: HostedServer; locked: boolean }) {
  const { t } = useI18n();
  const { data: view } = useServerProperties(server.id);
  const save = useSaveServerProperties();
  const open = useOpenHostedServerFolder();
  const [changes, setChanges] = useState<Record<string, string>>({});

  useEffect(() => setChanges({}), [server.id, view]);

  const current = useMemo(() => {
    const map = new Map<string, string>();
    for (const [key, value] of view?.entries ?? []) map.set(key, value);
    return map;
  }, [view]);

  const valueOf = (property: KnownProperty) => changes[property.key] ?? current.get(property.key) ?? property.default;
  const set = (key: string, value: string) => setChanges((c) => ({ ...c, [key]: value }));
  const dirty = Object.keys(changes).length > 0;
  const unknownCount = (view?.entries.length ?? 0) - (view?.known.filter((k) => current.has(k.key)).length ?? 0);

  return (
    <section {...editable("panel")} className="kiza-panel border p-5">
      <div className="mb-4 flex items-center gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">server.properties</h3>
        <button type="button" onClick={() => open.mutate({ serverId: server.id })} className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <FileText className="h-3.5 w-3.5" />
          {t("Open the file")}
        </button>
      </div>
      {!view ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {view.known.map((property) => {
            const value = valueOf(property);
            const label = t(property.label);
            switch (property.kind) {
              case "bool":
                return <ToggleField key={property.key} label={label} checked={value === "true"} onChange={(v) => set(property.key, String(v))} />;
              case "int":
                return <NumberField key={property.key} label={label} value={Number(value) || 0} onChange={(v) => set(property.key, String(v))} />;
              case "choice":
                return <ChoiceField key={property.key} label={label} value={value} onChange={(v) => set(property.key, v)} options={property.choices.map((c) => ({ value: c, label: c.replace("minecraft:", "") }))} />;
              default:
                return <TextField key={property.key} label={label} value={value} onChange={(v) => set(property.key, v)} />;
            }
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {unknownCount > 0
          ? t("{count} other keys are in the file and are left as they are.").replace("{count}", String(unknownCount))
          : t("Keys the page does not know are left as they are.")}
        {locked ? ` ${t("The server reads the file on its next start.")}` : ""}
      </p>
      <button type="button" onClick={() => save.mutate({ serverId: server.id, changes })} disabled={!dirty || save.isPending} className="kiza-action mt-4 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("Save")} {dirty ? `· ${Object.keys(changes).length}` : ""}
      </button>
    </section>
  );
}
