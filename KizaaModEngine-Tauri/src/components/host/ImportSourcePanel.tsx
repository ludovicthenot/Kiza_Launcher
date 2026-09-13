import { useState } from "react";
import { FolderOpen, Loader2, Upload } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../../lib/i18n";
import { editable } from "../../lib/maker/editable";
import { useAppStore } from "../../lib/store";
import { useDetectServerFolder, useImportServer, type Detection } from "../../lib/hostQueries";
import { MINECRAFT_LOADER_LABELS, MINECRAFT_LOADER_OPTIONS } from "../../lib/minecraftLoaders";
import type { MinecraftLoader } from "../../lib/types";
import { Button } from "../ui/primitives";
import { ChoiceField, NumberField, TextField } from "./fields";

/**
 * Import a server folder from anywhere on disk.
 *
 * Kiza reads what the folder proves — version, loader, mods, world — and
 * asks for the rest rather than guessing it. The folder is copied, not
 * moved; the original stays where it was.
 */
export function ImportSourcePanel() {
  const { t } = useI18n();
  const detect = useDetectServerFolder();
  const importServer = useImportServer();
  const setCreatorSource = useAppStore((state) => state.setCreatorSource);
  const setSelectedServerId = useAppStore((state) => state.setSelectedServerId);

  const [folder, setFolder] = useState("");
  const [detection, setDetection] = useState<Detection | null>(null);
  const [name, setName] = useState("");
  const [mcVersion, setMcVersion] = useState("");
  const [loader, setLoader] = useState<MinecraftLoader>("vanilla");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [memory, setMemory] = useState(4096);

  const pick = async () => {
    const selected = await openFileDialog({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    setFolder(selected);
    setName(selected.split(/[\\/]/).filter(Boolean).pop() ?? "");
    detect.mutate(selected, {
      onSuccess: (found) => {
        setDetection(found);
        if (found.loader) setLoader(found.loader);
      },
    });
  };

  const missing = (key: Detection["missing"][number]) => detection?.missing.includes(key) ?? false;
  const ready = !!folder && !!detection && !!name.trim()
    && (!missing("mc_version") || !!mcVersion.trim())
    && (!missing("loader_version") || loader === "vanilla" || !!loaderVersion.trim());

  const run = () => {
    if (!ready) return;
    importServer.mutate(
      {
        folder,
        name: name.trim(),
        mc_version: missing("mc_version") ? mcVersion.trim() : null,
        loader: missing("loader") ? loader : null,
        loader_version: missing("loader_version") || missing("loader") ? loaderVersion.trim() || null : null,
        max_memory_mb: memory,
      },
      {
        onSuccess: (server) => {
          setCreatorSource("scratch");
          setSelectedServerId(server.id);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-3xl font-bold tracking-tight">{t("Import a server")}</h2>
        <p className="mb-4 mt-1 text-base text-muted-foreground">
          {t("A folder with a server in it. Kiza copies it and reads what it can.")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={pick} disabled={detect.isPending}>
            {detect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
            {t("Choose a folder")}
          </Button>
          {folder && <span className="truncate text-sm text-muted-foreground">{folder}</span>}
        </div>
      </section>

      {detection && (
        <section {...editable("panel")} className="kiza-panel border p-6">
          <h3 className="mb-3 text-lg font-semibold">{t("What Kiza found")}</h3>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Found label={t("Minecraft")} value={detection.mc_version ?? t("not readable")} missing={!detection.mc_version} />
            <Found
              label={t("Loader")}
              value={detection.loader ? `${MINECRAFT_LOADER_LABELS[detection.loader]} ${detection.loader_version ?? ""}`.trim() : t("not readable")}
              missing={!detection.loader}
            />
            <Found label={t("Mods")} value={String(detection.mod_count)} />
            <Found label={t("World")} value={detection.has_world ? detection.level_name : t("none")} />
            <Found label={t("server.properties")} value={detection.has_properties ? t("present") : t("absent")} />
            <Found label={t("EULA")} value={detection.eula_accepted ? t("accepted") : t("not yet")} />
          </dl>
          {detection.notes.map((note) => (
            <p key={note} className="mt-3 text-sm text-muted-foreground">{note}</p>
          ))}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <TextField label={t("Server name")} value={name} onChange={setName} />
            <NumberField label={t("Memory")} value={memory} min={512} step={512} unit="MB" onChange={setMemory} />
            {missing("mc_version") && (
              <TextField label={t("Minecraft version")} value={mcVersion} onChange={setMcVersion} placeholder="1.20.1" hint={t("Could not be read from the folder.")} />
            )}
            {missing("loader") && (
              <ChoiceField label={t("Loader")} value={loader} onChange={(v) => setLoader(v as MinecraftLoader)} options={MINECRAFT_LOADER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
            )}
            {(missing("loader_version") || (missing("loader") && loader !== "vanilla")) && (
              <TextField label={`${t("Version")} ${MINECRAFT_LOADER_LABELS[loader]}`} value={loaderVersion} onChange={setLoaderVersion} />
            )}
          </div>
          <button
            type="button"
            onClick={run}
            disabled={!ready || importServer.isPending}
            {...editable("action")}
            className="kiza-action mt-5 inline-flex h-12 items-center gap-3 rounded-xl px-6 text-base font-semibold text-primary-foreground transition-[filter] hover:brightness-110 disabled:opacity-60"
          >
            {importServer.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            {t("Import")}
          </button>
        </section>
      )}
    </div>
  );
}

function Found({ label, value, missing = false }: { label: string; value: string; missing?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={missing ? "font-medium text-amber-300" : "font-medium"}>{value}</dd>
    </div>
  );
}
