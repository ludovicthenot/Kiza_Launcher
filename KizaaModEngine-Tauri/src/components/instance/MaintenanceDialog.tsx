import { useState } from "react";
import { useUndeployMods, useDeployMods, useScanResiduals, useDeleteResiduals } from "../../lib/queries";
import { Loader2, Trash2, RefreshCw, AlertTriangle, ShieldCheck, X, Search, FileQuestion } from "lucide-react";
import { ConfirmActionDialog } from "../ui/confirm-action-dialog";
import { IconButton } from "../ui/primitives";

interface MaintenanceDialogProps {
  instanceId: string;
  gameId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function MaintenanceDialog({ instanceId, gameId, isOpen, onClose }: MaintenanceDialogProps) {
  const undeployMods = useUndeployMods();
  const deployMods = useDeployMods();
  const scanResiduals = useScanResiduals();
  const deleteResiduals = useDeleteResiduals();
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'tools' | 'residuals'>('tools');
  const [suspectFiles, setSuspectFiles] = useState<string[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<null | 'purge' | 'redeploy' | 'cleanup'>(null);

  if (!isOpen) return null;

  const handlePurge = async () => {
    setPendingAction('purge');
  };

  const runPurge = async () => {
    setIsProcessing(true);
    try {
        await undeployMods.mutateAsync(instanceId);
    } catch (e) {
        // Error handled by mutation
    } finally {
        setIsProcessing(false);
    }
  };

  const handleForceRedeploy = async () => {
    setPendingAction('redeploy');
  };

  const runForceRedeploy = async () => {
    setIsProcessing(true);
    try {
        await undeployMods.mutateAsync(instanceId);
        await deployMods.mutateAsync({ instanceId, gameId });
    } catch (e) {
        // Error handled by mutation
    } finally {
        setIsProcessing(false);
    }
  };

  const handleScan = async () => {
    setIsProcessing(true);
    try {
        const files = await scanResiduals.mutateAsync(instanceId);
        setSuspectFiles(files);
        setHasScanned(true);
        // Auto-select all by default? No, safer to let user choose.
        setSelectedFiles(new Set());
    } catch (e) {
        // Error handled by mutation
    } finally {
        setIsProcessing(false);
    }
  };

  const handleCleanupResiduals = async () => {
    if (selectedFiles.size === 0) return;
    setPendingAction('cleanup');
  };

  const runCleanupResiduals = async () => {
    setIsProcessing(true);
    try {
        await deleteResiduals.mutateAsync({ 
            instanceId, 
            files: Array.from(selectedFiles) 
        });
        // Refresh scan
        handleScan();
    } catch (e) {
        // Error handled
    } finally {
        setIsProcessing(false);
    }
  };

  const confirmCopy = {
    purge: {
      title: "Purge deployed files",
      description: "This removes every Kiza Launcher Alpha-managed file from the Minecraft folder. Mods stay in the library and can be deployed again.",
      label: "Purge",
    },
    redeploy: {
      title: "Force redeploy",
      description: "This purges deployed files, then deploys every enabled mod again to repair broken links or missing files.",
      label: "Redeploy",
    },
    cleanup: {
      title: "Delete residual files",
      description: `Delete ${selectedFiles.size} selected unmanaged file(s) permanently. This cannot be undone.`,
      label: "Delete",
    },
  } as const;

  const runPendingAction = async () => {
    const action = pendingAction;
    if (!action) return;
    try {
      if (action === 'purge') await runPurge();
      if (action === 'redeploy') await runForceRedeploy();
      if (action === 'cleanup') await runCleanupResiduals();
    } finally {
      setPendingAction(null);
    }
  };

  const toggleFileSelection = (file: string) => {
    const newSet = new Set(selectedFiles);
    if (newSet.has(file)) {
        newSet.delete(file);
    } else {
        newSet.add(file);
    }
    setSelectedFiles(newSet);
  };

  const toggleAll = () => {
    if (selectedFiles.size === suspectFiles.length) {
        setSelectedFiles(new Set());
    } else {
        setSelectedFiles(new Set(suspectFiles));
    }
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <ConfirmActionDialog
        open={!!pendingAction}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={pendingAction ? confirmCopy[pendingAction].title : ""}
        description={pendingAction ? confirmCopy[pendingAction].description : ""}
        confirmLabel={pendingAction ? confirmCopy[pendingAction].label : "Confirm"}
        destructive={pendingAction === 'purge' || pendingAction === 'cleanup'}
        busy={isProcessing}
        onConfirm={runPendingAction}
      />
      <div className="bg-card border border-border w-full max-w-3xl max-h-[calc(100dvh-2rem)] min-h-0 flex flex-col rounded-xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="h-14 border-b border-border px-5 flex items-center justify-between bg-secondary/30 shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Maintenance Tools
          </h2>
          <IconButton
            onClick={onClose}
            disabled={isProcessing}
            className="hover:bg-destructive/10 hover:text-destructive"
            aria-label="Close maintenance"
          >
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
            <button 
                onClick={() => setActiveTab('tools')}
                className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'tools' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:bg-secondary/50'}`}
            >
                Standard Tools
            </button>
            <button 
                onClick={() => setActiveTab('residuals')}
                className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'residuals' ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:bg-secondary/50'}`}
            >
                External Cleaner (Experimental)
            </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
            {activeTab === 'tools' ? (
                <div className="space-y-6">
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex gap-3 text-sm text-amber-500">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                        <div>
                            <p className="font-semibold mb-1">Warning</p>
                            <p>
                                These tools only affect files deployed by <strong>Kiza Launcher Alpha</strong>. 
                                Files left by other mod managers (Vortex, MO2) or manual installations will NOT be removed unless you use the External Cleaner.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {/* Purge Option */}
                        <div className="border border-border rounded-lg p-4 hover:bg-secondary/20 transition-colors">
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2 font-semibold">
                                    <Trash2 className="w-4 h-4 text-destructive" />
                                    Purge Deployment
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground mb-4">
                                Removes all files and links created by Kiza Launcher Alpha. 
                                Useful to return the game to a clean state without uninstalling mods from the library.
                            </p>
                            <button 
                                onClick={handlePurge}
                                disabled={isProcessing}
                                className="w-full h-9 bg-destructive/10 hover:bg-destructive/20 text-destructive font-medium rounded-md transition-colors text-sm flex items-center justify-center gap-2"
                            >
                                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                Purge All Links
                            </button>
                        </div>

                        {/* Redeploy Option */}
                        <div className="border border-border rounded-lg p-4 hover:bg-secondary/20 transition-colors">
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2 font-semibold">
                                    <RefreshCw className="w-4 h-4 text-primary" />
                                    Clean & Redeploy
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground mb-4">
                                Completely removes all links and then re-deploys enabled mods.
                                Recommended if you suspect file corruption or broken symlinks.
                            </p>
                            <button 
                                onClick={handleForceRedeploy}
                                disabled={isProcessing}
                                className="w-full h-9 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-md transition-colors text-sm flex items-center justify-center gap-2"
                            >
                                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                Run Full Repair
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="h-full flex flex-col">
                    {!hasScanned ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                             <div className="w-16 h-16 bg-secondary/30 rounded-full flex items-center justify-center">
                                <Search className="w-8 h-8 text-muted-foreground" />
                             </div>
                             <div>
                                <h3 className="text-lg font-medium">Scan for Residuals</h3>
                                <p className="text-sm text-muted-foreground max-w-sm mt-1">
                                    This will scan your Minecraft folder for files that are NOT managed by Kiza Launcher Alpha. 
                                    Useful for finding leftover files from manual installs or other mod managers.
                                </p>
                             </div>
                             <button 
                                onClick={handleScan}
                                disabled={isProcessing}
                                className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium flex items-center gap-2 transition-colors"
                             >
                                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                Start Scan
                             </button>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col overflow-hidden">
                            <div className="flex items-center justify-between mb-4 shrink-0">
                                <div>
                                    <h3 className="font-medium">Suspect Files Found: {suspectFiles.length}</h3>
                                    <p className="text-xs text-muted-foreground">Select files to permanently delete.</p>
                                </div>
                                <div className="flex gap-2">
                                     <button 
                                        onClick={handleScan}
                                        disabled={isProcessing}
                                        className="px-3 py-1.5 text-xs bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                                     >
                                        Rescan
                                     </button>
                                     <button 
                                        onClick={handleCleanupResiduals}
                                        disabled={isProcessing || selectedFiles.size === 0}
                                        className="px-3 py-1.5 text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md transition-colors flex items-center gap-1"
                                     >
                                        <Trash2 className="w-3 h-3" />
                                        Delete Selected ({selectedFiles.size})
                                     </button>
                                </div>
                            </div>

                            <div className="flex-1 border border-border rounded-lg overflow-hidden flex flex-col">
                                <div className="bg-secondary/30 px-4 py-2 text-xs font-medium text-muted-foreground border-b border-border flex items-center gap-3">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedFiles.size === suspectFiles.length && suspectFiles.length > 0}
                                        onChange={toggleAll}
                                        className="rounded border-input"
                                    />
                                    <span>File Path (Relative to Game Root)</span>
                                </div>
                                <div className="flex-1 overflow-y-auto bg-card">
                                    {suspectFiles.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                                            <ShieldCheck className="w-8 h-8 mb-2 opacity-50 text-green-500" />
                                            <p>No unmanaged files found.</p>
                                            <p className="text-xs opacity-70">Your game folder seems clean!</p>
                                        </div>
                                    ) : (
                                        suspectFiles.map((file, idx) => (
                                            <div 
                                                key={idx} 
                                                className={`px-4 py-2 text-sm border-b border-border/50 flex items-center gap-3 hover:bg-secondary/20 cursor-pointer ${selectedFiles.has(file) ? 'bg-primary/5' : ''}`}
                                                onClick={() => toggleFileSelection(file)}
                                            >
                                                <input 
                                                    type="checkbox" 
                                                    checked={selectedFiles.has(file)}
                                                    readOnly
                                                    className="rounded border-input pointer-events-none"
                                                />
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <FileQuestion className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                                    <span className="truncate font-mono text-xs">{file}</span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
