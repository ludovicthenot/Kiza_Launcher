import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Stethoscope, Wrench } from "lucide-react";
import { useRepairInstance, type RepairReport, type RepairVerdict } from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { Button, Panel } from "../ui/primitives";
import { cn } from "../../lib/utils";

const VERDICTS: Record<RepairVerdict, { icon: typeof CheckCircle2; className: string }> = {
  ok: { icon: CheckCircle2, className: "text-emerald-400" },
  fixed: { icon: Wrench, className: "text-primary" },
  broken: { icon: AlertTriangle, className: "text-amber-400" },
  info: { icon: Info, className: "text-muted-foreground" },
};

/** The lines of a repair report, one per thing looked at. */
export function RepairReportList({ report }: { report: RepairReport }) {
  const { t } = useI18n();
  const verdictLabel: Record<RepairVerdict, string> = {
    ok: t("Fine"),
    fixed: t("Fixed"),
    broken: t("Needs a hand"),
    info: t("Note"),
  };
  return (
    <ul className="space-y-1.5">
      {report.checks.map((check, index) => {
        const { icon: Icon, className } = VERDICTS[check.verdict];
        return (
          <li
            key={`${check.area}-${index}`}
            className="flex items-start gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2"
          >
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", className)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{check.title}</span>
                <span className={cn("text-[0.6875rem] uppercase tracking-wide", className)}>
                  {verdictLabel[check.verdict]}
                </span>
              </div>
              <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">{check.detail}</p>
            </div>
          </li>
        );
      })}
      {report.reinstall_started && (
        <li className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("The installer is running again; its progress shows at the top of the instance.")}
        </li>
      )}
    </ul>
  );
}

/**
 * One button that looks at everything the instance needs to start.
 *
 * Game files, native libraries, every catalogued mod against the folder
 * and the folder against the catalogue. What is fine is said to be fine,
 * what could be mended is mended, and what needs a hand says whose.
 */
export function RepairPanel({ instanceId, isRunning }: { instanceId: string; isRunning: boolean }) {
  const { t } = useI18n();
  const repair = useRepairInstance();
  const [report, setReport] = useState<RepairReport | null>(null);

  return (
    <Panel className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Stethoscope className="h-4 w-4 text-primary" />
            {t("Check-up")}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Verifies the game files, the native libraries and every mod against the catalogue, and puts right what it can.")}
          </p>
        </div>
        <Button
          variant="primary"
          disabled={isRunning || repair.isPending}
          onClick={() => repair.mutate(instanceId, { onSuccess: setReport })}
        >
          {repair.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
          {t("Verify and repair")}
        </Button>
      </div>
      {report && <RepairReportList report={report} />}
    </Panel>
  );
}
