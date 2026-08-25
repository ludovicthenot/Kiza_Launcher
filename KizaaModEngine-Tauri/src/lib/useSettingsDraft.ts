import { useCallback, useEffect, useRef, useState } from "react";
import { AppConfig, useAppConfig, useSaveAppConfig } from "./queries";
import { PendingSave, SAVE_DELAY_MS, schedule, shouldAdopt } from "./settingsDraft";

/**
 * The draft every settings page edits, and the one place that writes it.
 *
 * Seven pages each had their own copy of this: a `useState` draft, a
 * `useEffect` to adopt the loaded configuration, and an `update` that wrote to
 * disk on every change. Seven copies meant seven chances to get the write
 * policy wrong, and all seven had it wrong in the same way.
 *
 * The draft changes immediately, so the interface never waits on the disk. The
 * write happens once the changes stop, and once more on the way out if the
 * dialogue is closed mid-edit — closing a window must not lose the last thing
 * that was typed into it.
 */
export function useSettingsDraft() {
  const { data: config, isLoading, error } = useAppConfig();
  const saveConfig = useSaveAppConfig();

  const [draft, setDraft] = useState<AppConfig | null>(null);
  const pending = useRef<PendingSave<AppConfig> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Held in a ref so the unmount effect below can call the current one without
  // depending on it — a dependency there would flush on every render instead
  // of on the way out.
  const save = useRef(saveConfig.mutate);
  save.current = saveConfig.mutate;

  useEffect(() => {
    // A configuration arriving while a write is still pending is the value
    // from before the change. Adopting it would make a switch flick back to
    // where it was a moment after being pressed.
    if (config && shouldAdopt(pending.current, draft !== null)) {
      setDraft(config);
    }
  }, [config, draft]);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const due = pending.current;
    pending.current = null;
    if (due) save.current(due.value);
  }, []);

  const update = useCallback(
    (patch: Partial<AppConfig>) => {
      setDraft((current) => (current ? { ...current, ...patch } : current));

      pending.current = schedule(
        pending.current,
        // The pending value wins when there is one, so a slider dragged through
        // six positions writes the sixth rather than the first.
        pending.current?.value ?? (draft as AppConfig),
        patch,
        Date.now(),
      );

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [draft, flush],
  );

  // Closing the settings dialogue must not lose the last change.
  useEffect(() => {
    return () => {
      const due = pending.current;
      pending.current = null;
      if (timer.current) clearTimeout(timer.current);
      if (due) save.current(due.value);
    };
  }, []);

  return { draft, isLoading, error, update, flush, saving: saveConfig.isPending };
}
