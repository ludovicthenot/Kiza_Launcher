/**
 * The words and the icon of an element, as a theme may change them.
 *
 * An element that offers them is marked with `part(name, { label, icon })`
 * and draws its text through `PartLabel` and its icon through `PartIcon`.
 * Without a theme saying otherwise both are the launcher's own, so wrapping
 * an element changes nothing until somebody decides it should.
 *
 * A theme's words are text — React escapes them like any other — and its
 * icon is a name from a short list; neither can carry markup or a style.
 * They apply in every language: a theme that renames Create renames it for
 * everybody, which is the designer's call to make.
 */

import { useSyncExternalStore, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { activeTheme, subscribe } from "../../lib/theme/engine";
import { THEME_ICONS } from "../../lib/theme/icons";
import { isPlacementValue } from "../../lib/theme/values";

/** One placement value of the theme on screen, if it is a valid one. */
function usePartSetting(name: string, key: "label" | "icon"): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => {
      const value = activeTheme()?.layout?.[name]?.[key];
      return value !== undefined && isPlacementValue(key, value) ? value : undefined;
    },
    () => undefined,
  );
}

/** The element's words: the theme's, or the launcher's own. */
export function PartLabel({ name, children }: { name: string; children: ReactNode }) {
  const label = usePartSetting(name, "label");
  return <>{label ?? children}</>;
}

/** The element's icon: the theme's choice, or the launcher's own. */
export function PartIcon({
  name,
  icon: Fallback,
  className,
  strokeWidth,
}: {
  name: string;
  icon: LucideIcon;
  className?: string;
  strokeWidth?: number;
}) {
  const chosen = usePartSetting(name, "icon");
  const Icon = (chosen && THEME_ICONS[chosen]) || Fallback;
  return <Icon className={className} strokeWidth={strokeWidth} />;
}
