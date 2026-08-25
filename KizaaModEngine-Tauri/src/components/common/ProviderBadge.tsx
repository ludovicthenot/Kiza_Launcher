import { cn } from "../../lib/utils";

export type ContentProvider = "modrinth" | "curseforge";

/**
 * Where a piece of content came from, said with the mark rather than the word.
 *
 * The installed lists used to write "CurseForge" and "Modrinth" in text, in two
 * colours that had nothing to do with either service — CurseForge came out
 * violet, which is Modrinth's colour if it is anyone's. Scanning twenty-five
 * mods for the two from CurseForge meant reading twenty-five labels.
 *
 * A mark is recognised without being read, so the badges now carry the real
 * logos on the services' own colours: CurseForge's orange, Modrinth's green.
 * Both are drawn white on a filled chip rather than tinted on a dark one,
 * because a 12-pixel anvil at 30% opacity is a smudge, and the whole point of
 * the change is that the source should be legible at a glance in a long list.
 */
const providerMeta: Record<
  ContentProvider,
  {
    label: string;
    /** The filled chip used in lists, where the mark has to survive at 12px. */
    solidClassName: string;
    /** The quieter tinted chip, for a detail panel that is already about one thing. */
    subtleClassName: string;
    viewBox: string;
    /** Sized per mark, not per box — see the comment on CurseForge's. */
    markClassName: string;
    path: string;
  }
> = {
  modrinth: {
    label: "Modrinth",
    // Modrinth's green, darkened: the brand green on a dark interface is bright
    // enough to pull the eye off the mod's own name, which is what the reader
    // actually came for.
    solidClassName: "bg-[#0b7a44] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]",
    subtleClassName: "border border-[#00af5c]/35 bg-[#00af5c]/10 text-[#4ade80]",
    viewBox: "0 0 24 24",
    markClassName: "h-3.5 w-3.5",
    path:
      "M12.252.004a11.78 11.768 0 0 0-8.92 3.73 11 10.999 0 0 0-2.17 3.11 11.37 11.359 0 0 0-1.16 5.169c0 1.42.17 2.5.6 3.77.24.759.77 1.899 1.17 2.529a12.3 12.298 0 0 0 8.85 5.639c.44.05 2.54.07 2.76.02.2-.04.22.1-.26-1.7l-.36-1.37-1.01-.06a8.5 8.489 0 0 1-5.18-1.8 5.34 5.34 0 0 1-1.3-1.26c0-.05.34-.28.74-.5a37.572 37.545 0 0 1 2.88-1.629c.03 0 .5.45 1.06.98l1 .97 2.07-.43 2.06-.43 1.47-1.47c.8-.8 1.48-1.5 1.48-1.52 0-.09-.42-1.63-.46-1.7-.04-.06-.2-.03-1.02.18-.53.13-1.2.3-1.45.4l-.48.15-.53.53-.53.53-.93.1-.93.07-.52-.5a2.7 2.7 0 0 1-.96-1.7l-.13-.6.43-.57c.68-.9.68-.9 1.46-1.1.4-.1.65-.2.83-.33.13-.099.65-.579 1.14-1.069l.9-.9-.7-.7-.7-.7-1.95.54c-1.07.3-1.96.53-1.97.53-.03 0-2.23 2.48-2.63 2.97l-.29.35.28 1.03c.16.56.3 1.16.31 1.34l.03.3-.34.23c-.37.23-2.22 1.3-2.84 1.63-.36.2-.37.2-.44.1-.08-.1-.23-.6-.32-1.03-.18-.86-.17-2.75.02-3.73a8.84 8.839 0 0 1 7.9-6.93c.43-.03.77-.08.78-.1.06-.17.5-2.999.47-3.039-.01-.02-.1-.02-.2-.03Zm3.68.67c-.2 0-.3.1-.37.38-.06.23-.46 2.42-.46 2.52 0 .04.1.11.22.16a8.51 8.499 0 0 1 2.99 2 8.38 8.379 0 0 1 2.16 3.449 6.9 6.9 0 0 1 .4 2.8c0 1.07 0 1.27-.1 1.73a9.37 9.369 0 0 1-1.76 3.769c-.32.4-.98 1.06-1.37 1.38-.38.32-1.54 1.1-1.7 1.14-.1.03-.1.06-.07.26.03.18.64 2.56.7 2.78l.06.06a12.07 12.058 0 0 0 7.27-9.4c.13-.77.13-2.58 0-3.4a11.96 11.948 0 0 0-5.73-8.578c-.7-.42-2.05-1.06-2.25-1.06Z",
  },
  curseforge: {
    label: "CurseForge",
    solidClassName: "bg-[#e04e14] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]",
    subtleClassName: "border border-[#f16436]/35 bg-[#f16436]/10 text-[#fb8a61]",
    // Cropped to the anvil itself. The published artwork sits in a 260×256 box
    // with the shape occupying a band in the middle, so drawn untrimmed the
    // mark ends up about half the height of Modrinth's beside it.
    viewBox: "4 48 252 160",
    // The anvil is half again as wide as it is tall. Drawn in the same square
    // box as Modrinth's maze it comes out about two thirds the height, and
    // reads as the smaller, fainter of the two — so it gets the width its
    // proportions actually need.
    markClassName: "h-3.5 w-[1.375rem]",
    path:
      "M196.422 98.77S247.874 90.623 256 66.858h-78.819V48H4l21.334 24.862v25.473s53.83-2.811 74.653 13.047c28.502 26.532-32.058 62.397-32.058 62.397l-10.384 34.512c16.239-15.529 47.188-35.618 103.933-34.65-21.594 6.854-43.307 17.56-60.211 34.65h114.71l-10.802-34.512s-83.139-49.235-8.753-75.005v-.004Z",
  },
};

/** Whether a stored source string names a service Kiza has a mark for. */
export function providerOf(source: string | null | undefined): ContentProvider | null {
  if (!source) return null;
  const normalised = source.toLowerCase();
  if (normalised.includes("modrinth")) return "modrinth";
  if (normalised.includes("curseforge") || normalised.includes("curse_forge")) {
    return "curseforge";
  }
  return null;
}

/** The name Kiza shows for a provider, for menus and filters that need words. */
export function providerLabel(provider: ContentProvider): string {
  return providerMeta[provider].label;
}

export function ProviderBadge({
  provider,
  className,
  variant = "solid",
  showLabel = true,
}: {
  provider: ContentProvider;
  className?: string;
  variant?: "solid" | "subtle";
  /** Off in dense rows, where the mark alone is the whole point. */
  showLabel?: boolean;
}) {
  const meta = providerMeta[provider];

  return (
    <span
      title={meta.label}
      className={cn(
        "inline-flex shrink-0 items-center rounded-lg text-[11px] font-semibold leading-none",
        showLabel ? "gap-1.5 px-2 py-1" : "h-6 justify-center px-1.5",
        variant === "solid" ? meta.solidClassName : meta.subtleClassName,
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox={meta.viewBox}
        className={cn("shrink-0 fill-current", meta.markClassName)}
      >
        <path d={meta.path} />
      </svg>
      {showLabel && <span>{meta.label}</span>}
      {!showLabel && <span className="sr-only">{meta.label}</span>}
    </span>
  );
}
