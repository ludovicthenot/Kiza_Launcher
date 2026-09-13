import { ImageIcon, X } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../../lib/i18n";
import { editable } from "../../lib/maker/editable";
import type { ServerDraft } from "../../lib/serverDraft";
import { ChoiceField, NumberField, TextField, ToggleField } from "./fields";
import { Button } from "../ui/primitives";

interface DraftSettingsPanelProps {
  draft: ServerDraft;
  update: <K extends keyof ServerDraft>(key: K, value: ServerDraft[K]) => void;
}

export const JAVA_CHOICES = [
  { value: "", label: "Automatic" },
  { value: "8", label: "Java 8" },
  { value: "17", label: "Java 17" },
  { value: "21", label: "Java 21" },
];

/**
 * Everything about a new server the card does not ask: memory, Java, the
 * port, and the world as `server.properties` will describe it on the first
 * start. Two columns of plain controls; no drawer to find them behind.
 */
export function DraftSettingsPanel({ draft, update }: DraftSettingsPanelProps) {
  const { t } = useI18n();

  const pickIcon = async () => {
    const selected = await openFileDialog({ multiple: false, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (typeof selected === "string") update("iconPath", selected);
  };

  return (
    <div {...editable("panel")} className="kiza-panel border p-6">
      <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("Machine")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label={t("Memory")} value={draft.maxMemoryMb} min={512} step={512} unit="MB" onChange={(v) => update("maxMemoryMb", v)} />
            <NumberField label={t("Minimum")} value={draft.minMemoryMb} min={256} step={256} unit="MB" onChange={(v) => update("minMemoryMb", v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ChoiceField
              label={t("Java")}
              value={draft.javaMajor == null ? "" : String(draft.javaMajor)}
              options={JAVA_CHOICES.map((c) => ({ ...c, label: c.value ? c.label : t("Automatic") }))}
              onChange={(v) => update("javaMajor", v ? Number(v) : null)}
              hint={t("Automatic picks the Java this Minecraft version needs.")}
            />
            <NumberField label={t("Port")} value={draft.port} min={1024} max={65535} onChange={(v) => update("port", v)} />
          </div>
          <TextField
            label={t("JVM arguments")}
            value={draft.jvmArgs}
            onChange={(v) => update("jvmArgs", v)}
            placeholder="-XX:+UseG1GC"
            hint={t("Advanced. Placed before -jar; memory is set above.")}
          />
          <div className="flex items-center gap-3">
            <Button type="button" onClick={pickIcon}>
              <ImageIcon className="h-4 w-4" />
              {t("Server icon")}
            </Button>
            {draft.iconPath ? (
              <span className="inline-flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">{draft.iconPath.split(/[\\/]/).pop()}</span>
                <button type="button" onClick={() => update("iconPath", null)} aria-label={t("Remove the icon")} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{t("PNG, 64×64.")}</span>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("World")}</h3>
          <TextField label={t("Description (MOTD)")} value={draft.description} onChange={(v) => update("description", v)} placeholder={t("A Minecraft Server")} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t("World folder")} value={draft.levelName} onChange={(v) => update("levelName", v)} placeholder="world" />
            <TextField label={t("Seed")} value={draft.seed} onChange={(v) => update("seed", v)} placeholder={t("Random")} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <ChoiceField
              label={t("Difficulty")}
              value={draft.difficulty}
              options={["peaceful", "easy", "normal", "hard"].map((v) => ({ value: v, label: t(v[0].toUpperCase() + v.slice(1)) }))}
              onChange={(v) => update("difficulty", v)}
            />
            <ChoiceField
              label={t("Game mode")}
              value={draft.gamemode}
              options={["survival", "creative", "adventure", "spectator"].map((v) => ({ value: v, label: t(v[0].toUpperCase() + v.slice(1)) }))}
              onChange={(v) => update("gamemode", v)}
            />
            <NumberField label={t("Max players")} value={draft.maxPlayers} min={1} max={1000} onChange={(v) => update("maxPlayers", v)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ToggleField label={t("Online mode")} hint={t("Microsoft accounts only.")} checked={draft.onlineMode} onChange={(v) => update("onlineMode", v)} />
            <ToggleField label={t("Whitelist")} checked={draft.whitelist} onChange={(v) => update("whitelist", v)} />
            <ToggleField label={t("PvP")} checked={draft.pvp} onChange={(v) => update("pvp", v)} />
            <ToggleField label={t("Hardcore")} checked={draft.hardcore} onChange={(v) => update("hardcore", v)} />
          </div>
        </section>
      </div>
    </div>
  );
}
