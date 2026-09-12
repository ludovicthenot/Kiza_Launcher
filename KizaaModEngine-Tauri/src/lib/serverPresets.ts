import type { MinecraftLoader } from "./types";

/**
 * The templates the Host page offers.
 *
 * A preset is a starting point for the creator card, not a recipe the launcher
 * follows: picking one fills the name and the loader and remembers which one
 * it was. The mods a "Modded" or "Skyblock" server ships with are the next
 * step, and they belong to the server manager rather than to this list.
 *
 * `scene` is the card's picture, drawn with gradients so the launcher ships
 * no photographs it does not own.
 */
export interface ServerPreset {
  id: string;
  /** Source string; translated where it is shown. */
  name: string;
  description: string;
  loader: MinecraftLoader;
  /** A sensible heap for what the preset loads. */
  maxMemoryMb: number;
  /** Icon name, resolved by the component. */
  icon: "cube" | "sparkles" | "box" | "cloud" | "users";
  /** Two or three CSS colours the card paints its scene from. */
  scene: [string, string, string];
  /** Spans two columns in the grid, like the reference layout. */
  wide?: boolean;
}

export const SERVER_PRESETS: ReadonlyArray<ServerPreset> = [
  {
    id: "survival",
    name: "Survival",
    description: "A classic survival experience for you and your friends.",
    loader: "vanilla",
    maxMemoryMb: 4096,
    icon: "cube",
    scene: ["#0f2a3a", "#1f6f7a", "#f6a25c"],
  },
  {
    id: "vanilla-plus",
    name: "Vanilla+",
    description: "Enhanced gameplay with quality of life improvements.",
    loader: "fabric",
    maxMemoryMb: 4096,
    icon: "sparkles",
    scene: ["#241a3a", "#5a3b8c", "#f2c14e"],
  },
  {
    id: "modded",
    name: "Modded",
    description: "Play with your favorite mods and create something unique.",
    loader: "neoforge",
    maxMemoryMb: 6144,
    icon: "box",
    scene: ["#1a0f2e", "#6d28d9", "#c084fc"],
  },
  {
    id: "skyblock",
    name: "Skyblock",
    description: "A challenging skyblock experience in the void.",
    loader: "fabric",
    maxMemoryMb: 4096,
    icon: "cloud",
    scene: ["#0b1a33", "#3b82f6", "#f9a8d4"],
    wide: true,
  },
  {
    id: "community",
    name: "Community",
    description: "Perfect for communities, tuned for many players at once.",
    loader: "vanilla",
    maxMemoryMb: 8192,
    icon: "users",
    scene: ["#1c1a12", "#7c6a2a", "#fde68a"],
    wide: true,
  },
];

export function presetById(id: string | null | undefined): ServerPreset | undefined {
  if (!id) return undefined;
  return SERVER_PRESETS.find((preset) => preset.id === id);
}
