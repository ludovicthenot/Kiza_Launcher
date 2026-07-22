import { useEffect, useMemo, useRef, useState } from "react";
import {
  updateDiscordStatus,
  useAppConfig,
  useCreateMinecraftInstance,
  useInstances,
  useMinecraftLoaderVersions,
  useMinecraftVersions,
  useStartMinecraftInstall,
  useVerifyInstance,
} from "../../lib/queries";
import { InstanceCard } from "../common/InstanceCard";
import { AlertCircle, Blocks, Box, Cpu, Feather, Hammer, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { useAppStore } from "../../lib/store";
import { MINECRAFT_LOADER_OPTIONS } from "../../lib/minecraftLoaders";
import type { MinecraftLoader } from "../../lib/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Badge, Button, EmptyState, Input, Panel } from "../ui/primitives";
import { MinecraftVersionPicker } from "../common/MinecraftVersionPicker";
import { filterMinecraftVersions } from "../../lib/minecraftVersions";
import {
  filterMinecraftVersionsByJava,
  javaSelectionToMajor,
  MINECRAFT_JAVA_OPTIONS,
  type MinecraftJavaSelection,
} from "../../lib/minecraftJava";
import { LauncherOptionPicker } from "../ui/launcher-option-picker";
import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import kizaHeader from "../../assets/kiza-header.png";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";

const loaderPresentation = {
  vanilla: { icon: Box, description: "Original game" },
  fabric: { icon: Feather, description: "Lightweight mods" },
  forge: { icon: Hammer, description: "Forge ecosystem" },
} satisfies Record<MinecraftLoader, { icon: typeof Box; description: string }>;

export function LibraryView() {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: instances, isLoading, error } = useInstances();
  const verifyInstance = useVerifyInstance();
  const { data: mcVersions } = useMinecraftVersions();
  const { data: config } = useAppConfig();
  const createMinecraftInstance = useCreateMinecraftInstance();
  const startMinecraftInstall = useStartMinecraftInstall();
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);

  const [isAddingMinecraft, setIsAddingMinecraft] = useState(false);
  const [minecraftDialogOpen, setMinecraftDialogOpen] = useState(false);
  const [minecraftName, setMinecraftName] = useState("Kiza Alpha");
  const [minecraftVersion, setMinecraftVersion] = useState("");
  const [minecraftLoader, setMinecraftLoader] = useState<MinecraftLoader>("vanilla");
  const [minecraftLoaderVersion, setMinecraftLoaderVersion] = useState("");
  const [minecraftJava, setMinecraftJava] = useState<MinecraftJavaSelection>("auto");
  const {
    data: loaderVersions,
    isLoading: loaderVersionsLoading,
    error: loaderVersionsError,
  } = useMinecraftLoaderVersions(minecraftVersion, minecraftLoader);

  const minecraftInstances = useMemo(
    () => (instances ?? []).filter((instance) => instance.game_id === "minecraft"),
    [instances],
  );
  const releasesOnly = config?.minecraft_releases_only ?? true;
  const availableMinecraftVersions = useMemo(
    () => filterMinecraftVersions(
      filterMinecraftVersionsByJava(mcVersions?.versions ?? [], minecraftJava),
      releasesOnly,
    ),
    [mcVersions?.versions, minecraftJava, releasesOnly],
  );
  const loaderReady = minecraftLoader === "vanilla"
    || (!!minecraftLoaderVersion && !loaderVersionsLoading && !loaderVersionsError);

  useEffect(() => {
    updateDiscordStatus(null);
  }, []);

  useEffect(() => {
    if (availableMinecraftVersions.some((version) => version.id === minecraftVersion)) return;
    const latestRelease = availableMinecraftVersions.find((version) => version.type === "release")?.id ?? availableMinecraftVersions[0]?.id;
    if (latestRelease) setMinecraftVersion(latestRelease);
  }, [availableMinecraftVersions, minecraftVersion]);

  useEffect(() => {
    setMinecraftLoaderVersion("");
  }, [minecraftLoader, minecraftVersion]);

  useEffect(() => {
    if (minecraftLoader === "vanilla" || !loaderVersions?.length) return;
    if (loaderVersions.some((entry) => entry.version === minecraftLoaderVersion)) return;
    const preferred = loaderVersions.find((entry) => entry.stable) ?? loaderVersions[0];
    setMinecraftLoaderVersion(preferred.version);
  }, [loaderVersions, minecraftLoader, minecraftLoaderVersion]);

  // Entrance: header slides down, feature panels cascade in. Runs once the
  // instance list has loaded (the container does not exist while loading).
  useGSAP(() => {
    if (isLoading || error || prefersReducedMotion()) return;
    gsap.timeline({ defaults: { ease: "power3.out" } })
      .from('[data-anim="header"]', { y: -14, opacity: 0, duration: 0.5 })
      .from('[data-anim="panels"] > *', { y: 12, opacity: 0, duration: 0.4, stagger: 0.08 }, "-=0.25");
  }, { dependencies: [isLoading, error != null], scope: containerRef });

  // Instance cards cascade with a slight scale pop whenever the list changes.
  useGSAP(() => {
    if (isLoading || error || prefersReducedMotion() || minecraftInstances.length === 0) return;
    gsap.from(".kiza-card-enter", {
      y: 16,
      opacity: 0,
      scale: 0.97,
      duration: 0.45,
      ease: "power3.out",
      stagger: 0.06,
      delay: 0.2,
      overwrite: "auto",
      clearProps: "transform,opacity",
    });
  }, { dependencies: [isLoading, minecraftInstances.length], scope: containerRef });

  const handleCreateMinecraft = async () => {
    if (!minecraftName.trim() || !minecraftVersion.trim()) return;

    try {
      setIsAddingMinecraft(true);
      const instance = await createMinecraftInstance.mutateAsync({
        displayName: minecraftName.trim(),
        mcVersion: minecraftVersion.trim(),
        loader: minecraftLoader,
        loaderVersion: minecraftLoader === "vanilla" ? null : minecraftLoaderVersion,
        javaMajor: javaSelectionToMajor(minecraftJava),
      });

      await startMinecraftInstall.mutateAsync(instance.id);
      setSelectedInstanceId(instance.id);
      setMinecraftDialogOpen(false);
    } finally {
      setIsAddingMinecraft(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-destructive">
        <AlertCircle className="mb-4 h-12 w-12" />
        <p className="text-lg font-medium">{t("Failed to load instances")}</p>
        <p className="text-sm opacity-80">{String(error)}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-6 sm:p-8">
      <Dialog modal={false} open={minecraftDialogOpen} onOpenChange={setMinecraftDialogOpen}>
        {minecraftDialogOpen && (
          <div
            aria-hidden="true"
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            onPointerDown={() => setMinecraftDialogOpen(false)}
          />
        )}
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Create a Minecraft instance")}</DialogTitle>
            <DialogDescription>
              {t("Create an isolated Minecraft instance with the modloader you choose.")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Instance name")}</label>
              <Input value={minecraftName} onChange={(event) => setMinecraftName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Java runtime")}</label>
              <LauncherOptionPicker
                ariaLabel="Choose a Java runtime"
                options={MINECRAFT_JAVA_OPTIONS}
                value={minecraftJava}
                onValueChange={(value) => setMinecraftJava(value as MinecraftJavaSelection)}
                placeholder="Select Java"
              />
              <p className="text-xs text-muted-foreground">
                {t("The Minecraft catalog below only shows versions compatible with this Java choice.")}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Minecraft version")}</label>
              <MinecraftVersionPicker
                versions={availableMinecraftVersions}
                value={minecraftVersion}
                onValueChange={setMinecraftVersion}
                releasesOnly={releasesOnly}
              />
              <p className="text-xs text-muted-foreground">
                {releasesOnly ? t("Stable releases only.") : t("Stable releases, snapshots and previews.")} {minecraftJava === "auto" ? t("Java is selected automatically.") : `Java ${minecraftJava}.`}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("Modloader")}</label>
              <div className="grid grid-cols-3 gap-2">
                {MINECRAFT_LOADER_OPTIONS.map((loader) => (
                  <button
                    key={loader.value}
                    type="button"
                    aria-pressed={minecraftLoader === loader.value}
                    onClick={() => setMinecraftLoader(loader.value)}
                    className={cn(
                      "flex min-h-20 flex-col items-start justify-between rounded-lg border p-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.96]",
                      minecraftLoader === loader.value
                        ? "border-primary/55 bg-primary/12 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.05)]"
                        : "border-border bg-secondary/20 hover:border-primary/25 hover:bg-secondary/40",
                    )}
                  >
                    {(() => {
                      const Icon = loaderPresentation[loader.value].icon;
                      return <Icon className={cn("h-4 w-4", minecraftLoader === loader.value ? "text-primary" : "text-muted-foreground")} />;
                    })()}
                    <span>
                      <span className="block text-sm font-semibold">{loader.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{t(loaderPresentation[loader.value].description)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {minecraftLoader !== "vanilla" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("Version")} {minecraftLoader === "fabric" ? "Fabric" : "Forge"}</label>
                <LauncherOptionPicker
                  ariaLabel={`Choose a ${minecraftLoader} version`}
                  options={(loaderVersions ?? []).map((entry) => ({
                    value: entry.version,
                    label: entry.version,
                    badge: entry.stable ? "Stable" : "Preview",
                  }))}
                  value={minecraftLoaderVersion}
                  onValueChange={setMinecraftLoaderVersion}
                  placeholder="Select a compatible loader version"
                  loading={loaderVersionsLoading}
                  disabled={!minecraftVersion || !!loaderVersionsError}
                />
                {loaderVersionsError && (
                  <p className="text-xs text-destructive">
                    {t("No compatible loader version is available for this Minecraft version.")}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setMinecraftDialogOpen(false)}>{t("Cancel")}</Button>
            <Button
              onClick={handleCreateMinecraft}
              disabled={isAddingMinecraft || !minecraftName.trim() || !minecraftVersion.trim() || !loaderReady}
              variant="primary"
            >
              {isAddingMinecraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Blocks className="h-4 w-4" />}
              {t("Create and install")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div data-anim="header" className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <img
              src={kizaHeader}
              alt="Kiza Launcher"
              className="h-20 w-auto select-none sm:h-24"
              draggable={false}
            />
            <Badge className="h-6 rounded-full border-primary/30 bg-primary/10 text-primary">{t("Minecraft only")}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("Create isolated Vanilla, Fabric or Forge instances and add the mods you choose.")}
          </p>
        </div>

        <Button
          onClick={() => setMinecraftDialogOpen(true)}
          disabled={isAddingMinecraft || createMinecraftInstance.isPending}
          variant="primary"
          className="shrink-0"
        >
          {isAddingMinecraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Blocks className="h-4 w-4" />}
          {t("New instance")}
        </Button>
      </div>

      <div data-anim="panels" className="mb-6 grid gap-3 md:grid-cols-3">
        <Panel className="p-4">
          <div className="flex items-center gap-3">
            <Rocket className="h-5 w-5 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t("Optimized launch")}</div>
              <div className="truncate text-xs text-muted-foreground">{t("VSync off, FPS options, managed Java.")}</div>
            </div>
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center gap-3">
            <Cpu className="h-5 w-5 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t("Modloader choice")}</div>
              <div className="truncate text-xs text-muted-foreground">{t("Vanilla, Fabric or Forge per instance.")}</div>
            </div>
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t("Isolated instances")}</div>
              <div className="truncate text-xs text-muted-foreground">{t("The official launcher is never touched.")}</div>
            </div>
          </div>
        </Panel>
      </div>

      {minecraftInstances.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {minecraftInstances.map((instance) => (
            <InstanceCard
              key={instance.id}
              instance={instance}
              className="kiza-card-enter"
              onClick={() => setSelectedInstanceId(instance.id)}
              onVerify={(event) => {
                event.stopPropagation();
                verifyInstance.mutate(instance.id);
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          className="min-h-[360px]"
          title={t("No Minecraft instance")}
          description={t("Create your first isolated Minecraft instance and choose Vanilla, Fabric or Forge.")}
        />
      )}
    </div>
  );
}
