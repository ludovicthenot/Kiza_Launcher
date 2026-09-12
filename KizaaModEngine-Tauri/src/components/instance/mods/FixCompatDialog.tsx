import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Wrench,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Button } from "../../ui/primitives";
import { queryKeys, useImportProgress } from "../../../lib/queries";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";

/** One thing the launcher proposes to do. Mirrors `compat_fixer::FixStep`. */
type FixStep =
  | { action: "install"; dep_id: string; project_id: string; name: string; version_id: string; version: string }
  | { action: "replace"; file_name: string; mod_id: string; project_id: string; version_id: string; version: string; reason: string }
  | { action: "disable"; file_name: string; reason: string }
  | { action: "unfixable"; file_name: string; reason: string };

interface FixPlan {
  steps: FixStep[];
}

interface FixOutcome {
  step: FixStep;
  ok: boolean;
  detail: string;
}

type Phase = "planning" | "ready" | "applying" | "done" | "failed";

/**
 * The compatibility report, with something to press.
 *
 * <p>The report could say what was wrong and nothing about what to do. This
 * asks the launcher for a plan, shows it in the words a person would use --
 * install this, replace that with 7.11.0 because two mods need it, leave
 * this one because nobody knows where it came from -- and does the plan when
 * asked. Nothing happens on opening; the plan is read first, and applying it
 * is a second, separate click.
 *
 * <p>Three kinds of line, told apart on sight. What will be done, with the
 * version it will become. What is offered but not done unasked -- a file
 * that cannot load here at all, which the launcher will disable if the plan
 * is applied. And what the launcher looked at and will not touch, with the
 * reason: a conflict is somebody's choice, and a jar of unknown origin has
 * nothing known to replace it with.
 */
export function FixCompatDialog({
  instanceId,
  open,
  onOpenChange,
}: {
  instanceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("planning");
  const [plan, setPlan] = useState<FixPlan | null>(null);
  const [outcomes, setOutcomes] = useState<FixOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const progress = useImportProgress(phase === "applying");

  // Planned on open, every time: the folder may have changed since the last
  // look, and a stale plan applied to a changed folder is the wrong plan.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase("planning");
    setPlan(null);
    setOutcomes(null);
    setError(null);
    invoke<FixPlan>("plan_compat_fixes", { instanceId })
      .then((result) => {
        if (cancelled) return;
        setPlan(result);
        setPhase("ready");
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(String(reason));
        setPhase("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [open, instanceId]);

  const doable = plan?.steps.filter((step) => step.action !== "unfixable") ?? [];
  const willDo = plan?.steps.filter((step) => step.action === "install" || step.action === "replace") ?? [];
  const offered = plan?.steps.filter((step) => step.action === "disable") ?? [];
  const wontTouch = plan?.steps.filter((step) => step.action === "unfixable") ?? [];

  const apply = async () => {
    if (!plan) return;
    setPhase("applying");
    try {
      const result = await invoke<FixOutcome[]>("apply_compat_fixes", { instanceId, plan });
      setOutcomes(result);
      setPhase("done");
    } catch (reason) {
      setError(String(reason));
      setPhase("failed");
    } finally {
      // The folder changed; every view of it is stale.
      void queryClient.invalidateQueries({ queryKey: ["modCompat", instanceId] });
      void queryClient.invalidateQueries({ queryKey: ["minecraftContent", instanceId] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.instances });
    }
  };

  const close = () => {
    if (phase === "applying") return;
    onOpenChange(false);
  };

  const done = progress.data?.done ?? 0;
  const total = progress.data?.total ?? doable.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-8">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-300">
              <Wrench className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-left">{title(phase, willDo.length, t)}</DialogTitle>
              <DialogDescription className="mt-1 text-left">
                {description(phase, willDo.length, wontTouch.length, outcomes, t)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {phase === "planning" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {t("Looking at what each mod needs…")}
          </div>
        )}

        {phase === "failed" && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {phase === "applying" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                <span className="truncate text-muted-foreground">
                  {progress.data?.name ?? t("Starting…")}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {done} / {total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary/40">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {(phase === "ready" || phase === "applying") && plan && (
          <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
            {willDo.length > 0 && (
              <Group title={t("Will be done")}>
                {willDo.map((step, index) => (
                  <StepRow key={index} step={step} />
                ))}
              </Group>
            )}
            {offered.length > 0 && (
              <Group title={t("Will be disabled")}>
                {offered.map((step, index) => (
                  <StepRow key={index} step={step} />
                ))}
              </Group>
            )}
            {wontTouch.length > 0 && (
              <Group title={t("Left alone")}>
                {wontTouch.map((step, index) => (
                  <StepRow key={index} step={step} />
                ))}
              </Group>
            )}
          </div>
        )}

        {phase === "done" && outcomes && (
          <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
            {outcomes.map((outcome, index) => (
              <li key={index} className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm">
                {outcome.ok ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                )}
                <span className="min-w-0">
                  <span className="block font-medium">{subject(outcome.step)}</span>
                  <span className="block text-xs text-muted-foreground">{outcome.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="gap-2">
          {phase === "ready" && (
            <>
              <Button variant="ghost" onClick={close}>
                {t("Not now")}
              </Button>
              {doable.length > 0 && (
                <Button variant="primary" onClick={() => void apply()}>
                  <Wrench className="h-4 w-4" />
                  {doable.length === 1
                    ? t("Fix it")
                    : t("Fix {count} things").replace("{count}", String(doable.length))}
                </Button>
              )}
            </>
          )}
          {(phase === "done" || phase === "failed") && (
            <Button variant="primary" onClick={close}>
              <Check className="h-4 w-4" />
              {t("Got it")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function title(phase: Phase, count: number, t: (key: string) => string): string {
  switch (phase) {
    case "planning":
      return t("Working out what to do");
    case "applying":
      return t("Fixing…");
    case "done":
      return t("Done");
    case "failed":
      return t("Could not plan a fix");
    default:
      return count === 0
        ? t("Nothing the launcher can fix by itself")
        : count === 1
          ? t("One thing to fix")
          : t("{count} things to fix").replace("{count}", String(count));
  }
}

function description(
  phase: Phase,
  willDo: number,
  wontTouch: number,
  outcomes: FixOutcome[] | null,
  t: (key: string) => string,
): string {
  if (phase === "done" && outcomes) {
    const failed = outcomes.filter((outcome) => !outcome.ok).length;
    return failed === 0
      ? t("Everything in the plan went through. The report will update itself.")
      : t("{failed} of {total} steps could not be done; each says why.")
          .replace("{failed}", String(failed))
          .replace("{total}", String(outcomes.length));
  }
  if (phase !== "ready") return "";
  if (willDo === 0 && wontTouch > 0) {
    return t("Each problem below is one the launcher looked at and will not touch on its own, and it says why.");
  }
  return t(
    "Each change satisfies every mod that depends on it, not only the one that complained. Nothing happens until you say so.",
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="space-y-1.5 border-l border-border/40 pl-3">{children}</ul>
    </section>
  );
}

function subject(step: FixStep): string {
  switch (step.action) {
    case "install":
      return step.name;
    default:
      return step.file_name;
  }
}

function StepRow({ step }: { step: FixStep }) {
  const { t } = useI18n();
  const icon =
    step.action === "install" ? (
      <Download className="h-4 w-4 text-emerald-400" />
    ) : step.action === "replace" ? (
      <RefreshCw className="h-4 w-4 text-sky-300" />
    ) : step.action === "disable" ? (
      <Ban className="h-4 w-4 text-amber-400" />
    ) : (
      <X className="h-4 w-4 text-muted-foreground" />
    );

  const line =
    step.action === "install"
      ? t("Install {name} {version}").replace("{name}", step.name).replace("{version}", step.version)
      : step.action === "replace"
        ? t("Replace with {version}").replace("{version}", step.version)
        : step.action === "disable"
          ? t("Disable")
          : t("Leave as it is");

  const why =
    step.action === "replace" || step.action === "disable" || step.action === "unfixable"
      ? step.reason
      : null;

  return (
    <li className={cn("flex items-start gap-2 text-sm", step.action === "unfixable" && "opacity-80")}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block">
          <span className="font-medium">{subject(step)}</span>
          <span className="text-muted-foreground"> — {line}</span>
        </span>
        {why && <span className="block text-xs leading-snug text-muted-foreground">{why}</span>}
      </span>
    </li>
  );
}
