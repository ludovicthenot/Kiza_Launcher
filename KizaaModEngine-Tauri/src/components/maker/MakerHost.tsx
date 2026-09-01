/**
 * Where the Maker would be, in every edition.
 *
 * This is the only thing the launcher itself knows about the Maker, and in a
 * Stable build it is nothing.
 *
 * The dynamic import sits *behind* the edition constant rather than inside a
 * component that checks it. That distinction is the whole point: `IS_MAKER` is
 * a literal after bundling, so `IS_MAKER ? lazy(…) : null` folds to `null`, the
 * import becomes unreachable, and Rollup drops the panel's chunk entirely.
 * Written the other way round — a live `lazy()` and a check inside the render —
 * the chunk is still emitted, and Stable ships the Maker tools it will never
 * show. It did, until this was checked.
 */

import { lazy, Suspense } from "react";
import { IS_MAKER } from "../../lib/edition";
import { useThemeStore } from "../../lib/theme/store";

const MakerPanel = IS_MAKER
  ? lazy(() => import("./MakerPanel").then((module) => ({ default: module.MakerPanel })))
  : null;

export function MakerHost() {
  // Read unconditionally: hooks cannot be skipped, and in a Stable build this
  // whole component is dropped anyway.
  const editing = useThemeStore((state) => state.session !== null);

  if (!MakerPanel || !editing) return null;

  return (
    <Suspense fallback={null}>
      <MakerPanel />
    </Suspense>
  );
}

/**
 * The select tool's sheet over the launcher, or nothing.
 *
 * Rendered inside the launcher column rather than over the whole window, so
 * the title bar stays draggable and the Maker panel stays usable while the
 * tool is on. Same shape as the panel: behind the constant, so Stable never
 * downloads it.
 */
const InspectorSheet = IS_MAKER
  ? lazy(() => import("./Inspector").then((module) => ({ default: module.Inspector })))
  : null;

export function MakerInspectorHost() {
  const editing = useThemeStore((state) => state.session !== null);
  if (!InspectorSheet || !editing) return null;
  return (
    <Suspense fallback={null}>
      <InspectorSheet />
    </Suspense>
  );
}

/**
 * The Settings page that opens the Maker, or nothing.
 *
 * Same shape and same reason: the page is only reachable in one edition, so in
 * the others its code should not be in the file at all.
 */
const MakerSettingsPage = IS_MAKER
  ? lazy(() =>
      import("../settings/MakerSettings").then((module) => ({ default: module.MakerSettings })),
    )
  : null;

export function MakerSettingsHost() {
  if (!MakerSettingsPage) return null;
  return (
    <Suspense fallback={null}>
      <MakerSettingsPage />
    </Suspense>
  );
}
