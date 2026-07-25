import { useState } from "react";
import { useProfiles, useCreateProfile, useSwitchProfile, useDeleteProfile } from "../../../lib/queries";
import { Loader2, Plus, Copy, Trash2, Play } from "lucide-react";
import { cn } from "../../../lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ConfirmActionDialog } from "../../ui/confirm-action-dialog";

interface ProfilesTabProps {
  instanceId: string;
}

export function ProfilesTab({ instanceId }: ProfilesTabProps) {
  const { data: profileConfig, isLoading, error } = useProfiles(instanceId);
  const createProfile = useCreateProfile();
  const switchProfile = useSwitchProfile();
  const deleteProfile = useDeleteProfile();

  const [isCreating, setIsCreating] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [profileToDelete, setProfileToDelete] = useState<string | null>(null);

  const activeProfileId = profileConfig?.active_profile_id;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;

    try {
      await createProfile.mutateAsync({ instanceId, name: newProfileName });
      setIsCreating(false);
      setNewProfileName("");
    } catch (err) {
      console.error("Failed to create profile", err);
    }
  };

  const handleSwitch = (profileId: string) => {
    if (profileId === activeProfileId) return;
    switchProfile.mutate({ instanceId, profileId });
  };

  const handleDelete = (profileId: string) => {
    setProfileToDelete(profileId);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-destructive">
        Failed to load profiles
      </div>
    );
  }

  const profiles = profileConfig?.profiles || [];

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto p-6 gap-6">
      <ConfirmActionDialog
        open={!!profileToDelete}
        onOpenChange={(open) => !open && setProfileToDelete(null)}
        title="Delete profile"
        description="Delete this mod profile permanently. Mods remain installed, but this loadout cannot be restored."
        confirmLabel="Delete"
        destructive
        busy={deleteProfile.isPending}
        onConfirm={() => {
          if (!profileToDelete) return;
          deleteProfile.mutate({ instanceId, profileId: profileToDelete }, { onSettled: () => setProfileToDelete(null) });
        }}
      />
      {/* Header / Actions */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold">Profiles</h2>
          <p className="text-muted-foreground text-sm">Manage mod loadouts and configurations</p>
        </div>
        
        <button
          onClick={() => setIsCreating(true)}
          className="h-9 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium flex items-center gap-2 text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Profile
        </button>
      </div>

      {/* Creation Form */}
      {isCreating && (
        <form onSubmit={handleCreate} className="bg-card border border-border/50 rounded-xl p-4 flex gap-3 items-end animate-in fade-in slide-in-from-top-2">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm font-medium">Profile Name</label>
            <input
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder="e.g. Vanilla+, Hardcore, Testing..."
              className="w-full h-9 px-3 bg-secondary/50 border border-transparent focus:border-primary/50 focus:bg-background rounded-lg text-sm transition-all outline-none"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={() => setIsCreating(false)}
            className="h-9 px-4 hover:bg-secondary rounded-lg font-medium text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!newProfileName.trim() || createProfile.isPending}
            className="h-9 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium text-sm transition-colors flex items-center gap-2"
          >
            {createProfile.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
            Create
          </button>
        </form>
      )}

      {/* Profiles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {profiles.map((profile) => {
          const isActive = profile.id === activeProfileId;
          const isPending = switchProfile.isPending && switchProfile.variables?.profileId === profile.id;

          return (
            <div 
              key={profile.id}
              className={cn(
                "group relative bg-card border rounded-xl p-5 transition-all",
                isActive 
                  ? "border-primary/50 ring-1 ring-primary/20 bg-primary/5" 
                  : "border-border/50 hover:border-primary/30 hover:shadow-sm"
              )}
            >
              {isActive && (
                <div className="absolute top-3 right-3 px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider rounded-full border border-primary/20">
                  Active
                </div>
              )}

              <h3 className="font-bold text-lg mb-1">{profile.name}</h3>
              
              <div className="text-sm text-muted-foreground space-y-1 mb-4">
                <div className="flex justify-between">
                  <span>Mods enabled:</span>
                  <span className="font-mono text-foreground">{profile.mods_state?.filter(m => m.enabled).length ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Created:</span>
                  <span>{formatDistanceToNow(new Date(profile.created_at))} ago</span>
                </div>
                {profile.last_used_at && (
                   <div className="flex justify-between">
                    <span>Last used:</span>
                    <span>{formatDistanceToNow(new Date(profile.last_used_at))} ago</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-border/50">
                {!isActive ? (
                  <button
                    onClick={() => handleSwitch(profile.id)}
                    disabled={switchProfile.isPending}
                    className="flex-1 h-8 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    Activate
                  </button>
                ) : (
                   <div className="flex-1 h-8 flex items-center justify-center text-xs font-medium text-primary cursor-default">
                     Currently Active
                   </div>
                )}
                
                <button
                  onClick={() => handleDelete(profile.id)}
                  disabled={isActive || deleteProfile.isPending}
                  className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-inherit"
                  title="Delete Profile"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {/* Empty State Helper */}
        {profiles.length === 0 && !isCreating && (
          <div className="col-span-full flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed border-border/30 rounded-xl">
            <Copy className="w-10 h-10 mb-3 opacity-20" />
            <p>No profiles found. Create one to start managing mod lists.</p>
          </div>
        )}
      </div>
    </div>
  );
}
