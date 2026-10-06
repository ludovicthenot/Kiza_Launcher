import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppConfig, queryKeys, useAppConfig, useSaveAppConfig } from "./queries";
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

  // The draft as a ref, so `update` below never has to depend on it.
  //
  // It used to: `useCallback(..., [draft, flush])` handed every page a new
  // `update` on every keystroke, and a settings page passes `update` to every
  // row it draws. One switch therefore re-rendered every other switch on the
  // page — and on Notifications, where the row component was itself defined
  // inside the render, React rebuilt the DOM for every one of them.
  const latest = useRef<AppConfig | null>(null);
  latest.current = draft;

  // Held in a ref so the unmount effect below can call the current one without
  // depending on it — a dependency there would flush on every render instead
  // of on the way out.
  // What this page changed, and only that.
  //
  // Two pages share a screen in three places -- General with Language,
  // Downloads with Storage, Advanced with Connections -- and each has a draft
  // of its own. Writing a whole draft wrote the other page's fields as this
  // page last saw them, so two changes a moment apart, one on each half,
  // lost the first. The fields this page touched are laid over the newest
  // configuration instead, which is the one the other page just wrote.
  const changed = useRef<Partial<AppConfig>>({});
  const queryClient = useQueryClient();
  const mutate = saveConfig.mutate;
  const save = useRef<(value: AppConfig) => void>(() => {});
  save.current = (value: AppConfig) => {
    const newest = queryClient.getQueryData<AppConfig>(queryKeys.config) ?? value;
    const patch = changed.current;
    changed.current = {};
    const next = { ...newest, ...patch };
    // Seeded at once, so the other half of the screen adopts it rather than
    // writing its own stale copy over it a moment later.
    queryClient.setQueryData(queryKeys.config, next);
    mutate(next);
  };

  useEffect(() => {
    // A configuration arriving while a write is still pending is the value
    // from before the change. Adopting it would make a switch flick back to
    // where it was a moment after being pressed.
    //
    // Keyed on the configuration alone: it used to list `draft` as well, which
    // meant this ran again after every single edit only to decide it had
    // nothing to do.
    if (config && shouldAdopt(pending.current, latest.current !== null)) {
      setDraft(config);
    }
  }, [config]);

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
      changed.current = { ...changed.current, ...patch };

      pending.current = schedule(
        pending.current,
        // The pending value wins when there is one, so a slider dragged through
        // six positions writes the sixth rather than the first.
        pending.current?.value ?? (latest.current as AppConfig),
        patch,
        Date.now(),
      );

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
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
