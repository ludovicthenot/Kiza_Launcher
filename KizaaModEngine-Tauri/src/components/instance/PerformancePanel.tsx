import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Gauge,
  Info,
  Loader2,
  Minus,
  Timer,
  Wand2,
} from "lucide-react";
import {
  Advice,
  AdviceAction,
  Direction,
  useApplyAdvice,
  useMeasureNextLaunch,
  usePerformanceReport,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { Button, Panel } from "../ui/primitives";

/** Only the settings actions can be applied from here; a mod is content. */
function isApplicable(action: AdviceAction | undefined): boolean {
  if (!action) return false;
  return (
    action.kind === "set_max_memory" ||
    action.kind === "set_min_memory" ||
    action.kind === "use_java"
  );
}

function severityStyle(severity: Advice["severity"]) {
  switch (severity) {
    case "critical":
      return { icon: AlertTriangle, className: "text-destructive" };
    case "warning":
      return { icon: Activity, className: "text-amber-400" };
    default:
      return { icon: Info, className: "text-muted-foreground" };
  }
}

function DirectionBadge({ direction, label }: { direction: Direction; label: string }) {
  const { t } = useI18n();
  if (direction === "unknown") return null;

  const style =
    direction === "better"
      ? { Icon: ArrowDown, className: "text-emerald-400", word: t("better") }
      : direction === "worse"
        ? { Icon: ArrowUp, className: "text-destructive", word: t("worse") }
        // Two launches of an unchanged setup never agree exactly, so a small
        // difference is reported as no change rather than as a result.
        : { Icon: Minus, className: "text-muted-foreground", word: t("no change") };

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${style.className}`}>
      <style.Icon className="h-3 w-3" />
      {label}: {style.word}
    </span>
  );
}

/**
 * Why an instance runs the way it does.
 *
 * The launcher is outside the game and cannot see frames, so nothing here
 * claims an FPS number. It reports the JVM the game was given, what the garbage
 * collector did during a measured run, and how long the game took to reach the
 * menu — and stays silent when it has nothing to say.
 */
export function PerformancePanel({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const { data: report, isLoading } = usePerformanceReport(instanceId);
  const measure = useMeasureNextLaunch();
  const apply = useApplyAdvice();

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
  if (!report) return null;

  const latest = report.runs[0];

  return (
    <Panel className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold">
            <Gauge className="h-4 w-4 text-primary" />
            {t("Performance")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("What the JVM was given, and what it did with it.")}
          </p>
        </div>
        <Button
          onClick={() =>
            measure.mutate({ instanceId, wanted: !report.measuringNextLaunch })
          }
          disabled={measure.isPending}
          variant={report.measuringNextLaunch ? undefined : "primary"}
        >
          {measure.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Timer className="h-4 w-4" />
          )}
          {report.measuringNextLaunch ? t("Cancel measurement") : t("Measure the next launch")}
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t("Heap")}: {report.xmsMb || "?"}–{report.xmxMb || "?"} MB
        </span>
        {report.totalRamMb !== null && (
          <span>
            {t("Machine")}: {report.totalRamMb} MB
          </span>
        )}
        <span>Java {report.javaMajor}</span>
      </div>

      {latest && (
        <div className="mb-4 rounded-md border border-border/60 bg-secondary/20 p-3">
          <div className="text-xs font-medium">{t("Last measured run")}</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {latest.seconds_to_menu !== undefined && (
              <span>
                {t("Reached the menu in")} {latest.seconds_to_menu.toFixed(0)} s
              </span>
            )}
            {latest.gc && (
              <>
                <span>
                  {latest.gc.pauses} {t("collections")}
                </span>
                <span>
                  {t("longest freeze")} {latest.gc.max_pause_ms.toFixed(0)} ms
                </span>
                <span>
                  {t("heap after")} {latest.gc.max_heap_after_mb}/{latest.gc.heap_total_mb} MB
                </span>
              </>
            )}
            <span>
              {latest.mod_count} {t("mods")}
            </span>
          </div>

          {report.comparison && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/50 pt-2">
              <DirectionBadge direction={report.comparison.startup} label={t("Startup")} />
              <DirectionBadge
                direction={report.comparison.worst_pause}
                label={t("Longest freeze")}
              />
              <DirectionBadge
                direction={report.comparison.total_pause}
                label={t("Time spent collecting")}
              />
            </div>
          )}
        </div>
      )}

      {report.advice.length === 0 ? (
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          {/* Filler advice trains people to ignore the panel, which costs them
              the one time it matters. */}
          {t("Nothing to change. This instance is set up sensibly.")}
        </div>
      ) : (
        <div className="space-y-2">
          {report.advice.map((item) => {
            const { icon: Icon, className } = severityStyle(item.severity);
            return (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-md border border-border/60 bg-secondary/20 p-3"
              >
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{item.title}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                </div>
                {isApplicable(item.action) && (
                  <Button
                    onClick={() => apply.mutate({ instanceId, action: item.action! })}
                    disabled={apply.isPending}
                  >
                    <Wand2 className="h-4 w-4" />
                    {t("Fix it")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
