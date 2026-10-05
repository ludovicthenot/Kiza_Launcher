import { useRef } from "react";
import { Box, FolderInput, Sparkles } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { useAppStore, type CreatorSource } from "../../lib/store";
import { useCreateHostedServer } from "../../lib/hostQueries";
import { applyPreset, draftToRequest, useServerDraft } from "../../lib/serverDraft";
import { presetById } from "../../lib/serverPresets";
import { ServerCreatorCard } from "./ServerCreatorCard";
import { ServerPresetGrid } from "./ServerPresetGrid";
import { DraftSettingsPanel } from "./DraftSettingsPanel";
import { InstanceSourcePanel } from "./InstanceSourcePanel";
import { ImportSourcePanel } from "./ImportSourcePanel";
import { SlidingPill } from "../ui/sliding-pill";

/**
 * Servers → Creator.
 *
 * Three ways in, one row of buttons: from scratch (the card, the presets
 * and the settings), from an instance (Kiza reads it and keeps what a
 * server needs), or a folder that already holds a server.
 */
export function CreatorPage() {
  const { t } = useI18n();
  const source = useAppStore((state) => state.creatorSource);
  const setCreatorSource = useAppStore((state) => state.setCreatorSource);

  const sources: Array<{ id: CreatorSource; label: string; icon: typeof Box }> = [
    { id: "scratch", label: t("From scratch"), icon: Sparkles },
    { id: "instance", label: t("From an instance"), icon: Box },
    { id: "import", label: t("Import a folder"), icon: FolderInput },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label={t("Where the server starts from")} className="relative flex shrink-0 items-center rounded-xl bg-secondary/45 p-1 h-10 self-start">
        <SlidingPill value={source} className="rounded-[9px]" />
        {sources.map((entry) => {
          const active = entry.id === source;
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCreatorSource(entry.id)}
              data-active={active}
              className={cn(
                "relative z-[1] inline-flex h-full items-center gap-2 rounded-[9px] px-4 text-[13px] font-medium transition-colors duration-200",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {entry.label}
            </button>
          );
        })}
      </div>

      {source === "scratch" && <ScratchCreator />}
      {source === "instance" && <InstanceSourcePanel />}
      {source === "import" && <ImportSourcePanel />}
    </div>
  );
}

function ScratchCreator() {
  const { t } = useI18n();
  const creatorRef = useRef<HTMLDivElement>(null);
  const { draft, update, setDraft, reset } = useServerDraft();
  const create = useCreateHostedServer();
  const setSelectedServerId = useAppStore((state) => state.setSelectedServerId);

  const focusCreator = () => {
    creatorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    creatorRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  };

  const deploy = () => {
    create.mutate(draftToRequest(draft), {
      onSuccess: (server) => {
        reset();
        setSelectedServerId(server.id);
      },
    });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] xl:gap-8">
      <div data-anim="creator" className="xl:sticky xl:top-0 xl:self-start">
        <ServerCreatorCard ref={creatorRef} draft={draft} update={update} onDeploy={deploy} deploying={create.isPending} />
      </div>

      <div className="flex min-w-0 flex-col gap-8">
        <section>
          <h2 className="text-xl font-semibold tracking-tight">{t("Choose a preset")}</h2>
          <p className="mb-4 mt-0.5 text-[13.5px] text-muted-foreground">
            {t("Start with a template and get the perfect setup for your server.")}
          </p>
          <ServerPresetGrid
            selectedId={draft.presetId}
            onPick={(picked) => {
              setDraft((current) => ({
                ...applyPreset(current, picked),
                name: current.name.trim() ? current.name : t(picked.name),
              }));
              focusCreator();
            }}
          />
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">{t("Server settings")}</h2>
          <p className="mb-4 mt-0.5 text-[13.5px] text-muted-foreground">
            {presetById(draft.presetId)
              ? t("Filled by the preset; change what you like.")
              : t("Memory, Java, the port, and the world as it will be generated.")}
          </p>
          <DraftSettingsPanel draft={draft} update={update} />
        </section>
      </div>
    </div>
  );
}
