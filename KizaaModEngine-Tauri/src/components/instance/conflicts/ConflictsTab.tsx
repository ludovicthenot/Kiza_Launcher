import { useConflicts, useMods } from "../../../lib/queries";
import { Loader2, ShieldAlert, CheckCircle2, FileText } from "lucide-react";
import { cn } from "../../../lib/utils";

interface ConflictsTabProps {
  instanceId: string;
}

export function ConflictsTab({ instanceId }: ConflictsTabProps) {
  const { data: conflicts, isLoading: conflictsLoading } = useConflicts(instanceId);
  const { data: mods } = useMods(instanceId);

  if (conflictsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Convert conflict map to array for rendering
  const conflictList = Object.entries(conflicts || {}).map(([path, modNames]) => ({
    path,
    modNames,
  }));

  if (conflictList.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
        <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mb-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">No Conflicts Detected</h3>
        <p className="max-w-sm text-center">
          Great! None of your active mods are trying to overwrite the same files.
        </p>
      </div>
    );
  }

  // Helper to determine winner based on load order
  // Note: This logic duplicates backend logic slightly but is needed for display.
  // Ideally backend should return "Winner" info.
  // For now, we assume the last mod in the list (if sorted by backend) is the winner, 
  // or we look up load orders from the mods list.
  
  const getWinner = (modNames: string[]) => {
    if (!mods) return modNames[modNames.length - 1]; // Fallback

    // Sort conflicting mods by load order
    const conflictingMods = modNames
      .map(name => mods.find(m => m.name === name))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .sort((a, b) => a.load_order - b.load_order);

    return conflictingMods[conflictingMods.length - 1]?.name || "Unknown";
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 text-orange-500" />
          File Conflicts
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          The following files are provided by multiple active mods. The mod with the highest load order (bottom of list) wins.
        </p>
      </div>

      <div className="grid gap-4">
        {conflictList.map(({ path, modNames }) => {
          const winner = getWinner(modNames);

          return (
            <div key={path} className="bg-card border border-border/50 rounded-xl overflow-hidden shadow-sm">
              {/* File Header */}
              <div className="bg-secondary/30 px-4 py-2 border-b border-border/50 flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <code className="text-xs font-mono text-foreground break-all">{path}</code>
              </div>

              {/* Conflict Body */}
              <div className="p-4">
                <div className="flex flex-col gap-2">
                  {modNames.map((modName) => {
                    const isWinner = modName === winner;
                    // We assume backend returns modNames, but ideally we'd want IDs to link back.
                    // For display, names are okay.
                    
                    return (
                      <div 
                        key={modName} 
                        className={cn(
                          "flex items-center justify-between p-2 rounded-lg border text-sm transition-all",
                          isWinner 
                            ? "bg-primary/10 border-primary/30 text-primary-foreground font-medium" 
                            : "bg-background border-border/50 text-muted-foreground opacity-70"
                        )}
                      >
                        <span className={cn(isWinner ? "text-primary" : "text-foreground")}>{modName}</span>
                        
                        {isWinner && (
                          <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                            Winner
                          </span>
                        )}
                        {!isWinner && (
                           <span className="text-[10px] text-muted-foreground px-2">
                             Overwritten
                           </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {/* Visual Flow */}
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground pl-1">
                   <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                   <span>Resolution strategy: </span>
                   <span className="font-medium text-foreground">Load Order</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
