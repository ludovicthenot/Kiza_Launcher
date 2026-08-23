import { useMemo } from "react";
import { useAppConfig } from "./queries";
import { formatsFromConfig, RegionFormats, SYSTEM_FORMATS } from "./datetime";

/**
 * The user's date and clock preferences, for anything that prints a moment.
 *
 * Kept apart from `datetime.ts` on purpose: that module is pure and its tests
 * run without React or a Tauri backend behind them. Pulling a hook into it
 * would drag both into every one of those tests.
 *
 * While the configuration is still loading this returns the system formats,
 * so a date renders immediately in the shape the machine would have used
 * rather than flashing a placeholder.
 */
export function useRegionFormats(): RegionFormats {
  const { data: config } = useAppConfig();
  return useMemo(
    () => (config ? formatsFromConfig(config) : SYSTEM_FORMATS),
    [config],
  );
}
