import { useState } from "react";
import { Check, Loader2, RotateCcw, Stethoscope, Wrench } from "lucide-react";
import {
  CrashAction,
  CrashFinding,
  useCrashDiagnosis,
  useDoctorApply,
  useDoctorUndo,
  usePendingFix,
  useRepairInstance,
  type RepairReport,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";
import { RepairReportList } from "./RepairPanel";

/**
 * Says what went wrong on the last failed launch, quotes the line it based
 * that on so the player can check us, and offers to do something about it.
 *
 * <p>Every change the doctor makes is preceded by a restore point and
 * remembered; the next launch judges it. If the game crashes again the
 * panel says so and offers the way back, so a guess that was wrong costs a
 * click rather than an evening.
 *
 * <p>Actions are only rendered as buttons when the launcher can genuinely
 * carry them out. The rest are shown as instructions rather than buttons
 * that do nothing when clicked.
 */
export function CrashDoctorPanel({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const { data: findings, isLoading } = useCrashDiagnosis(instanceId, true);
  const { data: pending } = usePendingFix(instanceId);
  const apply = useDoctorApply();
  const undo = useDoctorUndo();
  const repair = useRepairInstance();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [repairReport, setRepairReport] = useState<RepairReport | null>(null);

  const busy = apply.isPending || undo.isPending || repair.isPending;

  if (isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("Analysing the crash...")}
      </div>
    );
  }

  const actionLabel = (action: CrashAction): string => {
    switch (action.kind) {
      case "disable_mod":
        return t("Switch off {mod} and launch again").replace("{mod}", action.value);
      case "enable_mod":
        return t("Switch {mod} back on and launch again").replace(
          "{mod}",
          action.value.replace(/\.disabled$/, ""),
        );
      case "use_java":
        return t("Switch this instance to Java {version}").replace(
          "{version}",
          String(action.value),
        );
      case "increase_memory":
        return t("Raise the instance's maximum memory");
      case "repair":
        return t("Verify and repair the instance files");
      case "safe_mode":
        return t("Launch without mods to confirm the game itself is fine");
      case "update_graphics_driver":
        return t("Update your graphics driver");
    }
  };

  /**
   * An action becomes a button only when the launcher can genuinely carry it
   * out. Switching a file off or on needs the file to be there; the doctor
   * only proposes those it found, so they always are.
   */
  const runnable = (action: CrashAction): boolean => {
    switch (action.kind) {
      case "repair":
      case "disable_mod":
      case "enable_mod":
      case "use_java":
      case "increase_memory":
        return true;
      default:
        return false;
    }
  };

  const run = (action: CrashAction) => {
    switch (action.kind) {
      case "repair":
        repair.mutate(instanceId, { onSuccess: setRepairReport });
        return;
      case "disable_mod":
      case "enable_mod":
        apply.mutate({ instanceId, actions: [action] });
        return;
      case "use_java":
      case "increase_memory":
        setActiveTab("settings");
        return;
    }
  };

  return (
    <div className="mt-3 space-y-3">
      {pending && (
        <div className="rounded-xl bg-amber-500/[0.12] p-3.5">
          <div className="flex items-start gap-2">
            {pending.outcome === "still_crashing" ? (
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            ) : (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">
                {pending.outcome === "still_crashing"
                  ? t("The last fix did not help")
                  : t("A fix is waiting for a launch")}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {pending.outcome === "still_crashing"
                  ? t("Kiza applied \"{fix}\" and the game crashed again. You can put the instance back exactly as it was before.").replace("{fix}", pending.summary)
                  : t("Kiza applied \"{fix}\". Launch the game to see whether it helped; if it does not, you will be able to undo it here.").replace("{fix}", pending.summary)}
              </p>
              {pending.steps.length > 1 && (
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                  {pending.steps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => undo.mutate(instanceId)}
                disabled={busy}
                className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-secondary/70 px-2.5 text-xs font-medium transition hover:bg-secondary active:scale-[0.96] disabled:opacity-50"
              >
                {undo.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                {t("Undo the fix")}
              </button>
            </div>
          </div>
        </div>
      )}

      {(!findings || findings.length === 0) && (
        <p className="text-xs text-muted-foreground">
          {t("Kiza could not identify a known cause in the logs.")}
        </p>
      )}

      {(findings ?? []).map((finding: CrashFinding, index: number) => (
        <div
          key={`${finding.category}-${index}`}
          className="rounded-xl bg-background/60 p-3.5"
        >
          <div className="flex items-start gap-2">
            <Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{finding.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {finding.detail}
              </p>

              <ul className="mt-2 space-y-1">
                {finding.actions.map((action, actionIndex) => (
                  <li
                    key={actionIndex}
                    className="flex items-center gap-2 text-xs text-foreground"
                  >
                    <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" />
                    {runnable(action)
                      ? (
                        <button
                          onClick={() => run(action)}
                          disabled={busy}
                          className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-secondary/70 px-2.5 font-medium transition hover:bg-secondary active:scale-[0.96] disabled:opacity-50"
                        >
                          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                          {actionLabel(action)}
                        </button>
                      )
                      : <span>{actionLabel(action)}</span>}
                  </li>
                ))}
              </ul>

              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-background/80 p-2.5 font-mono text-[0.625rem] leading-relaxed text-muted-foreground">
                {finding.evidence}
              </pre>
            </div>
          </div>
        </div>
      ))}

      {repairReport && <RepairReportList report={repairReport} />}
    </div>
  );
}
