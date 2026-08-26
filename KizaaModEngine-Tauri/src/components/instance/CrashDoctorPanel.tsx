import { Loader2, Stethoscope, Wrench } from "lucide-react";
import {
  CrashAction,
  CrashFinding,
  useCrashDiagnosis,
  useMods,
  useStartMinecraftInstall,
  useToggleMod,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";

/**
 * Says what went wrong on the last failed launch, and quotes the line it based
 * that on so the player can check us.
 *
 * Actions are only rendered as buttons when the launcher can genuinely carry
 * them out. The rest are shown as instructions rather than buttons that do
 * nothing when clicked.
 */
export function CrashDoctorPanel({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const { data: findings, isLoading } = useCrashDiagnosis(instanceId, true);
  const repair = useStartMinecraftInstall();
  const toggleMod = useToggleMod();
  const { data: mods } = useMods(instanceId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  /**
   * Finds the installed mod that owns a jar the log named. The diagnosis knows
   * a file name; disabling needs a mod id, and only the catalogue links the two.
   */
  const modOwning = (jarName: string) =>
    (mods ?? []).find((mod) =>
      (mod.files ?? []).some((file) => file.split(/[\\/]/).pop() === jarName),
    );

  if (isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("Analysing the crash...")}
      </div>
    );
  }

  if (!findings || findings.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        {t("Kiza could not identify a known cause in the logs.")}
      </p>
    );
  }

  const actionLabel = (action: CrashAction): string => {
    switch (action.kind) {
      case "disable_mod":
        return t("Disable {mod} and launch again").replace("{mod}", action.value);
      case "use_java":
        return t("Switch this instance to Java {version}").replace(
          "{version}",
          String(action.value),
        );
      case "increase_memory":
        return t("Raise the instance's maximum memory");
      case "repair":
        return t("Repair the instance files");
      case "safe_mode":
        return t("Launch without mods to confirm the game itself is fine");
      case "update_graphics_driver":
        return t("Update your graphics driver");
    }
  };

  /**
   * An action becomes a button only when the launcher can genuinely carry it
   * out. Disabling a mod needs that mod to be in the catalogue; a jar added by
   * hand is not, so the advice stays text rather than a button that fails.
   */
  const runnable = (action: CrashAction): boolean => {
    switch (action.kind) {
      case "repair":
        return true;
      case "disable_mod":
        return modOwning(action.value) !== undefined;
      case "use_java":
      case "increase_memory":
        // Both are instance settings; the button takes the user there.
        return true;
      default:
        return false;
    }
  };

  const run = (action: CrashAction) => {
    switch (action.kind) {
      case "repair":
        repair.mutate(instanceId);
        return;
      case "disable_mod": {
        const owner = modOwning(action.value);
        if (owner) toggleMod.mutate({ instanceId, modId: owner.id, enabled: false });
        return;
      }
      case "use_java":
      case "increase_memory":
        setActiveTab("settings");
        return;
    }
  };

  return (
    <div className="mt-3 space-y-3">
      {findings.map((finding: CrashFinding, index: number) => (
        <div
          key={`${finding.category}-${index}`}
          className="rounded-md border border-border/70 bg-background/60 p-3"
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
                          disabled={repair.isPending || toggleMod.isPending}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2 py-0.5 font-medium transition hover:bg-secondary active:scale-[0.96] disabled:opacity-50"
                        >
                          {(repair.isPending || toggleMod.isPending) && (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          )}
                          {actionLabel(action)}
                        </button>
                      )
                      : <span>{actionLabel(action)}</span>}
                  </li>
                ))}
              </ul>

              <pre className="mt-2 overflow-x-auto rounded border border-border/50 bg-background/80 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {finding.evidence}
              </pre>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
