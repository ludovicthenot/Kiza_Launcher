/**
 * Everything the Skins page asks the backend.
 *
 * The account's skin is fetched when the page opens and after every change;
 * nothing polls. Textures travel as base64 PNG so the 3D preview never has
 * to ask a texture server for cross-origin permission.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { formatError, queryKeys } from "./queries";

export type SkinVariant = "classic" | "slim";

export interface Cape {
  id: string;
  alias: string;
  url: string;
  png_base64: string | null;
  active: boolean;
}

export interface CurrentSkin {
  username: string;
  uuid: string;
  png_base64: string | null;
  url: string | null;
  variant: SkinVariant;
  capes: Cape[];
}

export interface LibrarySkin {
  id: string;
  name: string;
  variant: SkinVariant;
  added_at: string;
  png_base64: string | null;
}

export type SkinSource =
  | { kind: "file"; path: string }
  | { kind: "url"; url: string }
  | { kind: "library"; id: string }
  | { kind: "current" };

export const skinKeys = {
  current: ["skin", "current"] as const,
  library: ["skin", "library"] as const,
};

export function useCurrentSkin(enabled: boolean) {
  return useQuery({
    queryKey: skinKeys.current,
    queryFn: async () => await invoke<CurrentSkin>("minecraft_skin_current"),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSkinLibrary() {
  return useQuery({
    queryKey: skinKeys.library,
    queryFn: async () => await invoke<LibrarySkin[]>("minecraft_skin_library"),
  });
}

/** The PNG a source names, base64, so it can be looked at before it goes on. */
export function usePreviewSkin() {
  return useMutation({
    mutationFn: async (source: SkinSource) =>
      await invoke<string>("minecraft_skin_preview", { source }),
    onError: (error) => toast.error(formatError(error)),
  });
}

function useSkinChange<TArgs>(command: string, done: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) =>
      await invoke<CurrentSkin>(command, args as never),
    onSuccess: (skin) => {
      queryClient.setQueryData(skinKeys.current, skin);
      // The head in the corner and the accounts page read the stored profile.
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftAccount });
      queryClient.invalidateQueries({ queryKey: queryKeys.minecraftAccounts });
      toast.success(done);
    },
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useApplySkin() {
  return useSkinChange<{ source: SkinSource; variant: SkinVariant }>(
    "minecraft_skin_apply",
    "Skin applied to your account",
  );
}

export function useResetSkin() {
  return useSkinChange<Record<string, never>>("minecraft_skin_reset", "Back to the default skin");
}

export function useSetCape() {
  return useSkinChange<{ capeId: string | null }>("minecraft_skin_set_cape", "Cape updated");
}

function useLibraryChange<TArgs>(command: string, done: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => await invoke<unknown>(command, args as never),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skinKeys.library });
      if (done) toast.success(done);
    },
    onError: (error) => toast.error(formatError(error)),
  });
}

export function useAddLibrarySkin() {
  return useLibraryChange<{ source: SkinSource; name: string; variant: SkinVariant }>(
    "minecraft_skin_library_add",
    "Skin saved to your library",
  );
}

export function useRenameLibrarySkin() {
  return useLibraryChange<{ id: string; name: string }>("minecraft_skin_library_rename", null);
}

export function useSetLibrarySkinVariant() {
  return useLibraryChange<{ id: string; variant: SkinVariant }>(
    "minecraft_skin_library_set_variant",
    null,
  );
}

export function useRemoveLibrarySkin() {
  return useLibraryChange<{ id: string }>("minecraft_skin_library_remove", "Skin removed from the library");
}
