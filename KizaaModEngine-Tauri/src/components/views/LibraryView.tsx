import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  updateDiscordStatus,
  useAppConfig,
  useCreateMinecraftInstance,
  useInstances,
  useMinecraftLoaderVersions,
  useKizafluxStatus,
  useMinecraftVersions,
  useStartMinecraftInstall,
  useVerifyInstance,
  useImportInstance,
  useImportProgress,
  useLaunchMinecraft,
  useMinecraftAccount,
  useInstanceCover,
  useOpenInstanceFolder,
  usePlayHistory,
  useRenameInstance,
  useDeleteInstance,
  useDeleteInstances,
  useSetInstanceCover,
} from "../../lib/queries";
import { InstanceContextMenu } from "../library/InstanceContextMenu";
import { ConfirmActionDialog } from "../ui/confirm-action-dialog";
import { InstancePoster } from "../common/InstancePoster";
import { LibraryModeSwitch } from "../common/LibraryModeSwitch";
import { FilterMenu, ToolbarSearch } from "../common/Toolbar";
import { ExportInstanceDialog } from "../instance/ExportInstanceDialog";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Server,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
  PackageSearch,
  Coffee,
  Zap,
  FolderPlus,
  FolderMinus,
  FolderClosed,
  X,
} from "lucide-react";
import { useAppStore } from "../../lib/store";
import { useMissingMods } from "../../lib/missingMods";
import { LighterPackDialog } from "../common/LighterPackDialog";
import { ImportFromLauncherDialog } from "../common/ImportFromLauncherDialog";
import { ModpackCatalogueDialog } from "../common/ModpackCatalogueDialog";
import type { OfficialPack } from "../../lib/queries";
import { MINECRAFT_LOADER_LABELS, MINECRAFT_LOADER_OPTIONS } from "../../lib/minecraftLoaders";
import type { MinecraftEngine, MinecraftLoader } from "../../lib/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button, EmptyState, Input } from "../ui/primitives";
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
import { editable } from "../../lib/maker/editable";
import { part } from "../../lib/theme/parts";
import { useI18n } from "../../lib/i18n";
import { arrivingSideways, gsap, Flip, useGSAP, prefersReducedMotion, staggerFor } from "../../lib/animation";
import { groupKey, groupOfKey, useCardDrag, type MergeTarget } from "../../lib/cardDrag";
import { popGroup } from "../../lib/groupMotion";
import { createTrashCan } from "../../lib/trashCan";
import { useInstanceGroups, type InstanceGroup } from "../../lib/instanceGroups";
import { GroupTray, InstanceGroupCard } from "../common/InstanceGroupCard";
import { GroupEditorDialog } from "../common/GroupEditorDialog";
import { toast } from "sonner";
import { Skeleton, SkeletonGrid } from "../ui/skeleton";
import { ProgressRing } from "../ui/progress";
import { LoaderLogo } from "../common/LoaderLogo";
import { PartIcon, PartLabel } from "../common/PartContent";

const loaderPresentation = {
  vanilla: { description: "Original game" },
  fabric: { description: "Lightweight mods" },
  forge: { description: "Forge ecosystem" },
  neoforge: { description: "Modern Forge fork" },
} satisfies Record<MinecraftLoader, { description: string }>;

/** Told once per page load: the moment the library is really on screen. */
let interfaceReadyReported = false;

export function LibraryView() {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: instances, isLoading, error } = useInstances();
  useEffect(() => {
    if (interfaceReadyReported || isLoading || !instances) return;
    interfaceReadyReported = true;
    // After paint, so the figure is the one a person would measure.
    requestAnimationFrame(() => {
      void invoke("interface_ready", { pageMs: performance.now() }).catch(() => undefined);
    });
  }, [isLoading, instances]);
  const verifyInstance = useVerifyInstance();
  const { data: mcVersions } = useMinecraftVersions();
  const { data: config } = useAppConfig();
  const createMinecraftInstance = useCreateMinecraftInstance();
  const startMinecraftInstall = useStartMinecraftInstall();
  const importInstance = useImportInstance();
  // An import that weighs a third of the official release, waiting on a decision.
  const [lighterPack, setLighterPack] = useState<{ instanceId: string; official: OfficialPack } | null>(null);
  // The Import button opens a small menu: a file, or another launcher.
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [importFromLauncherOpen, setImportFromLauncherOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!importMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!importMenuRef.current?.contains(event.target as Node)) setImportMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImportMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [importMenuOpen]);
  const { data: importProgress } = useImportProgress(importInstance.isPending);
  // Kept after the mutation settles: these are mods to go and fetch by hand,
  // and the window has to stay on screen long enough to do it.
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);
  const openServerCreatorFor = useAppStore((state) => state.openServerCreatorFor);
  const [exportInstanceId, setExportInstanceId] = useState<string | null>(null);
  const openInstanceFolder = useOpenInstanceFolder();
  const launchMinecraft = useLaunchMinecraft();
  const { data: minecraftAccount } = useMinecraftAccount();
  const { data: playHistory } = usePlayHistory();

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // The order is the viewer's own, kept between sessions: "custom" is the
  // order cards were dragged into (lib/cardDrag), newest unknown ones first.
  const [sortBy, setSortByState] = useState<LibrarySort>(() => readStored(SORT_KEY, "recent") as LibrarySort);
  const [customOrder, setCustomOrder] = useState<string[]>(() => {
    try {
      return JSON.parse(readStored(ORDER_KEY, "[]")) as string[];
    } catch {
      return [];
    }
  });
  const setSortBy = (next: LibrarySort) => {
    setSortByState(next);
    writeStored(SORT_KEY, next);
  };
  // The multiple choice made with Ctrl (or Cmd) and a click.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [deletingMany, setDeletingMany] = useState<string[] | null>(null);
  // A group's right-click menu, and the group being edited.
  const [groupMenu, setGroupMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const deleteInstances = useDeleteInstances();
  const groups = useInstanceGroups((state) => state.groups);
  // The order shown while a card is held; null otherwise.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // The grid is drawn only once there are instances: what needs it (the
  // drag, the column count) waits for it rather than for the page.
  const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null);
  const attachGrid = useCallback((element: HTMLDivElement | null) => {
    gridRef.current = element;
    setGridElement(element);
  }, []);
  // How many columns the grid has now: an open group takes as many as it
  // needs, up to a row.
  const [gridColumns, setGridColumns] = useState(4);
  useLayoutEffect(() => {
    const grid = gridElement;
    if (!grid) return;
    const measure = () => setGridColumns(Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [gridElement]);
  const [loaderFilter, setLoaderFilter] = useState("all");
  const [footerMenuOpen, setFooterMenuOpen] = useState(false);
  // The archive being imported, for the card that stands in for it.
  const [importingFile, setImportingFile] = useState<string | null>(null);
  // The right-click menu, and the two things it can open.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const renameInstance = useRenameInstance();
  const deleteInstance = useDeleteInstance();
  const setCover = useSetInstanceCover();

  const [isAddingMinecraft, setIsAddingMinecraft] = useState(false);
  const [minecraftDialogOpen, setMinecraftDialogOpen] = useState(false);
  const [modpackCatalogueOpen, setModpackCatalogueOpen] = useState(false);
  const [minecraftName, setMinecraftName] = useState("Kiza Alpha");
  const [minecraftVersion, setMinecraftVersion] = useState("");
  const [minecraftLoader, setMinecraftLoader] = useState<MinecraftLoader>("vanilla");
  const [minecraftLoaderVersion, setMinecraftLoaderVersion] = useState("");
  // Kizaflux plays vanilla, on the versions its engine is: any other choice
  // puts the instance back on Java.
  const [minecraftEngine, setMinecraftEngine] = useState<MinecraftEngine>("java");
  const { data: kizaflux } = useKizafluxStatus();
  const kizafluxVersions = useMemo(
    () => (kizaflux?.available ? kizaflux.minecraft_versions : []),
    [kizaflux],
  );
  const [minecraftJava, setMinecraftJava] = useState<MinecraftJavaSelection>("auto");
  const {
    data: loaderVersions,
    isLoading: loaderVersionsLoading,
    error: loaderVersionsError,
  } = useMinecraftLoaderVersions(minecraftVersion, minecraftLoader);

  // Deleted, but the list has not been read again yet: not drawn meanwhile,
  // or a card that just left (or left its group) would show up again.
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const minecraftInstances = useMemo(
    () => (instances ?? []).filter((instance) => instance.game_id === "minecraft" && !gone.has(instance.id)),
    [instances, gone],
  );
  /**
   * The card the footer describes and the Play button belongs to.
   *
   * Defaults to the most recently played instance rather than the first in the
   * list: reopening the launcher to play again is the common case, and it
   * should already be the one under the cursor.
   */
  const orderedInstances = useMemo(() => {
    const sorted = [...minecraftInstances];
    if (sortBy === "custom") {
      const rank = new Map(customOrder.map((id, index) => [id, index]));
      const recency = (id: string) => playHistory?.[id] ?? "";
      sorted.sort((left, right) => {
        const a = rank.get(left.id);
        const b = rank.get(right.id);
        // A card never placed by hand (a new instance) comes first.
        if (a === undefined || b === undefined) {
          if (a !== b) return a === undefined ? -1 : 1;
          return recency(right.id).localeCompare(recency(left.id));
        }
        return a - b;
      });
    } else if (sortBy === "name") {
      sorted.sort((left, right) => left.display_name.localeCompare(right.display_name));
    } else {
      sorted.sort((left, right) => {
        const leftPlayed = playHistory?.[left.id] ?? "";
        const rightPlayed = playHistory?.[right.id] ?? "";
        // Never played sorts last, whatever its name.
        if (leftPlayed !== rightPlayed) return rightPlayed.localeCompare(leftPlayed);
        return left.display_name.localeCompare(right.display_name);
      });
    }
    return sorted;
  }, [minecraftInstances, playHistory, sortBy, customOrder]);

  const visibleInstances = useMemo(() => {
    if (dragOrder) {
      const byId = new Map(orderedInstances.map((instance) => [instance.id, instance]));
      return dragOrder.flatMap((id) => byId.get(id) ?? []);
    }
    const needle = query.trim().toLowerCase();
    return orderedInstances.filter(
      (instance) =>
        (!needle || instance.display_name.toLowerCase().includes(needle)) &&
        (loaderFilter === "all" || (instance.minecraft?.loader ?? "vanilla") === loaderFilter),
    );
  }, [orderedInstances, query, loaderFilter, dragOrder]);

  /**
   * The grid as drawn: each group as one folder card where its first
   * instance would be, followed by its instances when it is open; the
   * instances in no group as they are.
   */
  /** A group's instances that still exist, in its order. */
  const membersOf = (group: InstanceGroup) => {
    const byId = new Map(minecraftInstances.map((instance) => [instance.id, instance]));
    return group.ids.flatMap((id) => byId.get(id) ?? []);
  };
  const editingGroup = groups.find((group) => group.id === editingGroupId) ?? null;
  const groupOf = useMemo(() => {
    const map = new Map<string, InstanceGroup>();
    for (const group of groups) for (const id of group.ids) map.set(id, group);
    return map;
  }, [groups]);
  type GridItem =
    | { kind: "instance"; instance: (typeof visibleInstances)[number] }
    | { kind: "group" | "tray"; group: InstanceGroup; members: typeof visibleInstances };
  const gridItems = useMemo(() => {
    const byId = new Map(visibleInstances.map((instance) => [instance.id, instance]));
    const placed = new Set<string>();
    const items: GridItem[] = [];
    for (const instance of visibleInstances) {
      const group = groupOf.get(instance.id);
      if (!group) {
        items.push({ kind: "instance", instance });
        continue;
      }
      if (placed.has(group.id)) continue;
      placed.add(group.id);
      const members = group.ids.flatMap((id) => byId.get(id) ?? []);
      items.push({ kind: group.open ? "tray" : "group", group, members });
    }
    return items;
  }, [visibleInstances, groupOf]);

  const focused = orderedInstances.find((instance) => instance.id === focusedId) ?? null;

  useEffect(() => {
    if (focused || orderedInstances.length === 0) return;
    setFocusedId(orderedInstances[0].id);
  }, [focused, orderedInstances]);

  const lastPlayedLabel = useMemo(() => {
    const played = focused ? playHistory?.[focused.id] : undefined;
    if (!played) return t("Never played");
    const elapsed = Date.now() - new Date(played).getTime();
    const hours = Math.round(elapsed / 3_600_000);
    // The tile already says "Last played"; the value is only the when.
    if (hours < 1) return t("Just now");
    if (hours < 24) return t("{count} h ago").replace("{count}", String(hours));
    const days = Math.round(hours / 24);
    return t("{count} d ago").replace("{count}", String(days));
  }, [focused, playHistory, t]);

  /**
   * Launches straight from the library when there is an account to launch with.
   *
   * Without one there is a name to choose and an offline profile to pick, and
   * guessing either would start the game as somebody the player is not — so the
   * instance opens instead, where that choice lives.
   */
  const play = (instance: (typeof orderedInstances)[number]) => {
    if (!minecraftAccount) {
      setSelectedInstanceId(instance.id);
      return;
    }
    launchMinecraft.mutate({
      instanceId: instance.id,
      username: minecraftAccount.username,
      offline: false,
    });
  };

  const releasesOnly = config?.minecraft_releases_only ?? true;
  const availableMinecraftVersions = useMemo(
    () => filterMinecraftVersions(
      filterMinecraftVersionsByJava(mcVersions?.versions ?? [], minecraftJava),
      releasesOnly,
    ),
    [mcVersions?.versions, minecraftJava, releasesOnly],
  );
  // On Rust the list is the engine's versions: Kizaflux picks its own Java,
  // so the Java filter does not apply.
  const versionChoices = useMemo(
    () => minecraftEngine === "kizaflux"
      ? (mcVersions?.versions ?? []).filter((version) => kizafluxVersions.includes(version.id))
      : availableMinecraftVersions,
    [minecraftEngine, mcVersions?.versions, kizafluxVersions, availableMinecraftVersions],
  );
  useEffect(() => {
    if (minecraftEngine !== "kizaflux") return;
    if (minecraftLoader !== "vanilla" || !kizafluxVersions.includes(minecraftVersion)) setMinecraftEngine("java");
  }, [minecraftEngine, minecraftLoader, minecraftVersion, kizafluxVersions]);

  const chooseKizaflux = () => {
    setMinecraftLoader("vanilla");
    if (!kizafluxVersions.includes(minecraftVersion) && kizafluxVersions[0]) setMinecraftVersion(kizafluxVersions[0]);
    setMinecraftEngine("kizaflux");
  };

  let versionHint = t("Stable releases, snapshots and previews.");
  if (minecraftEngine === "kizaflux") versionHint = t("The versions the Kizaflux engine plays.");
  else if (releasesOnly) versionHint = t("Stable releases only.");

  const loaderReady = minecraftLoader === "vanilla"
    || (!!minecraftLoaderVersion && !loaderVersionsLoading && !loaderVersionsError);

  useEffect(() => {
    updateDiscordStatus(null, "browsing_instances");
  }, []);

  useEffect(() => {
    if (versionChoices.some((version) => version.id === minecraftVersion)) return;
    const latestRelease = versionChoices.find((version) => version.type === "release")?.id ?? versionChoices[0]?.id;
    if (latestRelease) setMinecraftVersion(latestRelease);
  }, [versionChoices, minecraftVersion]);

  useEffect(() => {
    setMinecraftLoaderVersion("");
  }, [minecraftLoader, minecraftVersion]);

  useEffect(() => {
    if (minecraftLoader === "vanilla" || !loaderVersions?.length) return;
    if (loaderVersions.some((entry) => entry.version === minecraftLoaderVersion)) return;
    const preferred = loaderVersions.find((entry) => entry.stable) ?? loaderVersions[0];
    setMinecraftLoaderVersion(preferred.version);
  }, [loaderVersions, minecraftLoader, minecraftLoaderVersion]);

  // Entrance: the header settles, then the posters deal themselves out.
  useGSAP(() => {
    if (isLoading || error || prefersReducedMotion() || arrivingSideways()) return;
    gsap
      .timeline({ defaults: { ease: "power3.out" } })
      .fromTo(
        '[data-anim="header"]',
        { y: -16 },
        { y: 0, duration: 0.45, clearProps: "transform" },
      )
      .fromTo(
        '[data-anim="poster"]',
        // Rising a little and fading in, rather than travelling far: the
        // cards are already where they belong, they only arrive.
        { y: 14, scale: 0.97, opacity: 0 },
        { y: 0, scale: 1, opacity: 1, duration: 0.5, stagger: staggerFor(minecraftInstances.length + 1), clearProps: "transform,opacity" },
        "-=0.2",
      )
      .fromTo(
        '[data-anim="footer"]',
        { y: 14 },
        { y: 0, duration: 0.4, clearProps: "transform" },
        "-=0.25",
      );
    // Once, when the page opens: a card added or removed later moves on its
    // own (the pack flight, the delete below), and replaying the whole
    // entrance for it read as the page reloading.
  }, { dependencies: [isLoading, error != null], scope: containerRef });

  // A deleted card leaves, then the others close the gap: their places are
  // taken before the list changes, and they slide from there once it has.
  const gridFlip = useRef<Flip.FlipState | null>(null);
  // While a card is held, the others make room quickly and together, so
  // they are settled before the next swap; a deletion closes the gap
  // slower, one after another.
  const quickFlip = useRef<false | true | "open" | "close">(false);
  useLayoutEffect(() => {
    const state = gridFlip.current;
    if (!state) return;
    gridFlip.current = null;
    const mode = quickFlip.current;
    quickFlip.current = false;
    if (mode === "open" || mode === "close") {
      // A group opened or closed: the cards after it move with it, all
      // together and on its own curve -- pushed by the capsule as it spreads
      // (GroupTray: 0.55 s), drawn back as it folds.
      Flip.from(state, {
        targets: gridRef.current?.querySelectorAll(':scope > [data-anim="poster"]'),
        duration: mode === "open" ? 0.55 : 0.4,
        ease: "power3.out",
      });
      return;
    }
    const quick = mode === true;
    // Trays move as wholes and their cards inside them (nested); a card that
    // left a tray for the grid is found again by its data-flip-id.
    Flip.from(state, {
      targets: gridRef.current?.querySelectorAll(EVERY_CARD),
      nested: true,
      duration: quick ? 0.3 : 0.55,
      ease: quick ? "power3.out" : "power3.inOut",
      stagger: quick ? 0 : 0.012,
    });
    // The drawn grid, not only the list: opening or closing a group changes
    // what is drawn while the instances stay the same.
  }, [visibleInstances, gridItems]);

  // The instances a closed group let out as it went, and where its folder
  // was: they spring out of it into their places.
  const released = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const from = released.current;
    if (!from.size) return;
    released.current = new Map();
    const grid = gridRef.current;
    if (!grid) return;
    let index = 0;
    for (const [id, box] of from) {
      const card = grid.querySelector<HTMLElement>(`:scope > [data-instance-poster="${CSS.escape(id)}"]`);
      if (!card) continue;
      const now = card.getBoundingClientRect();
      gsap.fromTo(
        card,
        {
          x: box.left + box.width / 2 - (now.left + now.width / 2),
          y: box.top + box.height / 2 - (now.top + now.height / 2),
          scale: 0.5,
          opacity: 0,
        },
        {
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          duration: 0.6,
          delay: 0.06 + index * 0.05,
          ease: "back.out(1.3)",
          clearProps: "transform,opacity",
        },
      );
      index += 1;
    }
  }, [gridItems]);

  /**
   * Groups about to go (ungrouped, or left with a single instance): what
   * they hold comes out. From an open tray the cards slide to their places
   * in the grid; from a closed folder they spring out of it; the folder
   * pops and the tray's capsule fades where it was (lib/groupMotion).
   * Called just before the change, with the grid's places already taken.
   */
  const releaseGroups = (groupIds: string[]) => {
    const grid = gridRef.current;
    if (!grid || prefersReducedMotion()) return;
    for (const groupId of groupIds) {
      const group = useInstanceGroups.getState().groups.find((entry) => entry.id === groupId);
      const folder = grid.querySelector<HTMLElement>(`[data-group-card="${CSS.escape(groupId)}"] .kiza-card`);
      if (!group || !folder) continue;
      if (!group.open) {
        const box = folder.getBoundingClientRect();
        for (const id of group.ids) released.current.set(id, box);
      }
      popGroup(folder, grid.querySelector<HTMLElement>(`[data-group-tray="${CSS.escape(groupId)}"]`));
    }
  };

  /** Where every card is now, for the grid to slide from once it changes. */
  const takePlaces = () => {
    if (gridRef.current && !prefersReducedMotion()) {
      gridFlip.current = Flip.getState(gridRef.current.querySelectorAll(EVERY_CARD));
      quickFlip.current = false;
    }
  };

  /**
   * Deleted instances leave the grid and their groups at once; a group left
   * with one instance lets it out.
   */
  const forgetInstances = (ids: string[]) => {
    const leaving = new Set(ids);
    const dissolving = useInstanceGroups
      .getState()
      .groups.filter((group) => group.ids.some((id) => leaving.has(id)) && group.ids.filter((id) => !leaving.has(id)).length < 2)
      .map((group) => group.id);
    takePlaces();
    releaseGroups(dissolving);
    setGone((current) => new Set([...current, ...ids]));
    useInstanceGroups.getState().forget(ids);
  };

  const ungroup = (groupId: string) => {
    const before = useInstanceGroups.getState().groups;
    takePlaces();
    releaseGroups([groupId]);
    useInstanceGroups.getState().ungroup(groupId);
    toast.success(t("Ungrouped"), {
      action: { label: t("Undo"), onClick: () => useInstanceGroups.getState().restore(before) },
    });
  };

  const removeInstance = (id: string) => {
    const card = containerRef.current?.querySelector<HTMLElement>(`[data-instance-poster="${CSS.escape(id)}"]`);
    const remove = () => {
      deleteInstance.mutate(id, {
        onSuccess: () => {
          if (focusedId === id) setFocusedId(null);
          forgetInstances([id]);
        },
        // Still there: it comes back.
        onError: () => {
          if (card) gsap.to(card, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.3, ease: "power2.out", clearProps: "all" });
        },
      });
    };
    if (!card || prefersReducedMotion()) {
      remove();
      return;
    }
    // It folds in on itself and blurs out, quicker than a card arrives.
    gsap.to(card, {
      scale: 0.82,
      opacity: 0,
      filter: "blur(6px)",
      duration: 0.32,
      ease: "power2.in",
      onComplete: remove,
    });
  };

  // The action row appears with the selection rather than snapping in, so
  // moving between cards reads as one object changing rather than two.
  useGSAP(() => {
    if (prefersReducedMotion() || !focusedId) return;
    gsap.from('[data-anim="footer-body"]', {
      y: 10,
      opacity: 0,
      duration: 0.28,
      ease: "power2.out",
      overwrite: "auto",
      clearProps: "transform,opacity",
    });
  }, { dependencies: [focusedId], scope: containerRef });

  // Long press a card to move it, or to drop it in the trash (lib/cardDrag).
  const trashed = useRef<string | null>(null);
  /** The units of the grid as instance ids: a group, its instances, together. */
  const expandUnits = (units: string[]) => {
    const shown = new Set(visibleInstances.map((instance) => instance.id));
    return units.flatMap((key) => {
      const groupId = groupOfKey(key);
      if (!groupId) return [key];
      return groups.find((group) => group.id === groupId)?.ids.filter((id) => shown.has(id)) ?? [];
    });
  };
  useCardDrag({
    grid: gridElement,
    order: () => gridItems.map((item) => (item.kind === "instance" ? item.instance.id : groupKey(item.group.id))),
    // Only the whole library can be reordered: with a search or a filter on,
    // a card's place among the hidden ones would be a guess. An instance in
    // a group moves with its group.
    canReorder: (id) => !query.trim() && loaderFilter === "all" && (groupOfKey(id) != null || !groupOf.has(id)),
    onPreview: (order) => {
      if (gridRef.current) {
        gridFlip.current = Flip.getState(gridRef.current.querySelectorAll(EVERY_CARD));
        quickFlip.current = true;
      }
      setDragOrder(expandUnits(order));
    },
    onDrop: (order) => {
      const ids = expandUnits(order);
      setCustomOrder(ids);
      writeStored(ORDER_KEY, JSON.stringify(ids));
      setSortBy("custom");
      setDragOrder(null);
    },
    onCancel: () => setDragOrder(null),
    onTrash: (id) => {
      setDragOrder(null);
      // A whole group: what it holds, once confirmed.
      const groupId = groupOfKey(id);
      if (groupId) {
        const group = groups.find((entry) => entry.id === groupId);
        if (!group) return;
        trashed.current = id;
        setDeletingMany(membersOf(group).map((member) => member.id));
        return;
      }
      const instance = minecraftInstances.find((entry) => entry.id === id);
      if (!instance) return;
      trashed.current = id;
      setDeleting({ id, name: instance.display_name });
    },
    trashLabels: { idle: t("Delete"), armed: t("Drop to delete") },
    onMerge: (id, target) => mergeInto(id, target),
    mergeLabels: { create: t("Create a group"), join: t("Add to group") },
  });

  /** A card let go over another card, or over a folder: a group. */
  const mergeInto = (id: string, target: MergeTarget) => {
    setDragOrder(null);
    const store = useInstanceGroups.getState();
    const before = store.groups;
    const existing = "groupId" in target ? store.groups.find((group) => group.id === target.groupId) : groupOf.get(target.instanceId);
    if (existing) {
      store.add(existing.id, [id]);
      store.toggle(existing.id, true);
    } else if ("instanceId" in target) {
      store.create([target.instanceId, id], t("Group {n}").replace("{n}", String(before.length + 1)));
    }
    toast.success(existing ? t("Added to {name}").replace("{name}", existing.name) : t("Group created"), {
      action: { label: t("Undo"), onClick: () => useInstanceGroups.getState().restore(before) },
    });
  };

  /**
   * Opening or closing a group moves the cards after it: they slide to their
   * new places rather than jump (the tray animates itself).
   */
  const toggleGroup = (mode: "open" | "close", change: () => void) => {
    if (gridRef.current && !prefersReducedMotion()) {
      gridFlip.current = Flip.getState(gridRef.current.querySelectorAll(':scope > [data-anim="poster"]'));
      quickFlip.current = mode;
    }
    change();
  };

  /** Ctrl (or Cmd) and a click adds to the choice or takes out of it. */
  const pickOrFocus = (id: string, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      setPicked((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    if (picked.size) setPicked(new Set());
    setFocusedId(id);
  };
  useEffect(() => {
    if (!picked.size) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicked(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked.size]);

  const groupPicked = () => {
    const ids = visibleInstances.map((instance) => instance.id).filter((id) => picked.has(id));
    if (ids.length < 2) return;
    const before = useInstanceGroups.getState().groups;
    useInstanceGroups.getState().create(ids, t("Group {n}").replace("{n}", String(before.length + 1)));
    setPicked(new Set());
    toast.success(t("Group created"), {
      action: { label: t("Undo"), onClick: () => useInstanceGroups.getState().restore(before) },
    });
  };

  /**
   * Several instances into the trash, once confirmed: the can rises open,
   * the cards dive in one after another, then they are deleted and the grid
   * closes over where they were.
   */
  const deleteMany = (ids: string[]) => {
    const grid = gridRef.current;
    const frames = ids
      .map((id) => grid?.querySelector<HTMLElement>(`[data-instance-poster="${CSS.escape(id)}"] .kiza-card`))
      .filter((frame): frame is HTMLElement => !!frame);
    const finish = () => {
      deleteInstances.mutate(ids, {
        onSuccess: (failed) => {
          const deleted = ids.filter((id) => !failed.includes(id));
          forgetInstances(deleted);
          if (focusedId && deleted.includes(focusedId)) setFocusedId(null);
          // What could not be deleted comes back.
          for (const id of failed) {
            const frame = grid?.querySelector<HTMLElement>(`[data-instance-poster="${CSS.escape(id)}"] .kiza-card`);
            if (frame) gsap.to(frame, { opacity: 1, duration: 0.3, clearProps: "opacity" });
          }
        },
      });
    };
    setPicked(new Set());
    if (prefersReducedMotion() || frames.length === 0) {
      finish();
      return;
    }
    const ghosts = frames.map((frame) => {
      const box = frame.getBoundingClientRect();
      const ghost = frame.cloneNode(true) as HTMLElement;
      ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, {
        position: "fixed",
        left: "0px",
        top: "0px",
        width: `${box.width}px`,
        height: `${box.height}px`,
        margin: "0",
        zIndex: "2147483000",
        pointerEvents: "none",
        transition: "none",
        boxShadow: "0 24px 50px -18px rgba(0, 0, 0, 0.7)",
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(ghost);
      gsap.set(ghost, { x: box.left, y: box.top, transformOrigin: "50% 50%" });
      gsap.set(frame, { opacity: 0 });
      return ghost;
    });
    createTrashCan({ idle: t("Delete"), armed: t("Drop to delete") }).swallowMany(ghosts, finish);
  };

  const handleCreateMinecraft = async () => {
    if (!minecraftName.trim() || !minecraftVersion.trim()) return;

    try {
      setIsAddingMinecraft(true);
      const instance = await createMinecraftInstance.mutateAsync({
        displayName: minecraftName.trim(),
        mcVersion: minecraftVersion.trim(),
        loader: minecraftLoader,
        loaderVersion: minecraftLoader === "vanilla" ? null : minecraftLoaderVersion,
        javaMajor: minecraftEngine === "kizaflux" ? null : javaSelectionToMajor(minecraftJava),
        engine: minecraftEngine,
      });

      await startMinecraftInstall.mutateAsync(instance.id);
      setSelectedInstanceId(instance.id);
      setMinecraftDialogOpen(false);
    } finally {
      setIsAddingMinecraft(false);
    }
  };

  const handleImportInstance = async () => {
    const selected = await openFileDialog({
      multiple: false,
      filters: [
        { name: t("Instance archive"), extensions: ["zip", "mrpack", "7z", "rar", "tar", "gz", "tgz", "xz", "txz", "bz2", "tbz2", "zst", "tzst", "lzma", "tlz"] },
      ],
    });
    if (typeof selected !== "string") return;
    importArchive(selected);
  };

  // A pack dropped anywhere on the window lands here.
  const droppedArchive = useAppStore((state) => state.droppedArchive);
  useEffect(() => {
    if (!droppedArchive || importInstance.isPending) return;
    useAppStore.getState().setDroppedArchive(null);
    importArchive(droppedArchive);
    // importArchive reads the latest mutation through its closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedArchive]);

  function importArchive(selected: string) {
    setImportingFile(
      (selected.split(/[\\/]/).pop() ?? selected).replace(/(\.tar)?\.(zip|mrpack|7z|rar|tar|tgz|txz|tbz2|tzst|tlz|gz|xz|bz2|zst|lzma)$/i, ""),
    );

    importInstance.mutate(
      { archivePath: selected },
      {
        onSuccess: (outcome) => {
          setSelectedInstanceId(outcome.instance_id);
          // A light copy of a heavier release is asked about before anything
          // else: the missing mods of an instance about to be replaced are
          // nobody's concern.
          if (outcome.lighter_than) {
            setLighterPack({ instanceId: outcome.instance_id, official: outcome.lighter_than });
            return;
          }
          // Shown over the instance it belongs to, by the one dialog every
          // import path shares.
          useMissingMods.getState().show(outcome.instance_id, outcome.blocked);
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-6 kiza-under-bar px-6 sm:px-8 xl:px-11">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56 rounded-full" />
          <Skeleton className="h-4 w-40 rounded-full opacity-70" />
        </div>
        <SkeletonGrid count={7} />
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
    <div ref={containerRef} className="flex min-w-0 max-w-full flex-1 flex-col kiza-under-bar overflow-x-hidden overflow-y-auto px-6 pb-5 sm:px-8 sm:pb-7 sm:[--kiza-under-bar-gap:1.75rem] xl:px-11 xl:pb-9 xl:[--kiza-under-bar-gap:2.25rem]">
      <ModpackCatalogueDialog open={modpackCatalogueOpen} onOpenChange={setModpackCatalogueOpen} />
      <Dialog open={minecraftDialogOpen} onOpenChange={setMinecraftDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg gap-0 overflow-y-auto p-0">
          {/* What will be made, said as it is chosen: the header reads like
              the card the instance will become. */}
          <DialogHeader className="space-y-0 px-6 pb-4 pt-6 pr-14">
            <div className="flex items-center gap-3.5">
              <span key={minecraftLoader} className="flex h-12 w-12 shrink-0 items-center justify-center animate-in zoom-in-90 fade-in-0 duration-200">
                <LoaderLogo loader={minecraftLoader} className="h-12 w-12" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-left text-xl font-semibold tracking-tight">{t("New instance")}</DialogTitle>
                <DialogDescription className="mt-0.5 truncate text-left text-[0.8125rem]">
                  {[minecraftVersion ? `Minecraft ${minecraftVersion}` : null, minecraftEngine === "kizaflux" ? "Kizaflux" : MINECRAFT_LOADER_LABELS[minecraftLoader], minecraftLoader !== "vanilla" ? minecraftLoaderVersion || null : null]
                    .filter(Boolean)
                    .join(" · ")}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5 px-6 pb-2">
            <Input
              value={minecraftName}
              onChange={(event) => setMinecraftName(event.target.value)}
              placeholder={t("Instance name")}
              aria-label={t("Instance name")}
              className="h-12 rounded-xl border-transparent bg-secondary/45 px-4 text-base font-medium focus:bg-secondary/60"
            />

            <section>
              <h3 className="mb-1.5 px-1 text-[0.8125rem] font-semibold text-foreground/90">{t("Modloader")}</h3>
              {/* Two rows of two rather than one row of four: at four across,
                  the tiles were narrower than their own labels. */}
              <div className="grid grid-cols-2 gap-2">
                {MINECRAFT_LOADER_OPTIONS.map((loader) => {
                  const active = minecraftLoader === loader.value;
                  return (
                    <button
                      key={loader.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setMinecraftLoader(loader.value)}
                      className={cn(
                        "relative flex items-center gap-3 rounded-xl p-3 text-left transition-[background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97]",
                        active
                          ? "bg-primary/[0.16] shadow-[inset_0_0_0_1.5px_hsl(var(--primary)/0.75)]"
                          : "bg-secondary/[0.32] hover:bg-secondary/55",
                      )}
                    >
                      <LoaderLogo loader={loader.value} className={cn("h-10 w-10 transition-[filter,opacity] duration-200", !active && "opacity-80 saturate-[0.85]")} />
                      <span className="min-w-0">
                        <span className="block text-[0.8438rem] font-semibold">{loader.label}</span>
                        <span className="block truncate text-[0.7188rem] text-muted-foreground">{t(loaderPresentation[loader.value].description)}</span>
                      </span>
                      {active && (
                        <Check className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-primary animate-in zoom-in-50 fade-in-0 duration-150" strokeWidth={3} />
                      )}
                    </button>
                  );
                })}
                {/* A pack is an instance made ready: across both columns, so it
                    reads as the other way in rather than a fifth loader. */}
                <button
                  type="button"
                  onClick={() => {
                    setMinecraftDialogOpen(false);
                    setModpackCatalogueOpen(true);
                  }}
                  className="group relative col-span-2 flex items-center gap-3.5 overflow-hidden rounded-xl bg-gradient-to-r from-primary/[0.22] via-primary/[0.12] to-violet-500/[0.18] p-3 text-left shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)] transition-[background-color,box-shadow,transform] duration-150 hover:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.985]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-primary/25 text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.15)]">
                    <PackageSearch className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9063rem] font-semibold">{t("Find a modpack")}</span>
                    <span className="block truncate text-[0.7188rem] text-muted-foreground">
                      {t("Modrinth and CurseForge, ready to play")}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
                </button>
              </div>
            </section>

            {kizaflux?.available && (
              <section>
                <h3 className="mb-1.5 px-1 text-[0.8125rem] font-semibold text-foreground/90">{t("Engine")}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: "java", label: "Java", description: t("Minecraft: Java Edition"), Icon: Coffee },
                    {
                      value: "kizaflux",
                      label: "Rust",
                      description: "Kizaflux powered by Horizon",
                      Icon: Zap,
                      // Still being built: some of the game is not there yet.
                      badge: t("Experimental"),
                    },
                  ] as const).map((engine) => {
                    const active = minecraftEngine === engine.value;
                    return (
                      <button
                        key={engine.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => (engine.value === "kizaflux" ? chooseKizaflux() : setMinecraftEngine("java"))}
                        className={cn(
                          "relative flex items-center gap-3 rounded-xl p-3 text-left transition-[background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97]",
                          active
                            ? "bg-primary/[0.16] shadow-[inset_0_0_0_1.5px_hsl(var(--primary)/0.75)]"
                            : "bg-secondary/[0.32] hover:bg-secondary/55",
                        )}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-secondary/60">
                          <engine.Icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="text-[0.8438rem] font-semibold">{engine.label}</span>
                            {"badge" in engine && (
                              <span className="rounded-full bg-amber-400/15 px-1.5 py-px text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-amber-300 shadow-[inset_0_0_0_1px_rgb(251_191_36/0.35)]">
                                {engine.badge}
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-[0.7188rem] text-muted-foreground">{engine.description}</span>
                        </span>
                        {active && (
                          <Check className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-primary animate-in zoom-in-50 fade-in-0 duration-150" strokeWidth={3} />
                        )}
                      </button>
                    );
                  })}
                </div>
                {minecraftEngine === "kizaflux" && (
                  <p className="mt-1.5 px-1 text-xs text-muted-foreground">
                    {t("Kizaflux plays vanilla Minecraft on a Rust engine. Java mods do not run on it; Horizon mods, resource packs and data packs do.")}
                  </p>
                )}
              </section>
            )}

            <section>
              <h3 className="mb-1.5 px-1 text-[0.8125rem] font-semibold text-foreground/90">{t("Version")}</h3>
              <div className="divide-y divide-border/40 rounded-xl bg-secondary/[0.32] px-4 shadow-[inset_0_0_0_0.5px_hsl(0_0%_100%/0.05)] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-0 [&_button]:shadow-none [&_button]:hover:bg-transparent">
                <div className="flex min-h-12 items-center justify-between gap-4 py-1.5">
                  <span className="shrink-0 text-[0.8438rem] text-muted-foreground">Minecraft</span>
                  <div className="w-full max-w-[16rem] [&_.h-8]:hidden">
                    <MinecraftVersionPicker
                      versions={versionChoices}
                      value={minecraftVersion}
                      onValueChange={setMinecraftVersion}
                      releasesOnly={releasesOnly}
                    />
                  </div>
                </div>
                {minecraftLoader !== "vanilla" && (
                  <div className="flex min-h-12 items-center justify-between gap-4 py-1.5">
                    {/* Read from the map. The two-way guess labelled everything
                        that was not Fabric as Forge. */}
                    <span className="shrink-0 text-[0.8438rem] text-muted-foreground">{MINECRAFT_LOADER_LABELS[minecraftLoader]}</span>
                    <div className="w-full max-w-[16rem]">
                      <LauncherOptionPicker
                        ariaLabel={`Choose a ${minecraftLoader} version`}
                        options={(loaderVersions ?? []).map((entry) => ({
                          value: entry.version,
                          label: entry.version,
                          badge: entry.stable ? "Stable" : "Preview",
                        }))}
                        value={minecraftLoaderVersion}
                        onValueChange={setMinecraftLoaderVersion}
                        placeholder={t("Select a compatible loader version")}
                        loading={loaderVersionsLoading}
                        disabled={!minecraftVersion || !!loaderVersionsError}
                      />
                    </div>
                  </div>
                )}
              </div>
              {loaderVersionsError ? (
                <p className="mt-1.5 px-1 text-xs text-red-300">
                  {t("No compatible loader version is available for this Minecraft version.")}
                </p>
              ) : (
                <p className="mt-1.5 px-1 text-xs text-muted-foreground">
                  {versionHint}
                </p>
              )}
            </section>

            {/* Java is chosen for you; it is here for the few who need to. On
                Rust there is no Java to choose. */}
            {minecraftEngine === "java" && (
              <details className="group rounded-xl bg-secondary/[0.2] px-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground">
                  <span>{t("Advanced options")}</span>
                  <span className="text-xs">
                    {minecraftJava === "auto" ? t("Java automatic") : `Java ${minecraftJava}`}
                    <ChevronDown className="ml-1.5 inline h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
                  </span>
                </summary>
                <div className="pb-3">
                  <LauncherOptionPicker
                    ariaLabel={t("Choose a Java runtime")}
                    options={MINECRAFT_JAVA_OPTIONS}
                    value={minecraftJava}
                    onValueChange={(value) => setMinecraftJava(value as MinecraftJavaSelection)}
                    placeholder={t("Choose Java")}
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t("The version list above only shows releases this Java can run.")}
                  </p>
                </div>
              </details>
            )}
          </div>

          <DialogFooter className="px-6 pb-6 pt-4">
            <Button onClick={() => setMinecraftDialogOpen(false)}>{t("Cancel")}</Button>
            <Button
              onClick={handleCreateMinecraft}
              disabled={isAddingMinecraft || !minecraftName.trim() || !minecraftVersion.trim() || !loaderReady}
              variant="primary"
            >
              {isAddingMinecraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("Create and install")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div data-anim="header" className="mb-5 shrink-0 xl:mb-7">
        <div className="flex min-w-0 items-center gap-4">
          <div {...part("library.icon", { icon: true })} className="flex h-12 w-12 shrink-0 items-center justify-center">
            <PartIcon name="library.icon" icon={Box} className="h-11 w-11 text-primary" strokeWidth={1.7} />
          </div>
          <div className="min-w-0">
            <h1 {...part("library.title", { label: true })} className="kiza-heading truncate font-bold tracking-tight">
              <PartLabel name="library.title">{t("My library")}</PartLabel>
            </h1>
            <p {...part("library.count")} className="mt-1 truncate text-base text-muted-foreground">
              {minecraftInstances.length}{" "}
              {minecraftInstances.length === 1 ? t("Minecraft instance") : t("Minecraft instances")}
            </p>
          </div>
        </div>

        {/* The toolbar: Instances | Host at the left, the search in the
            middle, the tools at the right. One row under the title on both
            front pages, so flipping between them moves nothing else. */}
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <LibraryModeSwitch />

          <ToolbarSearch
            name="library.search"
            value={query}
            onChange={setQuery}
            placeholder={t("Search instances...")}
            className="mx-auto w-full max-w-[520px] flex-1 basis-72"
          />

          <div className="flex shrink-0 items-center gap-4">
            <FilterMenu
              active={sortBy !== "recent" || loaderFilter !== "all"}
              sections={[
                {
                  title: t("Sort by"),
                  value: sortBy,
                  onChange: (id) => setSortBy(id as LibrarySort),
                  options: [
                    { id: "recent", label: t("Last played") },
                    { id: "name", label: t("Name") },
                    { id: "custom", label: t("Custom") },
                  ],
                },
                {
                  title: t("Loader"),
                  value: loaderFilter,
                  onChange: setLoaderFilter,
                  options: [
                    { id: "all", label: t("All") },
                    { id: "vanilla", label: "Vanilla" },
                    { id: "fabric", label: "Fabric" },
                    { id: "forge", label: "Forge" },
                    { id: "neoforge", label: "NeoForge" },
                  ],
                },
              ]}
            />
            <div ref={importMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setImportMenuOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={importMenuOpen}
                {...part("library.import", { label: true, icon: true })}
                disabled={importInstance.isPending}
                {...editable("secondary")}
                className="kiza-secondary inline-flex h-[54px] items-center gap-3 border px-7 text-base font-medium transition-[border-color,background-color] hover:border-primary/40 disabled:opacity-60"
              >
                {importInstance.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PartIcon name="library.import" icon={Upload} className="h-5 w-5" />
                )}
                {/* A pack of thirty mods is a minute of downloading, and the button
                    used to spend it saying nothing but "Import". */}
                {importInstance.isPending && importProgress?.total
                  ? `${importProgress.done}/${importProgress.total}`
                  : <PartLabel name="library.import">{t("Import")}</PartLabel>}
              </button>
              {importMenuOpen && (
                <div role="menu" className="kiza-enter kiza-elevated absolute right-0 top-[62px] z-40 w-64 rounded-xl border border-border/80 bg-popover p-1.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      void handleImportInstance();
                    }}
                    className="flex w-full flex-col items-start rounded-md px-2.5 py-2 text-left text-sm text-foreground transition hover:bg-secondary/60"
                  >
                    <span>{t("From a file…")}</span>
                    <span className="text-xs text-muted-foreground">{t("A pack or an export: zip, mrpack, 7z, rar, tar, zst — or drop it on the window")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      setImportFromLauncherOpen(true);
                    }}
                    className="flex w-full flex-col items-start rounded-md px-2.5 py-2 text-left text-sm text-foreground transition hover:bg-secondary/60"
                  >
                    <span>{t("From another launcher…")}</span>
                    <span className="text-xs text-muted-foreground">{t("CurseForge, Modrinth, Prism, MultiMC, Minecraft Launcher")}</span>
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setMinecraftDialogOpen(true)}
              disabled={isAddingMinecraft || createMinecraftInstance.isPending}
              {...part("library.create", { label: true, icon: true })}
              {...editable("action")}
              className="inline-flex h-[54px] items-center gap-3 rounded-xl kiza-action px-8 text-base font-semibold text-primary-foreground shadow-[0_0_24px_-6px_hsl(var(--primary)/0.7)] transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
            >
              {isAddingMinecraft ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PartIcon name="library.create" icon={Plus} className="h-5 w-5" />
              )}
              <PartLabel name="library.create">{t("Create")}</PartLabel>
            </button>
          </div>
        </div>
      </div>

      {minecraftInstances.length > 0 ? (
        <>
          {/*
            One layout for two very different libraries.

            With a handful of instances this fills a single line and reads as
            the shelf in the reference. With thirty it wraps and the page
            scrolls down — which is the direction a list is meant to grow.
            A horizontal shelf that never wrapped would mean scrolling
            sideways past twenty cards with no overview, and the card you want
            is never the one on screen.

            The column is capped rather than stretched so the portrait shape
            survives a wide window, and the cap follows the viewport height so
            a whole card still fits on a short screen.
          */}
          <div
            ref={attachGrid}
            {...part("library.grid")}
            // Positioned and isolated: what is drawn under the cards (a
            // group's capsule fading, a pack's ripple) stays in the grid.
            className="relative isolate grid shrink-0 pb-1"
            style={{
              // More columns as the window grows, not bigger cards: each one
              // stays between 180 and roughly twice that, so a large window
              // holds a library instead of four giant posters. A theme may
              // choose the narrowest card and the spacing (globals.ts).
              gridTemplateColumns: "repeat(auto-fill, minmax(var(--kiza-card-width, 180px), 1fr))",
              // The theme's spacing, then the density chosen in Appearance
              // over it: a compact theme can still be made roomier.
              columnGap: "calc(var(--kiza-library-gap-x, 20px) * var(--kiza-density, 1))",
              rowGap: "calc(var(--kiza-library-gap-y, 28px) * var(--kiza-density, 1))",
            }}
          >
            {importInstance.isPending && importingFile && (
              <ImportingPoster fileName={importingFile} done={importProgress?.done ?? 0} total={importProgress?.total ?? 0} current={importProgress?.name ?? null} />
            )}
            {gridItems.map((item) => {
              const poster = (instance: (typeof visibleInstances)[number]) => (
                <InstancePoster
                  key={instance.id}
                  instance={instance}
                  selected={instance.id === focusedId}
                  picked={picked.has(instance.id)}
                  className="w-full"
                  launching={launchMinecraft.isPending && focusedId === instance.id}
                  onSelect={(event) => pickOrFocus(instance.id, event)}
                  onPlay={() => play(instance)}
                  onManage={() => setSelectedInstanceId(instance.id)}
                  onMenu={(x, y) => setMenu({ id: instance.id, x, y })}
                />
              );
              if (item.kind === "instance") return poster(item.instance);
              const actions = {
                onRename: (name: string) => useInstanceGroups.getState().rename(item.group.id, name),
                onUngroup: () => ungroup(item.group.id),
                onEdit: () => setEditingGroupId(item.group.id),
                onMenu: (x: number, y: number) => setGroupMenu({ id: item.group.id, x, y }),
              };
              return item.kind === "tray" ? (
                <GroupTray
                  key={item.group.id}
                  group={item.group}
                  members={item.members}
                  span={Math.min(gridColumns, item.members.length + 1)}
                  renderMember={poster}
                  onClose={() => toggleGroup("close", () => useInstanceGroups.getState().toggle(item.group.id, false))}
                  {...actions}
                />
              ) : (
                <InstanceGroupCard
                  key={item.group.id}
                  group={item.group}
                  members={item.members}
                  onToggle={() => toggleGroup("open", () => useInstanceGroups.getState().toggle(item.group.id, true))}
                  {...actions}
                />
              );
            })}

            <button
              type="button"
              data-anim="poster"
              onClick={() => setMinecraftDialogOpen(true)}
              className="group flex w-full min-w-0 flex-col gap-2.5 text-left"
            >
              <span className="kiza-card flex aspect-[3/4] w-full items-center justify-center border border-dashed border-border/60 bg-secondary/[0.18] text-muted-foreground transition-[border-color,background-color,color,transform] duration-300 group-hover:-translate-y-1 group-hover:border-primary/50 group-hover:bg-primary/[0.06] group-hover:text-primary">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/60 transition-colors group-hover:bg-primary/15">
                  <Plus className="h-6 w-6" />
                </span>
              </span>
              <span className="px-0.5 text-[0.875rem] font-semibold text-muted-foreground transition-colors group-hover:text-foreground">
                {t("New instance")}
              </span>
            </button>
          </div>

          {query.trim() && visibleInstances.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("No instance matches that search.")}
            </p>
          )}

          {/* The instance in hand, docked at the foot of the window: a pane of
              glass that stays put while the library scrolls under it, like a
              player bar. It changes with the selection by a short fade, so
              moving between cards reads as one object changing its contents. */}
          {/* Pushes the bar to the foot of a short library, keeps a gap
              above it in a long one. */}
          {focused && <div aria-hidden className="min-h-6 flex-1" />}
          {focused && (
            <div
              data-anim="footer"
              {...part("library.footer")}
              {...editable("panel")}
              className="kiza-panel sticky bottom-4 z-20 shrink-0 border bg-card/70 px-3 py-3 shadow-[0_20px_50px_-20px_hsl(0_0%_0%/0.85)] backdrop-blur-2xl backdrop-saturate-150 sm:px-4"
            >
              <div key={focused.id} data-anim="footer-body" className="flex min-w-0 items-center gap-4 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
                {/* Who it is: the picture, the name, the same facts as the card. */}
                <div className="flex min-w-0 shrink items-center gap-3.5">
                  <InstanceThumb instanceId={focused.id} />
                  <div className="min-w-0">
                    <div className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em]">{focused.display_name}</div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.7812rem] text-muted-foreground">
                      {focused.minecraft && <LoaderLogo loader={focused.minecraft.loader} className="h-3.5 w-3.5 rounded-[3px] shadow-none" />}
                      <span className="truncate">
                        {[
                          focused.minecraft?.mc_version,
                          focused.minecraft?.engine === "kizaflux" ? "Kizaflux" : loaderLabel(focused.minecraft?.loader),
                          `${focused.mod_count} ${focused.mod_count === 1 ? t("mod") : t("mods")}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  </div>
                </div>

                {/* What there is to know, as label over value, divided by
                    hairlines rather than boxed. */}
                <div className="hidden min-w-0 shrink items-center md:flex">
                  <Stat label={t("Last played")} value={lastPlayedLabel} />
                  <Stat className="hidden lg:flex" label="Java" value={focused.minecraft?.java_major ? `Java ${focused.minecraft.java_major}` : t("Automatic")} />
                  <Stat
                    dot={focused.status === "Valid" ? "emerald" : "amber"}
                    label={t("Status")}
                    value={focused.status === "Valid" ? t("Ready to play") : t("Needs attention")}
                  />
                </div>

                <div className="relative ml-auto flex shrink-0 items-center gap-2">
                  <div className="flex items-center rounded-[12px] bg-secondary/45 p-0.5">
                    <FooterTool label={t("Open the instance folder")} icon={FolderOpen} onClick={() => openInstanceFolder.mutate(focused.id)} />
                    <FooterTool label={t("Manage this instance")} icon={Pencil} onClick={() => setSelectedInstanceId(focused.id)} />
                    <FooterTool
                      label={t("More actions")}
                      icon={MoreHorizontal}
                      active={footerMenuOpen}
                      onClick={() => setFooterMenuOpen((open) => !open)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => play(focused)}
                    disabled={launchMinecraft.isPending || focused.status !== "Valid"}
                    {...editable("action")}
                    className="kiza-action inline-flex h-10 items-center gap-2 rounded-[12px] px-5 text-sm font-semibold text-primary-foreground transition-[filter,transform] hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
                  >
                    {launchMinecraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                    {t("Play")}
                  </button>
                  {footerMenuOpen && (
                    <div className="kiza-enter absolute bottom-[52px] right-0 z-30 w-64 overflow-hidden rounded-xl bg-popover/95 p-1.5 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.09),0_18px_44px_hsl(242_30%_2%/0.6)] backdrop-blur-2xl">
                      <button
                        type="button"
                        onClick={() => {
                          setFooterMenuOpen(false);
                          verifyInstance.mutate(focused.id);
                        }}
                        disabled={verifyInstance.isPending}
                        className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.8125rem] transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-60"
                      >
                        {verifyInstance.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        {t("Check this instance")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFooterMenuOpen(false);
                          setExportInstanceId(focused.id);
                        }}
                        className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.8125rem] transition-colors hover:bg-primary hover:text-primary-foreground"
                      >
                        <Share2 className="h-4 w-4" />
                        {t("Export this instance")}
                      </button>
                      {/* Host → Creator, with this instance already read: the
                          server gets the mods a server needs and nothing else. */}
                      <button
                        type="button"
                        onClick={() => {
                          setFooterMenuOpen(false);
                          openServerCreatorFor(focused.id);
                        }}
                        className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.8125rem] transition-colors hover:bg-primary hover:text-primary-foreground"
                      >
                        <Server className="h-4 w-4" />
                        {t("Create a server from this instance")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          className="min-h-[360px]"
          title={t("No Minecraft instance")}
          description={t("Create your first isolated Minecraft instance and choose Vanilla, Fabric or Forge.")}
        />
      )}

      {menu && (() => {
        const target = orderedInstances.find((entry) => entry.id === menu.id);
        if (!target) return null;
        const chooseCover = async () => {
          const picked = await openFileDialog({
            multiple: false,
            filters: [{ name: t("Image"), extensions: ["png", "jpg", "jpeg"] }],
          });
          if (typeof picked === "string") setCover.mutate({ instanceId: target.id, sourcePath: picked });
        };
        return (
          <InstanceContextMenu
            x={menu.x}
            y={menu.y}
            title={target.display_name}
            onClose={() => setMenu(null)}
            groups={[
              [{ label: t("Play"), icon: Play, onSelect: () => play(target), disabled: target.status !== "Valid" }],
              [
                { label: t("Rename…"), icon: Pencil, onSelect: () => setRenaming({ id: target.id, name: target.display_name }) },
                { label: t("Change the picture…"), icon: ImagePlus, onSelect: () => void chooseCover() },
                { label: t("Open folder"), icon: FolderOpen, onSelect: () => openInstanceFolder.mutate(target.id) },
              ],
              [
                { label: t("Check this instance"), icon: ShieldCheck, onSelect: () => verifyInstance.mutate(target.id) },
                { label: t("Export this instance"), icon: Share2, onSelect: () => setExportInstanceId(target.id) },
              ],
              [{ label: t("Delete…"), icon: Trash2, destructive: true, onSelect: () => setDeleting({ id: target.id, name: target.display_name }) }],
            ]}
          />
        );
      })()}

      {groupMenu && (() => {
        const group = groups.find((entry) => entry.id === groupMenu.id);
        if (!group) return null;
        const members = membersOf(group).map((member) => member.id);
        return (
          <InstanceContextMenu
            x={groupMenu.x}
            y={groupMenu.y}
            title={group.name}
            onClose={() => setGroupMenu(null)}
            groups={[
              [
                group.open
                  ? { label: t("Close the group"), icon: FolderClosed, onSelect: () => toggleGroup("close", () => useInstanceGroups.getState().toggle(group.id, false)) }
                  : { label: t("Open the group"), icon: FolderOpen, onSelect: () => toggleGroup("open", () => useInstanceGroups.getState().toggle(group.id, true)) },
                { label: t("Edit the group…"), icon: Pencil, onSelect: () => setEditingGroupId(group.id) },
                { label: t("Ungroup"), icon: FolderMinus, onSelect: () => ungroup(group.id) },
              ],
              [
                {
                  label: t("Delete its {count} instances…").replace("{count}", String(members.length)),
                  icon: Trash2,
                  destructive: true,
                  onSelect: () => setDeletingMany(members),
                },
              ],
            ]}
          />
        );
      })()}

      <GroupEditorDialog
        group={editingGroup}
        members={editingGroup ? membersOf(editingGroup) : []}
        onOpenChange={(open) => !open && setEditingGroupId(null)}
        onSave={(patch) => {
          if (editingGroupId) useInstanceGroups.getState().update(editingGroupId, patch);
          setEditingGroupId(null);
        }}
      />

      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Rename the instance")}</DialogTitle>
            <DialogDescription>{t("Only the name changes: the folder, worlds and mods stay as they are.")}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = renaming?.name.trim();
              if (!renaming || !name) return;
              renameInstance.mutate(
                { instanceId: renaming.id, displayName: name },
                { onSuccess: () => setRenaming(null) },
              );
            }}
          >
            <Input
              autoFocus
              value={renaming?.name ?? ""}
              maxLength={64}
              onChange={(event) => setRenaming((current) => current && { ...current, name: event.target.value })}
              onFocus={(event) => event.currentTarget.select()}
            />
            <DialogFooter className="mt-4">
              <Button type="button" onClick={() => setRenaming(null)}>{t("Cancel")}</Button>
              <Button type="submit" variant="primary" disabled={!renaming?.name.trim() || renameInstance.isPending}>
                {renameInstance.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("Rename")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <SelectionBar
        count={picked.size}
        onGroup={groupPicked}
        onDelete={() => setDeletingMany([...picked])}
        onClear={() => setPicked(new Set())}
      />
      <ConfirmActionDialog
        open={!!deletingMany}
        onOpenChange={(open) => {
          if (open) return;
          setDeletingMany(null);
          // Kept after all: the group dropped in the trash comes back.
          const kept = groupOfKey(trashed.current ?? "");
          trashed.current = null;
          if (!kept || !gridRef.current) return;
          const hole =
            gridRef.current.querySelector<HTMLElement>(`[data-group-tray="${CSS.escape(kept)}"]`) ??
            gridRef.current.querySelector<HTMLElement>(`[data-group-card="${CSS.escape(kept)}"] .kiza-card`);
          if (hole) gsap.to(hole, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.6)", clearProps: "opacity,transform" });
        }}
        title={t("Delete {count} instances?").replace("{count}", String(deletingMany?.length ?? 0))}
        description={t("This permanently removes the instance, its worlds, content and settings. This cannot be undone.")}
        confirmLabel={t("Delete instances")}
        cancelLabel={t("Cancel")}
        destructive
        busy={deleteInstances.isPending}
        onConfirm={() => {
          if (!deletingMany) return;
          const ids = deletingMany;
          trashed.current = null;
          setDeletingMany(null);
          deleteMany(ids);
        }}
      />
      <ConfirmActionDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (open) return;
          setDeleting(null);
          // Kept after all: the card dropped in the trash comes back.
          const kept = trashed.current;
          trashed.current = null;
          const frame = kept ? gridRef.current?.querySelector<HTMLElement>(`[data-instance-poster="${CSS.escape(kept)}"] .kiza-card`) : null;
          if (frame) gsap.to(frame, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.6)", clearProps: "opacity,transform" });
        }}
        title={t("Delete {name}?").replace("{name}", deleting?.name ?? "")}
        description={t("This permanently removes the instance, its worlds, content and settings. This cannot be undone.")}
        confirmLabel={t("Delete instance")}
        cancelLabel={t("Cancel")}
        destructive
        busy={deleteInstance.isPending}
        onConfirm={() => {
          if (!deleting) return;
          const id = deleting.id;
          trashed.current = null;
          setDeleting(null);
          removeInstance(id);
        }}
      />

      {exportInstanceId && (
        <ExportInstanceDialog
          instanceId={exportInstanceId}
          open
          onOpenChange={(next) => !next && setExportInstanceId(null)}
        />
      )}

      <ImportFromLauncherDialog
        open={importFromLauncherOpen}
        onOpenChange={setImportFromLauncherOpen}
        onImported={(instance) => setSelectedInstanceId(instance.id)}
      />

      {lighterPack && (
        <LighterPackDialog
          instanceId={lighterPack.instanceId}
          official={lighterPack.official}
          onClose={(replacedWith) => {
            setLighterPack(null);
            if (replacedWith) setSelectedInstanceId(replacedWith);
          }}
        />
      )}
    </div>
  );
}

function loaderLabel(loader: string | undefined): string | null {
  switch (loader) {
    case "vanilla":
      return "Vanilla";
    case "fabric":
      return "Fabric";
    case "forge":
      return "Forge";
    case "neoforge":
      return "NeoForge";
    default:
      return null;
  }
}

/** One fact about the instance in hand: what it is, then the answer. */
function Stat({
  dot,
  label,
  value,
  className,
}: {
  dot?: "emerald" | "amber";
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 flex-col justify-center border-l border-border/50 px-4 first:border-l-0", className)}>
      <div className="text-[0.6875rem] text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 truncate text-[0.8125rem] font-medium">
        {dot && (
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot === "emerald" ? "bg-emerald-400" : "bg-amber-400")} />
        )}
        {value}
      </div>
    </div>
  );
}

/** A small tool in the bar's capsule: an icon, its name on hover. */
function FooterTool({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: typeof Clock;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={active}
      className={cn(
        "flex h-9 w-10 items-center justify-center rounded-[10px] transition-[background-color,color,scale] duration-150 active:scale-[0.94]",
        active ? "bg-background/80 text-foreground" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

/** The instance's picture, small, beside its name in the footer. */
function InstanceThumb({ instanceId }: { instanceId: string }) {
  const { data: cover } = useInstanceCover(instanceId);
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[12px] bg-gradient-to-br from-primary/30 to-primary/5 shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.1)]">
      {cover && <img src={cover.uri} alt="" aria-hidden decoding="async" className="h-full w-full object-cover" />}
    </div>
  );
}

/**
 * The pack being imported, standing in the library before it exists: its
 * file name, a sheen passing over the picture, and a ring with how many of
 * its mods are in. Reading the archive has no count yet, and the ring turns
 * until the backend has one.
 */
function ImportingPoster({
  fileName,
  done,
  total,
  current,
}: {
  fileName: string;
  done: number;
  total: number;
  current: string | null;
}) {
  const { t } = useI18n();
  const percent = total > 0 ? (done / total) * 100 : null;
  return (
    <div className="flex w-full min-w-0 flex-col gap-2.5 animate-in fade-in-0 zoom-in-95 duration-300 motion-reduce:animate-none" aria-live="polite">
      <div className="kiza-card kiza-shimmer relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden border border-primary/40 bg-gradient-to-br from-primary/25 to-primary/5">
        <div className="relative flex flex-col items-center gap-3 px-4 text-center">
          <ProgressRing percent={percent} size={56} />
          <span className="text-[0.75rem] font-medium text-white/85">
            {total > 0 ? t("{done} of {total} mods").replace("{done}", String(done)).replace("{total}", String(total)) : t("Reading the archive…")}
          </span>
        </div>
      </div>
      <div className="min-w-0 px-0.5">
        <h3 className="truncate text-[0.875rem] font-semibold tracking-[-0.01em]">{fileName}</h3>
        <p key={current ?? ""} className="mt-0.5 truncate text-[0.75rem] text-muted-foreground animate-in fade-in-0 duration-200">
          {current ?? t("Importing…")}
        </p>
      </div>
    </div>
  );
}

type LibrarySort = "recent" | "name" | "custom";
const SORT_KEY = "kiza.library.sort";
const ORDER_KEY = "kiza.library.order";
/** Every card of the grid and every open group, for the grid's slides. */
const EVERY_CARD = '[data-anim="poster"], [data-group-tray]';

/** The viewer's own preference; storage may be unavailable, which is fine. */
function readStored(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not kept, still applied for this session.
  }
}

/**
 * What can be done with the instances chosen with Ctrl: a floating bar that
 * rises from the bottom while there is a choice, and goes when there is not.
 */
function SelectionBar({
  count,
  onGroup,
  onDelete,
  onClear,
}: {
  count: number;
  onGroup: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  // Kept while it leaves, with the last count it showed.
  const [shown, setShown] = useState(count);
  useEffect(() => {
    if (count) setShown(count);
  }, [count]);
  const open = count > 0;
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "fixed bottom-7 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-2xl border border-white/10 bg-background/70 p-1.5 pl-4 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.8)] backdrop-blur-xl backdrop-saturate-150",
        "transition-[transform,opacity] duration-300 ease-drawer motion-reduce:transition-none",
        open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-24 opacity-0",
      )}
    >
      <span className="mr-2 text-sm font-semibold tabular-nums">
        {t("{count} selected").replace("{count}", String(shown))}
      </span>
      <button
        type="button"
        onClick={onGroup}
        disabled={shown < 2}
        className="inline-flex h-10 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-white/[0.08] active:scale-[0.96] disabled:opacity-40"
      >
        <FolderPlus className="h-4 w-4" />
        {t("Group")}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex h-10 items-center gap-2 rounded-xl px-3.5 text-sm font-medium text-red-300 transition-[background-color,transform] duration-150 hover:bg-red-400/10 active:scale-[0.96]"
      >
        <Trash2 className="h-4 w-4" />
        {t("Delete")}
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label={t("Clear the selection")}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-white/[0.08] hover:text-foreground active:scale-[0.92]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
