import { useCallback } from "react";
import { useAppConfig } from "./queries";
import { formatBytes, unitsFromConfig } from "./units";

/**
 * A size formatter that follows the user's choice of units.
 *
 * Kept apart from `units.ts` for the same reason `useRegionFormats` is kept
 * apart from `datetime.ts`: that module is pure and its tests run without React
 * or a Tauri backend behind them.
 *
 * While the configuration loads this formats in the default units, so a size
 * appears immediately rather than flashing a placeholder — and the default is
 * what most people would have chosen anyway.
 */
export function useStorageUnits() {
  const { data: config } = useAppConfig();
  const units = unitsFromConfig(config);

  return useCallback(
    (bytes: number, decimals?: number) => formatBytes(bytes, units, decimals),
    [units],
  );
}
