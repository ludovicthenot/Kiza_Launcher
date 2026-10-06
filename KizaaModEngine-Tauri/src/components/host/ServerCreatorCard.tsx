import { forwardRef, useEffect, useMemo } from "react";
import { Loader2, Pencil, Play, Settings2, Box, Server as ServerIcon } from "lucide-react";
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
import { LoaderLogo } from "../common/LoaderLogo";

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
        className="kiza-card relative flex flex-col overflow-hidden border bg-card/60 shadow-[0_24px_60px_-30px_hsl(0_0%_0%/0.9)]"
      >
        <div className="relative flex flex-col gap-5 p-6">
          <div className="flex items-center gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-primary/20 text-primary">
              <ServerIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight">{t("New Server")}</h2>
              <p className="text-[0.8125rem] text-muted-foreground">
                {t("Set up and deploy a Minecraft server in minutes.")}
              </p>
            </div>
          </div>

          {/* One grouped list: a label on the left, its control on the right. */}
          <div className="divide-y divide-border/40 rounded-xl bg-secondary/[0.32] px-4 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)]">
            <Row icon={Pencil} label={t("Name")}>
              <input
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder={t("My Awesome Server")}
                aria-label={t("Server name")}
                className="h-11 w-full bg-transparent text-right text-[0.8438rem] outline-none placeholder:text-muted-foreground/60"
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
            <Row icon={Settings2} leading={<LoaderLogo loader={draft.loader} className="h-4 w-4 rounded-[4px] shadow-none" />} label={t("Loader")}>
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
              <Row icon={Settings2} label={MINECRAFT_LOADER_LABELS[draft.loader]}>
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
          </div>
          {loaderVersionsError && (
            <p className="-mt-2 px-1 text-xs text-red-300">
              {t("No compatible loader version is available for this Minecraft version.")}
            </p>
          )}

          <div>
            <button
              type="button"
              onClick={onDeploy}
              disabled={!ready}
              {...part("host.deploy")}
              {...editable("action")}
              className="kiza-action inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-xl text-base font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              {t("Deploy")}
            </button>
            <p className="mt-2.5 text-center text-xs text-muted-foreground">
              {t("Your server will be ready in minutes.")}
            </p>
          </div>
        </div>
      </div>
    );
  },
);

export function Row({
  icon: Icon,
  leading,
  label,
  className,
  children,
}: {
  icon: typeof Pencil;
  /** Drawn instead of the icon, for a row with a mark of its own. */
  leading?: React.ReactNode;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid min-h-12 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2.5",
        // The pickers sit in the row as plain values, right-aligned, with
        // their chevron: the row is the control, not a box inside a box.
        "[&_button]:min-h-0 [&_button]:justify-end [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-0 [&_button]:text-right [&_button]:shadow-none [&_button]:hover:bg-transparent",
        className,
      )}
    >
      {leading ?? <Icon className="h-4 w-4 text-muted-foreground" />}
      <span className="whitespace-nowrap text-[0.8438rem] text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
