import { useEffect, useRef } from "react";
import { useAppStore } from "../../lib/store";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";
import { useI18n } from "../../lib/i18n";
import { useInstances, updateDiscordStatus } from "../../lib/queries";
import { InstanceSidebar } from "../instance/InstanceSidebar";
import { InstanceHeader } from "../instance/InstanceHeader";
import { InstalledContentTab } from "../instance/content/InstalledContentTab";
import { ProfilesTab } from "../instance/profiles/ProfilesTab";
import { DiscoverTab } from "../instance/discover/DiscoverTab";
import { InstanceManagementTab } from "../instance/management/InstanceManagementTab";
import { InstanceActivityTab } from "../instance/activity/InstanceActivityTab";
import { ArrowLeft, Loader2 } from "lucide-react";

export function InstanceView() {
  const { t } = useI18n();
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

  const containerRef = useRef<HTMLDivElement>(null);
  const hasInstance = !!instance;

  // Entrance: sidebar slides in from the left, header settles from above.
  useGSAP(() => {
    if (!hasInstance || prefersReducedMotion()) return;
    gsap.timeline({ defaults: { ease: "power3.out" } })
      .from('[data-anim="instance-sidebar"]', { x: -18, opacity: 0, duration: 0.4 })
      .from('[data-anim="instance-top"]', { y: -10, opacity: 0, duration: 0.35 }, "-=0.25");
  }, { dependencies: [hasInstance], scope: containerRef });

  // Cross-tab transition: the incoming tab content fades and rises slightly.
  useGSAP(() => {
    if (!hasInstance || prefersReducedMotion()) return;
    gsap.from('[data-anim="instance-tab"] > *', {
      y: 10,
      opacity: 0,
      duration: 0.3,
      ease: "power2.out",
      overwrite: "auto",
      clearProps: "transform,opacity",
    });
  }, { dependencies: [hasInstance, activeTab], scope: containerRef });

  if (!instance) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 flex overflow-hidden">
      <div data-anim="instance-sidebar" className="flex shrink-0">
        <InstanceSidebar />
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background/50">
        <div data-anim="instance-top" className="flex flex-col shrink-0">
           {/* Top Navigation Bar with Back Button */}
           <div className="h-14 border-b border-border/50 px-4 flex items-center gap-4 bg-card/50 backdrop-blur-sm">
             <button 
              onClick={() => setSelectedInstanceId(null)}
              className="p-2 hover:bg-secondary rounded-lg transition-colors text-muted-foreground hover:text-primary"
              title={t("Back to instances")}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="h-6 w-px bg-border/50" />
            <span className="font-semibold text-sm text-muted-foreground">{t("Minecraft instance")}</span>
           </div>
           
           {/* Instance Header */}
           <InstanceHeader instance={instance} />
        </div>

        {/* Tab Content */}
        <div data-anim="instance-tab" className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
          {activeTab === 'mods' && <InstalledContentTab instance={instance} />}
          {activeTab === 'discover' && <DiscoverTab instance={instance} />}
          {activeTab === 'profiles' && <ProfilesTab instanceId={instance.id} />}
          {activeTab === 'settings' && <InstanceManagementTab instance={instance} />}
          {activeTab === 'logs' && <InstanceActivityTab instance={instance} />}
        </div>
      </div>
    </div>
  );
}
