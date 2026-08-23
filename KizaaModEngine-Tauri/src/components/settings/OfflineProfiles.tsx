import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Loader2, Plus, Trash2, UserRound } from "lucide-react";
import {
  useCreateOfflineAccount,
  useDeleteOfflineAccount,
  useImportOfflineSkin,
  useOfflineAccounts,
} from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
import { Button, Input } from "../ui/primitives";

/**
 * Local play profiles: a saved name, and optionally a skin. Nothing here talks
 * to Mojang — these exist so the player picks a profile at launch instead of
 * retyping a username.
 */
export function OfflineProfiles() {
  const { t } = useI18n();
  const { data: profiles, isLoading } = useOfflineAccounts();
  const createProfile = useCreateOfflineAccount();
  const deleteProfile = useDeleteOfflineAccount();
  const importSkin = useImportOfflineSkin();
  const [newUsername, setNewUsername] = useState("");

  const handleCreate = () => {
    const username = newUsername.trim();
    if (!username) return;
    createProfile.mutate({ username }, { onSuccess: () => setNewUsername("") });
  };

  const handleImportSkin = async (id: string) => {
    const selected = await openFileDialog({
      multiple: false,
      filters: [{ name: t("Skin image"), extensions: ["png"] }],
    });
    if (typeof selected !== "string") return;
    importSkin.mutate({ id, sourcePath: selected });
  };

  return (
    <div className="rounded-lg border border-border/70 bg-secondary/10 p-4">
      <h3 className="text-sm font-semibold">{t("Offline profiles")}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("Saved names for playing without a Microsoft account. Pick one when launching an instance.")}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={newUsername}
          onChange={(event) => setNewUsername(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleCreate();
          }}
          placeholder={t("Username")}
          className="max-w-60"
        />
        <Button
          onClick={handleCreate}
          disabled={!newUsername.trim() || createProfile.isPending}
          variant="primary"
        >
          {createProfile.isPending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Plus className="h-4 w-4" />}
          {t("Add profile")}
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {!isLoading && (profiles ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">{t("No offline profile yet.")}</p>
        )}
        {(profiles ?? []).map((profile) => (
          <div
            key={profile.id}
            className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 bg-secondary/15 p-3"
          >
            <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-secondary/40">
              {profile.skin_path
                ? (
                  <img
                    src={convertFileSrc(profile.skin_path)}
                    alt=""
                    // The head is the top-left 8x8 of the 64x64 sheet, scaled up
                    // with no smoothing so it stays pixel art.
                    className="h-full w-full [image-rendering:pixelated]"
                    style={{
                      objectFit: "none",
                      objectPosition: "-8px -8px",
                      transform: "scale(5.5)",
                    }}
                  />
                )
                : <UserRound className="h-5 w-5 text-muted-foreground" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{profile.username}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{profile.uuid}</div>
            </div>
            <Button
              onClick={() => handleImportSkin(profile.id)}
              disabled={importSkin.isPending}
              title={t("Import a 64x64 skin image")}
            >
              <ImagePlus className="h-4 w-4" />
              {t("Skin")}
            </Button>
            <Button
              onClick={() => deleteProfile.mutate({ id: profile.id })}
              disabled={deleteProfile.isPending}
              variant="danger"
              title={t("Remove")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
