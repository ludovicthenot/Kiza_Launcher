import { useEffect, useRef } from "react";
import { useAppStore } from "../../lib/store";
import { gsap, useGSAP, prefersReducedMotion } from "../../lib/animation";
import { useInstances, updateDiscordStatus } from "../../lib/queries";
import { InstanceSidebar } from "../instance/InstanceSidebar";
import { InstanceHeader } from "../instance/InstanceHeader";
import { InstalledContentTab } from "../instance/content/InstalledContentTab";
import { ProfilesTab } from "../instance/profiles/ProfilesTab";
import { DiscoverTab } from "../instance/discover/DiscoverTab";
import { WorldsTab } from "../instance/worlds/WorldsTab";
import { InstanceManagementTab } from "../instance/management/InstanceManagementTab";
import { InstanceActivityTab } from "../instance/activity/InstanceActivityTab";
import { Loader2 } from "lucide-react";
import { discordActivityForInstanceView } from "../../lib/discord-presence";

export function InstanceView() {
  const selectedInstanceId = useAppStore((state) => state.selectedInstanceId);
  const activeTab = useAppStore((state) => state.activeTab);
  const contentCategory = useAppStore((state) => state.contentCategory);
  
  // Fetch instance summary directly from the cache or list
  const { data: instances } = useInstances();
  const instance = instances?.find(i => i.id === selectedInstanceId);

  useEffect(() => {
    if (instance) {
      updateDiscordStatus(
        instance.id,
        discordActivityForInstanceView(activeTab, contentCategory),
      );
    }
  }, [instance?.id, activeTab, contentCategory]);

  const containerRef = useRef<HTMLDivElement>(null);
  const hasInstance = !!instance;

  // Entrance: sidebar slides in from the left, header settles from above.
  useGSAP(() => {
    if (!hasInstance || prefersReducedMotion()) return;
    gsap.timeline({ defaults: { ease: "power3.out" } })
      .from('[data-anim="instance-sidebar"]', { x: -18, opacity: 0, duration: 0.4 })
      .from('[data-anim="instance-top"]', { y: -10, opacity: 0, duration: 0.35 }, "-=0.25");
  }, { dependencies: [hasInstance], scope: containerRef });

  /**
   * Cross-tab transition.
   *
   * Between the installed content and Discover the panel slides horizontally,
   * and the direction carries meaning: browsing enters from the right, coming
   * back leaves toward it. Moving between unrelated tabs has no direction to
   * express, so it stays a short rise.
   */
  const previousTab = useRef(activeTab);
  useGSAP(() => {
    if (!hasInstance || prefersReducedMotion()) {
      previousTab.current = activeTab;
      return;
    }

    const from = previousTab.current;
    previousTab.current = activeTab;

    const horizontal =
      (from === "mods" && activeTab === "discover") ||
      (from === "discover" && activeTab === "mods");

    gsap.from('[data-anim="instance-tab"] > *', {
      // Entering Discover comes from the right; going back comes from the left.
      x: horizontal ? (activeTab === "discover" ? 48 : -48) : 0,
      y: horizontal ? 0 : 10,
      opacity: 0,
      duration: horizontal ? 0.34 : 0.3,
      ease: horizontal ? "power3.out" : "power2.out",
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
        {/* Everywhere except Discover, which is a full-width browser of its
            own. Mods used to be excluded as well, which meant the one page
            people spend the most time on was also the only page with no Play
            button, no instance name and no Sync — you had to leave it to
            launch the very instance you were editing. */}
        {activeTab !== "discover" && (
          <div data-anim="instance-top" className="flex shrink-0 flex-col">
            <InstanceHeader instance={instance} />
          </div>
        )}

        {/* Tab Content */}
        <div data-anim="instance-tab" className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
          {activeTab === 'mods' && <InstalledContentTab instance={instance} />}
          {activeTab === 'discover' && <DiscoverTab instance={instance} />}
          {activeTab === 'profiles' && <ProfilesTab instanceId={instance.id} />}
          {activeTab === 'worlds' && <WorldsTab instance={instance} />}
          {activeTab === 'settings' && <InstanceManagementTab instance={instance} />}
          {activeTab === 'logs' && <InstanceActivityTab instance={instance} />}
        </div>
      </div>
    </div>
  );
}
