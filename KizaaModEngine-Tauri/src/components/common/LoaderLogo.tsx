import type { MinecraftLoader } from "../../lib/types";
import { cn } from "../../lib/utils";
import vanilla from "../../assets/loaders/vanilla.png";
import fabric from "../../assets/loaders/fabric.png";
import forge from "../../assets/loaders/forge.png";
import neoforge from "../../assets/loaders/neoforge.png";

/**
 * Each loader's own mark. The ones drawn on a background (Minecraft, Forge,
 * NeoForge) are rounded like app icons; Fabric's scroll is a cut-out and
 * stands on its own. Pixel art is scaled without smoothing.
 */
const LOGOS: Record<MinecraftLoader, { src: string; framed: boolean; pixel: boolean }> = {
  vanilla: { src: vanilla, framed: true, pixel: false },
  fabric: { src: fabric, framed: false, pixel: true },
  forge: { src: forge, framed: true, pixel: false },
  neoforge: { src: neoforge, framed: true, pixel: true },
};

export function LoaderLogo({ loader, className }: { loader: MinecraftLoader; className?: string }) {
  const logo = LOGOS[loader] ?? LOGOS.vanilla;
  return (
    <img
      src={logo.src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        "h-9 w-9 shrink-0 object-contain",
        logo.framed && "rounded-[22%] shadow-[0_0_0_0.5px_hsl(0_0%_100%/0.12),0_4px_10px_-4px_hsl(0_0%_0%/0.6)]",
        logo.pixel && "[image-rendering:pixelated]",
        className,
      )}
    />
  );
}
