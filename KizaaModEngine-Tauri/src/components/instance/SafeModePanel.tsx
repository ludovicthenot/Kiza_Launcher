import { AlertTriangle, CheckCircle2, Loader2, Play, ShieldQuestion, X } from "lucide-react";
import {
  useMods,
  useSafeModeRecord,
  useSafeModeStart,
  useSafeModeStatus,
  useSafeModeStop,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { Button, Panel } from "../ui/primitives";

/**
 * Finds which mod breaks the game by halving instead of one-at-a-time.
 *
 * Each step leaves the instance in a specific state, the player launches, and
 * the result narrows the search. The session is stored next to the instance, so
 * closing the launcher between two test launches does not lose the hunt.
 */
export function SafeModePanel({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const { data: state, isLoading } = useSafeModeStatus(instanceId);
  const { data: mods } = useMods(instanceId);
  const start = useSafeModeStart();
  const record = useSafeModeRecord();
  const stop = useSafeModeStop();

  const nameOf = (modId: string) =>
    (mods ?? []).find((mod) => mod.id === modId)?.name ?? modId;

  if (isLoading) return null;

  if (!state) {
    return (
      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t("Safe mode")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Launch without mods, then re-enable them by halves to find the one that crashes.")}
            </p>
          </div>
          <Button
            onClick={() => start.mutate({ instanceId })}
            disabled={start.isPending}
          >
            {start.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <ShieldQuestion className="h-4 w-4" />}
            {t("Find the broken mod")}
          </Button>
        </div>
      </Panel>
    );
  }

  const busy = record.isPending || stop.isPending;

  // Terminal states: the hunt is over, only the answer matters.
  if (state.step.kind === "culprit" || state.step.kind === "no_culprit"
    || state.step.kind === "broken_without_mods") {
    const isCulprit = state.step.kind === "culprit";
    return (
      <Panel className="p-4">
        <div className="flex items-start gap-3">
          {isCulprit
            ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {isCulprit && t("This mod crashes the game")}
              {state.step.kind === "no_culprit" && t("No mod was found to crash the game")}
              {state.step.kind === "broken_without_mods" && t("The game crashes without any mod")}
            </div>
            {state.step.kind === "culprit" && (
              <div className="mt-1 text-sm text-primary">{nameOf(state.step.value)}</div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {state.step.kind === "broken_without_mods"
                ? t("Disabling mods will not help. Repair the instance or check the Java runtime.")
                : t("Found in {runs} launches.").replace("{runs}", String(state.runs))}
            </p>
            <Button
              onClick={() => stop.mutate({ instanceId })}
              disabled={busy}
              className="mt-3"
              variant="primary"
            >
              {stop.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              {t("Finish and re-enable every mod")}
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  const isVanilla = state.step.kind === "test_vanilla";

  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">
            {t("Safe mode")} · {t("launch {runs}").replace("{runs}", String(state.runs + 1))}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {isVanilla
              ? t("Every mod is off. Launch the game to prove Minecraft itself works.")
              : t("{count} of {total} mods are enabled. Launch the game and report what happened.")
                  .replace("{count}", String(state.enabled.length))
                  .replace("{total}", String(state.totalCandidates))}
          </p>

          {!isVanilla && state.enabled.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {state.enabled.map((modId) => (
                <span
                  key={modId}
                  className="rounded-md border border-border/70 bg-secondary/25 px-2 py-1 text-xs"
                >
                  {nameOf(modId)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
        <span className="mr-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Play className="h-3 w-3" />
          {/* Kiza judges the launch from the exit code and whether the game
              reached its menu. These buttons are for the case only a player can
              see: it started, but it was broken. */}
          {t("Judged automatically after each launch — correct it here if needed:")}
        </span>
        <Button
          onClick={() => record.mutate({ instanceId, crashed: true })}
          disabled={busy}
          variant="danger"
        >
          {t("It crashed")}
        </Button>
        <Button
          onClick={() => record.mutate({ instanceId, crashed: false })}
          disabled={busy}
        >
          {t("It started fine")}
        </Button>
        <Button onClick={() => stop.mutate({ instanceId })} disabled={busy} className="ml-auto">
          <X className="h-4 w-4" />
          {t("Stop")}
        </Button>
      </div>
    </Panel>
  );
}
