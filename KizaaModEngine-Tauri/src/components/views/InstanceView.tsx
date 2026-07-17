import { useEffect } from "react";
import { useAppStore } from "../../lib/store";
import { useInstances, updateDiscordStatus } from "../../lib/queries";
import { InstanceSidebar } from "../instance/InstanceSidebar";
import { InstanceHeader } from "../instance/InstanceHeader";
import { ModsTab } from "../instance/mods/ModsTab";
import { ProfilesTab } from "../instance/profiles/ProfilesTab";
import { HealthTab } from "../instance/health/HealthTab";
import { ConflictsTab } from "../instance/conflicts/ConflictsTab";
import { DiscoverTab } from "../instance/discover/DiscoverTab";
import { ShadersTab } from "../instance/shaders/ShadersTab";
import { DownloadsView } from "./DownloadsView";
import { ArrowLeft, Loader2 } from "lucide-react";

export function InstanceView() {
  const selectedInstanceId = useAppStore((state) => state.selectedInstanceId);
  const setSelectedInstanceId = useAppStore((state) => state.setSelectedInstanceId);
  const activeTab = useAppStore((state) => state.activeTab);
  
  // Fetch instance summary directly from the cache or list
  const { data: instances } = useInstances();
  const instance = instances?.find(i => i.id === selectedInstanceId);

  useEffect(() => {
    if (instance) {
      updateDiscordStatus(instance.id);
    }
  }, [instance?.id]);

  if (!instance) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <InstanceSidebar />
      
      <div className="flex-1 flex flex-col min-w-0 bg-background/50">
        <div className="flex flex-col shrink-0">
           {/* Top Navigation Bar with Back Button */}
           <div className="h-14 border-b border-border/50 px-4 flex items-center gap-4 bg-card/50 backdrop-blur-sm">
             <button 
              onClick={() => setSelectedInstanceId(null)}
              className="p-2 hover:bg-secondary rounded-lg transition-colors text-muted-foreground hover:text-primary"
              title="Retour aux instances"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="h-6 w-px bg-border/50" />
            <span className="font-semibold text-sm text-muted-foreground">Instance Minecraft</span>
           </div>
           
           {/* Instance Header */}
           <InstanceHeader instance={instance} />
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {activeTab === 'mods' && <ModsTab instanceId={instance.id} />}
          {activeTab === 'discover' && <DiscoverTab instance={instance} />}
          {activeTab === 'shaders' && <ShadersTab instance={instance} />}
          {activeTab === 'profiles' && <ProfilesTab instanceId={instance.id} />}
          {activeTab === 'health' && <HealthTab instanceId={instance.id} />}
          {activeTab === 'conflicts' && <ConflictsTab instanceId={instance.id} />}
          {activeTab === 'downloads' && <DownloadsView />}
        </div>
      </div>
    </div>
  );
}
