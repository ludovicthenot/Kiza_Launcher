import { useVerifyInstance, useInstances, useUndeployMods } from "../../../lib/queries";
import { CheckCircle2, AlertTriangle, RefreshCw, Wrench, FileWarning, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "../../../lib/utils";
import { formatDistanceToNow } from "date-fns";
import { fr as frDateLocale } from "date-fns/locale";
import { StatusBadge } from "../../common/StatusBadge";
import { useState } from "react";
import { ConfirmActionDialog } from "../../ui/confirm-action-dialog";
import { useI18n } from "../../../lib/i18n";

interface HealthTabProps {
  instanceId: string;
}

export function HealthTab({ instanceId }: HealthTabProps) {
  const { t, lang } = useI18n();
  const verifyInstance = useVerifyInstance();
  const undeployMods = useUndeployMods();
  const { data: instances } = useInstances();
  const instance = instances?.find(i => i.id === instanceId);
  const [confirmUndeploy, setConfirmUndeploy] = useState(false);

  // TODO: In a real app, we would fetch a detailed diagnostic report from the backend
  // For now, we rely on the instance status and simulate a report structure based on it
  
  const handleVerify = () => {
    verifyInstance.mutate(instanceId);
  };

  const handleUndeploy = () => {
    setConfirmUndeploy(true);
  };

  const isHealthy = instance?.status === 'Valid';
  const lastChecked = instance?.last_verified_at
    ? t("{time} ago").replace(
        "{time}",
        formatDistanceToNow(new Date(instance.last_verified_at), { locale: lang === "fr" ? frDateLocale : undefined }),
      )
    : t("Never");

  return (
    <div className="flex-1 flex flex-col p-6 gap-6 overflow-y-auto">
      <ConfirmActionDialog
        open={confirmUndeploy}
        onOpenChange={setConfirmUndeploy}
        title={t("Undeploy all mod files")}
        description={t("This removes every Kiza Launcher-managed file from the Minecraft directory. Mods and profiles stay in the library and can be deployed again.")}
        confirmLabel={t("Undeploy")}
        destructive
        busy={undeployMods.isPending}
        onConfirm={() => {
          undeployMods.mutate(instanceId, { onSettled: () => setConfirmUndeploy(false) });
        }}
      />
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xl font-bold">{t("Instance health")}</h2>
          <p className="text-muted-foreground text-sm">{t("Diagnostics and repair tools")}</p>
        </div>
        <button
          onClick={handleVerify}
          disabled={verifyInstance.isPending}
          className="h-9 px-4 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg font-medium flex items-center gap-2 text-sm transition-colors"
        >
          <RefreshCw className={cn("w-4 h-4", verifyInstance.isPending && "animate-spin")} />
          {t("Run diagnostics")}
        </button>
      </div>

      {/* Main Status Card */}
      <div className={cn(
        "rounded-xl border p-6 flex items-start gap-4 shadow-sm",
        isHealthy 
          ? "bg-emerald-500/5 border-emerald-500/20" 
          : "bg-destructive/5 border-destructive/20"
      )}>
        <div className={cn(
          "p-3 rounded-full shrink-0",
          isHealthy ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"
        )}>
          {isHealthy ? <CheckCircle2 className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold mb-1">
            {isHealthy ? t("System operational") : t("Issues detected")}
          </h3>
          <p className="text-muted-foreground text-sm mb-4">
            {isHealthy
              ? t("All systems are functioning normally. Your modding environment is stable.")
              : `${t("The instance reports an issue. Some features may be limited.")} (${instance?.status})`}
          </p>
          
          <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
             <div className="flex items-center gap-1.5">
               <RefreshCw className="w-3.5 h-3.5" />
               {t("Last checked")}: {lastChecked}
             </div>
             <div className="h-3 w-px bg-border" />
             <div className="flex items-center gap-1.5">
               <StatusBadge status={instance?.status || 'Unverified'} />
             </div>
          </div>
        </div>
      </div>

      {/* Issues List (Simulated for now) */}
      {!isHealthy && (
        <div className="space-y-4">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("Detected issues")}</h3>
          
          {instance?.status === 'MissingPath' && (
             <div className="bg-card border border-border/50 rounded-lg p-4 flex items-start gap-3">
               <FileWarning className="w-5 h-5 text-destructive mt-0.5" />
               <div className="flex-1">
                 <h4 className="font-medium text-foreground">Game Folder Missing</h4>
                 <p className="text-sm text-muted-foreground mt-1">
                   The directory at <code className="bg-secondary px-1 py-0.5 rounded text-xs">{instance.install_path}</code> could not be found.
                   Reinstall the instance from its header to recreate it.
                 </p>
               </div>
             </div>
          )}

          {instance?.status === 'NoWriteAccess' && (
             <div className="bg-card border border-border/50 rounded-lg p-4 flex items-start gap-3">
               <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5" />
               <div className="flex-1">
                 <h4 className="font-medium text-foreground">Read-Only Permissions</h4>
                 <p className="text-sm text-muted-foreground mt-1">
                   The application does not have write access to the game directory, so mod deployment will fail.
                   Check the folder permissions in Windows, then run diagnostics again.
                 </p>
               </div>
             </div>
          )}
        </div>
      )}

      {/* Repair Actions */}
      {!isHealthy && (
         <div className="mt-4 p-4 rounded-lg bg-secondary/20 border border-border/50">
           <h3 className="font-semibold mb-3 flex items-center gap-2">
             <Wrench className="w-4 h-4" />
             {t("Repair actions")}
           </h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
             <button 
                onClick={handleVerify}
                disabled={verifyInstance.isPending}
                className="flex items-center justify-between p-3 bg-card border border-border/50 rounded-lg hover:border-primary/50 transition-all text-left group disabled:opacity-50"
             >
               <div>
                 <div className="font-medium text-sm flex items-center gap-2">
                    {t("Re-scan game integrity")}
                    {verifyInstance.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                 </div>
                 <div className="text-xs text-muted-foreground">{t("Verify game files against signature")}</div>
               </div>
               <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
             </button>
             
             <button 
                onClick={handleUndeploy}
                disabled={undeployMods.isPending || instance?.status === 'MissingPath'}
                className="flex items-center justify-between p-3 bg-card border border-border/50 rounded-lg hover:border-primary/50 transition-all text-left group disabled:opacity-50"
             >
               <div>
                 <div className="font-medium text-sm flex items-center gap-2">
                    {t("Purge deployment")}
                    {undeployMods.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                 </div>
                 <div className="text-xs text-muted-foreground">{t("Remove all mod links (Undeploy)")}</div>
               </div>
               <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
             </button>
           </div>
         </div>
      )}
    </div>
  );
}
