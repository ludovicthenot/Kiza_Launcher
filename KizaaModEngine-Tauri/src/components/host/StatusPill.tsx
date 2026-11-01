import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { ServerState } from "../../lib/hostQueries";
import { stateLabel, stateTone } from "./format";

/**
 * A server's state as a pill: a dot and a word. An online server's dot
 * breathes a soft halo, the one ambient motion on the page, so a running
 * server can be told from a stopped one at a glance; reduced motion keeps
 * the dot still.
 */
export function StatusPill({ state, className }: { state: ServerState; className?: string }) {
  const { t } = useI18n();
  const tone = stateTone(state);
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium", tone.ring, tone.text, className)}>
      <span className="relative flex h-1.5 w-1.5">
        {state === "online" && (
          <span aria-hidden className="absolute inset-0 rounded-full bg-emerald-400/60 animate-ping [animation-duration:2.4s] motion-reduce:hidden" />
        )}
        <span className={cn("relative h-1.5 w-1.5 rounded-full", tone.dot)} />
      </span>
      {t(stateLabel(state))}
    </span>
  );
}
