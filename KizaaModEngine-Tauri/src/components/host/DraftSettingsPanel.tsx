import { useState } from "react";
import { ChevronDown, ImageIcon, X } from "lucide-react";
import { cn } from "../../lib/utils";
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
 * Everything about a new server the card does not ask, in the order people
 * change it: the world as `server.properties` will describe it on the first
 * start, then the machine — memory, Java, the port — folded under one line
 * that says what it holds, since the defaults suit most servers.
 */
export function DraftSettingsPanel({ draft, update }: DraftSettingsPanelProps) {
  const { t } = useI18n();
  const [machineOpen, setMachineOpen] = useState(false);

  const pickIcon = async () => {
    const selected = await openFileDialog({ multiple: false, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (typeof selected === "string") update("iconPath", selected);
  };

  const javaLabel = draft.javaMajor == null ? t("Java automatic") : `Java ${draft.javaMajor}`;
  const machineSummary = `${draft.maxMemoryMb} MB · ${javaLabel} · ${t("Port")} ${draft.port}`;

  return (
    <div {...editable("panel")} className="kiza-panel overflow-hidden border border-transparent bg-card/50 [&_.kiza-input]:border-transparent [&_.kiza-input]:bg-secondary/45 [&_.kiza-input:focus]:bg-secondary/60 [&_select]:border-transparent [&_select]:bg-secondary/45">
      <section className="flex flex-col gap-4 p-6">
        <h3 className="text-[0.8125rem] font-semibold text-foreground/90">{t("World")}</h3>
        <TextField label={t("Description (MOTD)")} value={draft.description} onChange={(v) => update("description", v)} placeholder={t("A Minecraft Server")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t("World folder")} value={draft.levelName} onChange={(v) => update("levelName", v)} placeholder="world" />
          <TextField label={t("Seed")} value={draft.seed} onChange={(v) => update("seed", v)} placeholder={t("Random")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
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
        <div className="grid gap-2 sm:grid-cols-2">
          <ToggleField label={t("Online mode")} hint={t("Microsoft accounts only.")} checked={draft.onlineMode} onChange={(v) => update("onlineMode", v)} />
          <ToggleField label={t("Whitelist")} checked={draft.whitelist} onChange={(v) => update("whitelist", v)} />
          <ToggleField label={t("PvP")} checked={draft.pvp} onChange={(v) => update("pvp", v)} />
          <ToggleField label={t("Hardcore")} checked={draft.hardcore} onChange={(v) => update("hardcore", v)} />
        </div>
      </section>

      <section className="border-t border-border/40">
        <button
          type="button"
          aria-expanded={machineOpen}
          onClick={() => setMachineOpen((open) => !open)}
          className="flex min-h-14 w-full items-center gap-3 px-6 text-left transition-colors duration-150 hover:bg-secondary/[0.18] active:bg-secondary/[0.28]"
        >
          <span className="text-[0.8125rem] font-semibold text-foreground/90">{t("Machine and network")}</span>
          <span className="min-w-0 flex-1 truncate text-right text-[0.8125rem] tabular-nums text-muted-foreground">{machineSummary}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-drawer", machineOpen && "rotate-180")} />
        </button>
        {/* Rows from 0fr to 1fr: the height follows the content, eased. */}
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-[350ms] ease-drawer motion-reduce:transition-none",
            machineOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
          inert={!machineOpen}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-4 px-6 pb-6 pt-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField label={t("Memory")} value={draft.maxMemoryMb} min={512} step={512} unit="MB" onChange={(v) => update("maxMemoryMb", v)} />
                <NumberField label={t("Minimum")} value={draft.minMemoryMb} min={256} step={256} unit="MB" onChange={(v) => update("minMemoryMb", v)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
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
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
