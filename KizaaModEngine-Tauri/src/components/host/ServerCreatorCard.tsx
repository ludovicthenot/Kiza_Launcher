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
import { presetById } from "../../lib/serverPresets";

interface ServerCreatorCardProps {
  draft: ServerDraft;
  update: <K extends keyof ServerDraft>(key: K, value: ServerDraft[K]) => void;
  onDeploy: () => void;
  deploying: boolean;
}

/**
 * The "New Server" banner: a name, a version, a loader, Deploy.
 *
 * The server as it will be, drawn as it is filled in: the preset's scene,
 * the name typed as its title, what it runs as pills. The rest of the
 * draft -- the world, memory, port, Java -- is edited below it; this is the
 * part everyone fills in.
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

    const preset = presetById(draft.presetId);
    const [ground, sky, light] = preset?.scene ?? ["#120a24", "#4c1d95", "#a78bfa"];
    const loaderReady = draft.loader === "vanilla"
      || (!!draft.loaderVersion && !loaderVersionsLoading && !loaderVersionsError);
    const ready = !!draft.name.trim() && !!draft.version && loaderReady && !deploying;

    return (
      <div
        ref={ref}
        {...part("host.creator")}
        {...editable("card")}
        className="kiza-card relative overflow-hidden border shadow-[0_24px_60px_-30px_hsl(0_0%_0%/0.9)]"
      >
        {/* The server as it will be: the preset's scene behind its name. */}
        <div
          key={draft.presetId ?? "none"}
          aria-hidden
          className="absolute inset-0 animate-in fade-in-0 duration-500 motion-reduce:animate-none"
          style={{
            backgroundImage: [
              `radial-gradient(ellipse at 85% 0%, ${light}b3 0%, transparent 50%)`,
              `linear-gradient(180deg, ${sky} 0%, ${ground} 100%)`,
            ].join(","),
          }}
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-card via-card/75 to-card/10" />

        <div className="relative flex flex-wrap items-end gap-x-6 gap-y-5 px-6 pb-6 pt-12">
          <div className="flex min-w-0 flex-1 basis-[420px] items-end gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[16px] bg-background/55 text-primary shadow-[0_12px_28px_-12px_hsl(0_0%_0%/0.8)] ring-1 ring-white/10 backdrop-blur-md">
              <ServerIcon className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-foreground/60">{t("New Server")}</span>
              {/* The name is the title: typed where it will be read. */}
              <input
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder={t("Name your server")}
                aria-label={t("Server name")}
                className="block w-full border-b border-transparent bg-transparent pb-0.5 text-[1.75rem] font-semibold leading-tight tracking-[-0.025em] outline-none transition-colors duration-150 placeholder:text-foreground/35 hover:border-white/15 focus:border-primary/70"
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-1.5">
            <button
              type="button"
              onClick={onDeploy}
              disabled={!ready}
              {...part("host.deploy")}
              {...editable("action")}
              className="kiza-action inline-flex h-12 min-w-[180px] items-center justify-center gap-2.5 rounded-xl px-6 text-base font-semibold text-primary-foreground shadow-[0_10px_30px_-12px_hsl(var(--primary)/0.9)] transition-[filter,transform,opacity,box-shadow] duration-150 hover:brightness-110 active:scale-[0.97] disabled:opacity-45 disabled:shadow-none"
            >
              {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              {t("Deploy")}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              {draft.name.trim() ? t("Your server will be ready in minutes.") : t("Give it a name to deploy it.")}
            </p>
          </div>

          {/* What it runs: one pill each, the picker inside it. */}
          <div className="flex w-full flex-wrap items-center gap-2">
            <Chip icon={Box} label={t("Version")} className="[&_.h-8]:hidden">
              <MinecraftVersionPicker
                versions={versions}
                value={draft.version}
                onValueChange={(value) => update("version", value)}
                releasesOnly={releasesOnly}
              />
            </Chip>
            <Chip icon={Settings2} leading={<LoaderLogo loader={draft.loader} className="h-4 w-4 rounded-[4px] shadow-none" />} label={t("Loader")}>
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
            </Chip>
            {draft.loader !== "vanilla" && (
              <Chip icon={Settings2} label={MINECRAFT_LOADER_LABELS[draft.loader]}>
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
              </Chip>
            )}
            {loaderVersionsError && (
              <p className="w-full px-1 text-xs text-red-300">
                {t("No compatible loader version is available for this Minecraft version.")}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  },
);

/** A setting as a pill on the banner: its mark, its name, its picker. */
function Chip({
  icon: Icon,
  leading,
  label,
  className,
  children,
}: {
  icon: typeof Pencil;
  /** Drawn instead of the icon, for a setting with a mark of its own. */
  leading?: React.ReactNode;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-11 min-w-0 items-center gap-2.5 rounded-xl bg-background/45 pl-3.5 pr-2 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.08)] backdrop-blur-md transition-colors duration-150 hover:bg-background/60",
        // The pickers sit in the pill as plain values with their chevron:
        // the pill is the control, not a box inside a box.
        "[&_button]:min-h-0 [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-1 [&_button]:shadow-none [&_button]:hover:bg-transparent",
        className,
      )}
    >
      {leading ?? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <span className="whitespace-nowrap text-[0.8125rem] text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
