import { forwardRef, useEffect, useMemo } from "react";
import { Loader2, Pencil, Play, Settings2, Box } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { part } from "../../lib/theme/parts";
import type { MinecraftLoader } from "../../lib/types";
import { MINECRAFT_LOADER_LABELS, MINECRAFT_LOADER_OPTIONS } from "../../lib/minecraftLoaders";
import { filterMinecraftVersions } from "../../lib/minecraftVersions";
import { useAppConfig, useMinecraftLoaderVersions, useMinecraftVersions } from "../../lib/queries";
import { LauncherOptionPicker } from "../ui/launcher-option-picker";
import { MinecraftVersionPicker } from "../common/MinecraftVersionPicker";
import type { ServerDraft } from "../../lib/serverDraft";

interface ServerCreatorCardProps {
  draft: ServerDraft;
  update: <K extends keyof ServerDraft>(key: K, value: ServerDraft[K]) => void;
  onDeploy: () => void;
  deploying: boolean;
}

/**
 * The "New Server" card: a name, a version, a loader, Deploy.
 *
 * The rest of the draft — memory, port, world, Java — is edited in the
 * settings panel beside it; this card is the part everyone fills in.
 */
export const ServerCreatorCard = forwardRef<HTMLDivElement, ServerCreatorCardProps>(
  function ServerCreatorCard({ draft, update, onDeploy, deploying }, ref) {
    const { t } = useI18n();
    const { data: config } = useAppConfig();
    const { data: mcVersions } = useMinecraftVersions();

    const releasesOnly = config?.minecraft_releases_only ?? true;
    const versions = useMemo(
      () => filterMinecraftVersions(mcVersions?.versions ?? [], releasesOnly),
      [mcVersions?.versions, releasesOnly],
    );
    const {
      data: loaderVersions,
      isLoading: loaderVersionsLoading,
      error: loaderVersionsError,
    } = useMinecraftLoaderVersions(draft.version, draft.loader);

    // Latest release until someone chooses otherwise.
    useEffect(() => {
      if (versions.some((entry) => entry.id === draft.version)) return;
      const latest = versions.find((entry) => entry.type === "release")?.id ?? versions[0]?.id;
      if (latest) update("version", latest);
    }, [versions, draft.version, update]);

    useEffect(() => {
      if (draft.loader === "vanilla" || !loaderVersions?.length) return;
      if (loaderVersions.some((entry) => entry.version === draft.loaderVersion)) return;
      const preferred = loaderVersions.find((entry) => entry.stable) ?? loaderVersions[0];
      update("loaderVersion", preferred.version);
    }, [loaderVersions, draft.loader, draft.loaderVersion, update]);

    const loaderReady = draft.loader === "vanilla"
      || (!!draft.loaderVersion && !loaderVersionsLoading && !loaderVersionsError);
    const ready = !!draft.name.trim() && !!draft.version && loaderReady && !deploying;

    return (
      <div
        ref={ref}
        {...part("host.creator")}
        {...editable("card")}
        className="kiza-card relative flex flex-col overflow-hidden border border-primary/40 bg-card/40 shadow-[0_0_40px_-12px_hsl(var(--primary)/0.6)]"
      >
        {/* The scene behind the form: a dusk gradient with a low sun, drawn
            rather than photographed. The veil at the bottom keeps the inputs
            legible whatever the theme's primary is. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: [
              "radial-gradient(circle at 84% 15%, rgba(255,214,120,0.95) 0 4%, rgba(255,170,80,0.45) 8%, transparent 20%)",
              "linear-gradient(180deg, #0c1a2e 0%, #1c3550 24%, #6b4a52 36%, #0c0a14 46%, #0c0a14 100%)",
            ].join(","),
          }}
        />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[68%] bg-gradient-to-t from-background via-background/95 to-transparent" />

        <div className="relative flex flex-col gap-4 p-7">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.6)]" />
            {t("Create a new server")}
          </p>
          <div>
            <h2 className="text-4xl font-extrabold tracking-tight">{t("New Server")}</h2>
            <p className="mt-2 max-w-[22rem] text-base text-muted-foreground">
              {t("Set up and deploy a Minecraft server in minutes.")}
            </p>
          </div>

          <div className="mt-2 flex flex-col gap-2.5">
            <Row icon={Pencil} label={t("Server name")}>
              <input
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder={t("My Awesome Server")}
                aria-label={t("Server name")}
                className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
              />
            </Row>
            {/* The row has its own icon; the picker's tag would be a second one. */}
            <Row icon={Box} label={t("Version")} className="[&_.h-8]:hidden">
              <MinecraftVersionPicker
                versions={versions}
                value={draft.version}
                onValueChange={(value) => update("version", value)}
                releasesOnly={releasesOnly}
              />
            </Row>
            <Row icon={Settings2} label={t("Loader")}>
              <LauncherOptionPicker
                ariaLabel={t("Choose a loader")}
                options={MINECRAFT_LOADER_OPTIONS}
                value={draft.loader}
                onValueChange={(value) => {
                  update("loader", value as MinecraftLoader);
                  update("loaderVersion", "");
                }}
                placeholder={t("Choose a loader")}
              />
            </Row>
            {draft.loader !== "vanilla" && (
              <Row icon={Settings2} label={`${t("Version")} ${MINECRAFT_LOADER_LABELS[draft.loader]}`}>
                <LauncherOptionPicker
                  ariaLabel={`Choose a ${draft.loader} version`}
                  options={(loaderVersions ?? []).map((entry) => ({
                    value: entry.version,
                    label: entry.version,
                    badge: entry.stable ? "Stable" : "Preview",
                  }))}
                  value={draft.loaderVersion}
                  onValueChange={(value) => update("loaderVersion", value)}
                  placeholder={t("Select a compatible loader version")}
                  loading={loaderVersionsLoading}
                  disabled={!draft.version || !!loaderVersionsError}
                />
              </Row>
            )}
            {loaderVersionsError && (
              <p className="text-xs text-destructive">
                {t("No compatible loader version is available for this Minecraft version.")}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onDeploy}
            disabled={!ready}
            {...part("host.deploy")}
            {...editable("action")}
            className="kiza-action mt-2 inline-flex h-[60px] w-full items-center justify-center gap-3 rounded-xl text-xl font-bold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
          >
            {deploying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
            {t("Deploy")}
          </button>
          <p className="text-center text-sm text-muted-foreground">
            {t("Your server will be ready in minutes.")}
          </p>
        </div>
      </div>
    );
  },
);

export function Row({
  icon: Icon,
  label,
  className,
  children,
}: {
  icon: typeof Pencil;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border/60 bg-secondary/30 px-4 py-1.5",
        "[&_button]:border-0 [&_button]:bg-transparent [&_button]:px-0 [&_button]:hover:bg-transparent",
        className,
      )}
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="whitespace-nowrap text-base text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
