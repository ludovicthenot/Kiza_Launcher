import { Globe2 } from "lucide-react";
import { GameInstanceSummary } from "../../../lib/types";
import { useRunningInstances } from "../../../lib/queries";
import { useI18n } from "../../../lib/i18n";
import { WorldVaultPanel } from "../WorldVaultPanel";

/**
 * The World Vault for one instance.
 *
 * Worlds live in their own tab rather than under the instance settings: they
 * are the only part of an instance that cannot be downloaded again, and burying
 * their backups next to a delete button is not where anyone would look for
 * them.
 */
export function WorldsTab({ instance }: { instance: GameInstanceSummary }) {
  const { t } = useI18n();
  const { data: runningInstances } = useRunningInstances();
  const isRunning = !!runningInstances?.[instance.id];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <h2 className="flex items-center gap-2 text-xl font-bold text-balance">
            <Globe2 className="h-5 w-5 text-primary" />
            {t("Worlds & backups")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("A backup keeps only what changed since the previous one, so keeping several costs little.")}
          </p>
        </header>

        <WorldVaultPanel instanceId={instance.id} isRunning={isRunning} />
      </div>
    </div>
  );
}
