import { forwardRef, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Play, Settings2, Box } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { editable } from "../../lib/maker/editable";
import { part } from "../../lib/theme/parts";
import type { MinecraftLoader } from "../../lib/types";
import { MINECRAFT_LOADER_LABELS, MINECRAFT_LOADER_OPTIONS } from "../../lib/minecraftLoaders";
import { filterMinecraftVersions } from "../../lib/minecraftVersions";
import {
  useAppConfig,
  useCreateHostedServer,
  useMinecraftLoaderVersions,
  useMinecraftVersions,
} from "../../lib/queries";
import { LauncherOptionPicker } from "../ui/launcher-option-picker";
import { MinecraftVersionPicker } from "../common/MinecraftVersionPicker";
import { presetById, type ServerPreset } from "../../lib/serverPresets";

interface ServerCreatorCardProps {
  /** The preset picked on the right, applied to the form when it changes. */
  preset: ServerPreset | null;
  onDeployed?: () => void;
}

/**
 * The "New Server" card: a name, a version, a loader, Deploy.
 *
 * Picking a preset fills the form and is remembered on the server; the form
 * stays editable afterwards, so a preset is a suggestion rather than a lock.
 */
export const ServerCreatorCard = forwardRef<HTMLDivElement, ServerCreatorCardProps>(
  function ServerCreatorCard({ preset, onDeployed }, ref) {
    const { t } = useI18n();
    const { data: config } = useAppConfig();
    const { data: mcVersions } = useMinecraftVersions();
    const create = useCreateHostedServer();

    const [name, setName] = useState("");
    const [version, setVersion] = useState("");
    const [loader, setLoader] = useState<MinecraftLoader>("vanilla");
    const [loaderVersion, setLoaderVersion] = useState("");
    const [presetId, setPresetId] = useState<string | null>(null);

    const releasesOnly = config?.minecraft_releases_only ?? true;
    const versions = useMemo(
      () => filterMinecraftVersions(mcVersions?.versions ?? [], releasesOnly),
      [mcVersions?.versions, releasesOnly],
    );
    const {
      data: loaderVersions,
      isLoading: loaderVersionsLoading,
      error: loaderVersionsError,
    } = useMinecraftLoaderVersions(version, loader);

    // Latest release until someone chooses otherwise.
    useEffect(() => {
      if (versions.some((entry) => entry.id === version)) return;
      const latest = versions.find((entry) => entry.type === "release")?.id ?? versions[0]?.id;
      if (latest) setVersion(latest);
    }, [versions, version]);

    useEffect(() => {
      setLoaderVersion("");
    }, [loader, version]);

    useEffect(() => {
      if (loader === "vanilla" || !loaderVersions?.length) return;
      if (loaderVersions.some((entry) => entry.version === loaderVersion)) return;
      const preferred = loaderVersions.find((entry) => entry.stable) ?? loaderVersions[0];
      setLoaderVersion(preferred.version);
    }, [loaderVersions, loader, loaderVersion]);

    // A preset fills what it knows and leaves the version alone: the latest
    // release is right for every one of them.
    useEffect(() => {
      if (!preset) return;
      setPresetId(preset.id);
      setLoader(preset.loader);
      setName((current) => (current.trim() ? current : t(preset.name)));
    }, [preset, t]);

    const loaderReady = loader === "vanilla"
      || (!!loaderVersion && !loaderVersionsLoading && !loaderVersionsError);
    const ready = !!name.trim() && !!version && loaderReady && !create.isPending;

    const deploy = () => {
      if (!ready) return;
      create.mutate(
        {
          name: name.trim(),
          mc_version: version,
          loader,
          loader_version: loader === "vanilla" ? null : loaderVersion,
          preset: presetId,
          max_memory_mb: presetById(presetId)?.maxMemoryMb ?? null,
        },
        {
          onSuccess: () => {
            setName("");
            setPresetId(null);
            onDeployed?.();
          },
        },
      );
    };

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
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("My Awesome Server")}
                aria-label={t("Server name")}
                className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
              />
            </Row>
            {/* The row has its own icon; the picker's tag would be a second one. */}
            <Row icon={Box} label={t("Version")} className="[&_.h-8]:hidden">
              <MinecraftVersionPicker
                versions={versions}
                value={version}
                onValueChange={setVersion}
                releasesOnly={releasesOnly}
              />
            </Row>
            <Row icon={Settings2} label={t("Loader")}>
              <LauncherOptionPicker
                ariaLabel={t("Choose a loader")}
                options={MINECRAFT_LOADER_OPTIONS}
                value={loader}
                onValueChange={(value) => setLoader(value as MinecraftLoader)}
                placeholder={t("Choose a loader")}
              />
            </Row>
            {loader !== "vanilla" && (
              <Row icon={Settings2} label={`${t("Version")} ${MINECRAFT_LOADER_LABELS[loader]}`}>
                <LauncherOptionPicker
                  ariaLabel={`Choose a ${loader} version`}
                  options={(loaderVersions ?? []).map((entry) => ({
                    value: entry.version,
                    label: entry.version,
                    badge: entry.stable ? "Stable" : "Preview",
                  }))}
                  value={loaderVersion}
                  onValueChange={setLoaderVersion}
                  placeholder={t("Select a compatible loader version")}
                  loading={loaderVersionsLoading}
                  disabled={!version || !!loaderVersionsError}
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
            onClick={deploy}
            disabled={!ready}
            {...part("host.deploy")}
            {...editable("action")}
            className="kiza-action mt-2 inline-flex h-[60px] w-full items-center justify-center gap-3 rounded-xl text-xl font-bold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
          >
            {create.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
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

function Row({
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
