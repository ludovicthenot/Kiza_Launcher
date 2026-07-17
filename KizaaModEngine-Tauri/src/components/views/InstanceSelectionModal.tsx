import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { GameInstance } from "../../lib/types";
import { Gamepad2, Check } from "lucide-react";
import { cn } from "../../lib/utils";

interface InstanceSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  candidates: GameInstance[];
  onSelect: (instanceId: string) => void;
  gameDomain?: string | null;
}

export function InstanceSelectionModal({ isOpen, onClose, candidates, onSelect, gameDomain }: InstanceSelectionModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Select Installation Target</DialogTitle>
          <DialogDescription>
            Multiple instances found for {gameDomain || "this game"}. Please select where you want to install this mod.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-4 max-h-[60vh] overflow-y-auto">
          {candidates.map((instance) => (
            <button
              key={instance.id}
              onClick={() => onSelect(instance.id)}
              className={cn(
                "flex items-start gap-4 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-secondary/50 transition-all text-left group",
                "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              )}
            >
              <div className="p-2 bg-secondary rounded-md group-hover:bg-background transition-colors">
                <Gamepad2 className="w-6 h-6 text-primary" />
              </div>
              
              <div className="flex-1 min-w-0">
                <h4 className="font-medium truncate">{instance.display_name}</h4>
                <p className="text-xs text-muted-foreground truncate mb-1">
                  {instance.install_path}
                </p>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                    instance.status === "Valid" ? "bg-green-500/10 text-green-500" : "bg-yellow-500/10 text-yellow-500"
                  )}>
                    {instance.status}
                  </span>
                  {instance.detected_variant && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                      {instance.detected_variant}
                    </span>
                  )}
                </div>
              </div>

              <div className="self-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Check className="w-5 h-5 text-primary" />
              </div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <button 
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
