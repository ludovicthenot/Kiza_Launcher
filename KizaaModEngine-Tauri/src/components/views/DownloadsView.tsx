import { useDownloads, usePauseDownload, useResumeDownload, useCancelDownload, useInstallDownload } from "../../lib/queries";
import { DownloadJob, DownloadState } from "../../lib/types";
import { formatBytes, cn } from "../../lib/utils";
import { Pause, Play, X, Loader2, Download as DownloadIcon, Box, AlertCircle } from "lucide-react";
import { useState } from "react";
import { InstanceSelectionModal } from "./InstanceSelectionModal";
import { GameInstance } from "../../lib/types";

export function DownloadsView() {
  const { data: downloads, isLoading } = useDownloads();
  const [selectionState, setSelectionState] = useState<{
    isOpen: boolean;
    jobId: string | null;
    candidates: GameInstance[];
    gameDomain: string | null;
  }>({
    isOpen: false,
    jobId: null,
    candidates: [],
    gameDomain: null
  });

  const install = useInstallDownload();

  const handleInstallRequest = (job: DownloadJob) => {
    install.mutate({ jobId: job.id }, {
      onSuccess: (result) => {
        if (result.NeedsInstanceSelection) {
          setSelectionState({
            isOpen: true,
            jobId: job.id,
            candidates: result.NeedsInstanceSelection.candidates,
            gameDomain: job.game_domain
          });
        }
      }
    });
  };

  const handleSelection = (instanceId: string) => {
    if (selectionState.jobId) {
      install.mutate({ jobId: selectionState.jobId, instanceId });
      setSelectionState(prev => ({ ...prev, isOpen: false }));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!downloads || downloads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <DownloadIcon className="w-12 h-12 mb-4 opacity-20" />
        <p>No active downloads</p>
      </div>
    );
  }

  return (
    <>
      <div className="h-full p-6 space-y-6 overflow-y-auto">
        <h1 className="text-2xl font-bold tracking-tight">Downloads</h1>
        
        <div className="space-y-4">
          {downloads.map((job) => (
            <DownloadItem 
              key={job.id} 
              job={job} 
              onInstallRequest={() => handleInstallRequest(job)}
              isPending={install.isPending && install.variables?.jobId === job.id}
            />
          ))}
        </div>
      </div>

      <InstanceSelectionModal 
        isOpen={selectionState.isOpen}
        onClose={() => setSelectionState(prev => ({ ...prev, isOpen: false }))}
        candidates={selectionState.candidates}
        onSelect={handleSelection}
        gameDomain={selectionState.gameDomain}
      />
    </>
  );
}

function DownloadItem({ job, onInstallRequest, isPending }: { job: DownloadJob; onInstallRequest: () => void; isPending: boolean }) {
  const pause = usePauseDownload();
  const resume = useResumeDownload();
  const cancel = useCancelDownload();

  const progress = job.total_bytes 
    ? (job.progress_bytes / job.total_bytes) * 100 
    : 0;

  const isIndeterminate = job.state === "Resolving" || (job.state === "Downloading" && !job.total_bytes);

  const statusText = getStatusText(job.state);
  const isFailed = typeof job.state === 'object' && ('Failed' in job.state || 'InstallFailed' in job.state);
  const isInstalled = typeof job.state === 'object' && 'Installed' in job.state;
  const isInstalling = job.state === "Installing";
  const isReadyToInstall = job.state === "ReadyToInstall" || job.state === "Downloaded";

  return (
    <div className="bg-secondary/30 border border-border rounded-lg p-4 space-y-3">
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium truncate" title={job.file_name_display || job.file_name}>
            {job.mod_name !== "Unknown Mod" ? job.mod_name : (job.file_name_display || job.file_name)}
          </h3>
          <p className="text-xs text-muted-foreground truncate">
            {job.version ? `v${job.version} • ` : ''}
            {job.game_domain ? `${job.game_domain} • ` : ''}
            {job.file_name}
          </p>
        </div>
        
        <div className="flex items-center gap-1">
           {isReadyToInstall && (
            <button
              onClick={onInstallRequest}
              disabled={isPending}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 transition-colors"
            >
              {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Box className="w-3 h-3" />}
              Install
            </button>
           )}

           {isInstalling && (
             <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-muted-foreground text-xs font-medium rounded-md">
                <Loader2 className="w-3 h-3 animate-spin" />
                Installing...
             </div>
           )}

           {isInstalled && (
             <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 text-green-500 text-xs font-medium rounded-md border border-green-500/20">
                <Box className="w-3 h-3" />
                Installed
             </div>
           )}

          {job.state === "Downloading" && (
            <button 
              onClick={() => pause.mutate(job.id)}
              disabled={pause.isPending}
              className="p-2 hover:bg-background rounded-full transition-colors"
              title="Pause"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          
          {(job.state === "Paused" || job.state === "Queued") && (
            <button 
              onClick={() => resume.mutate(job.id)}
              disabled={resume.isPending}
              className="p-2 hover:bg-background rounded-full transition-colors"
              title="Resume"
            >
              <Play className="w-4 h-4" />
            </button>
          )}

          {!isInstalled && !isInstalling && (
            <button 
              onClick={() => cancel.mutate(job.id)}
              disabled={cancel.isPending}
              className="p-2 hover:bg-destructive/10 text-destructive rounded-full transition-colors"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span className={cn(
            "font-medium flex items-center gap-1",
            isFailed ? "text-destructive" : "text-primary",
            (isInstalled || isReadyToInstall) && "text-green-500"
          )}>
             {isFailed && <AlertCircle className="w-3 h-3" />}
             {statusText}
          </span>
          <span>
            {formatBytes(job.progress_bytes)}
            {job.total_bytes && ` / ${formatBytes(job.total_bytes)}`}
          </span>
        </div>
        
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div 
            className={cn(
              "h-full transition-all duration-300",
              isFailed ? "bg-destructive" : isInstalled ? "bg-green-500" : "bg-primary",
              (isIndeterminate || isInstalling) && "animate-pulse w-full opacity-50"
            )}
            style={{ width: (isIndeterminate || isInstalling) ? '100%' : `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function getStatusText(state: DownloadState): string {
  if (typeof state === 'string') return state;
  if ('Failed' in state) return `Error: ${state.Failed}`;
  if ('Installed' in state) return `Installed`;
  if ('InstallFailed' in state) return `Installation Failed: ${state.InstallFailed}`;
  return 'Unknown';
}
