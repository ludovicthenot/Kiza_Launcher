import { useEffect, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Link2,
  Loader2,
  MoreHorizontal,
  Orbit,
  Pencil,
  Plus,
  RotateCcw,
  Shirt,
  Trash2,
  Undo2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "../../lib/store";
import { useMinecraftAccount } from "../../lib/queries";
import {
  useAddLibrarySkin,
  useApplySkin,
  useCurrentSkin,
  usePreviewSkin,
  useRemoveLibrarySkin,
  useRenameLibrarySkin,
  useResetSkin,
  useSetCape,
  useSetLibrarySkinVariant,
  useSkinLibrary,
  type LibrarySkin,
  type SkinSource,
  type SkinVariant,
} from "../../lib/skinQueries";
import { detectVariantOf, drawCapeFront, drawSkinFront, loadImage, pngDataUrl } from "../../lib/skinTexture";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Button, Input } from "../ui/primitives";
import { ConfirmActionDialog } from "../ui/confirm-action-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { SkinViewer3D, type SkinView } from "./SkinViewer3D";

/**
 * A skin being looked at: where it came from, its pixels, and the arm width
 * it was drawn for. `null` means the account's own skin is on the stand.
 */
interface Draft {
  source: SkinSource;
  dataUrl: string;
  variant: SkinVariant;
  label: string;
}

/**
 * The skin on the Microsoft account — seen, changed, and kept.
 *
 * The change is real: it goes through the same profile service Minecraft's
 * own site uses, so the game, every other launcher and every other device
 * see it. The library is Kiza's: a folder of PNGs the account can be put
 * back into with one click.
 */
export function SkinSettings() {
  const { t } = useI18n();
  const setShowSettings = useAppStore((state) => state.setShowSettings);
  const { data: account } = useMinecraftAccount();
  const signedIn = !!account;
  const current = useCurrentSkin(signedIn);
  const library = useSkinLibrary();
  const preview = usePreviewSkin();
  const apply = useApplySkin();
  const reset = useResetSkin();
  const setCape = useSetCape();
  const addToLibrary = useAddLibrarySkin();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [variant, setVariant] = useState<SkinVariant>("classic");
  // Still by default: a figure that turns is drawn twenty-four times a
  // second for as long as the page is open, and a figure that stands still
  // is drawn once. Orbit is a click away.
  const [view, setView] = useState<SkinView>("front");
  const [zoom, setZoom] = useState(1);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [naming, setNaming] = useState<{ source: SkinSource; suggested: string; variant: SkinVariant } | null>(null);

  // The account's own arm width is the starting point, until a draft says otherwise.
  useEffect(() => {
    if (!draft && current.data) setVariant(current.data.variant);
  }, [current.data, draft]);

  const currentDataUrl = current.data?.png_base64 ? pngDataUrl(current.data.png_base64) : null;
  const activeCape = current.data?.capes.find((cape) => cape.active) ?? null;
  const capeDataUrl = activeCape?.png_base64 ? pngDataUrl(activeCape.png_base64) : null;
  const shown = draft?.dataUrl ?? currentDataUrl;

  const lookAt = async (source: SkinSource, label: string) => {
    // A skin that cannot be previewed is said by the mutation; stay put.
    const base64 = await preview.mutateAsync(source).catch(() => null);
    if (!base64) return;
    const dataUrl = pngDataUrl(base64);
    let detected: SkinVariant = variant;
    try {
      detected = detectVariantOf(await loadImage(dataUrl));
    } catch {
      // Undecodable here is still a PNG the service may accept; keep the choice.
    }
    setDraft({ source, dataUrl, variant: detected, label });
    setVariant(detected);
  };

  const pickFile = async () => {
    const selected = await openFileDialog({
      multiple: false,
      filters: [{ name: t("Skin image"), extensions: ["png"] }],
    });
    if (typeof selected !== "string") return;
    const name = selected.split(/[\\/]/).pop() ?? selected;
    await lookAt({ kind: "file", path: selected }, name.replace(/\.png$/i, ""));
  };

  const importUrl = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    await lookAt({ kind: "url", url: trimmed }, trimmed.split("/").pop()?.replace(/\.png$/i, "") || "skin");
    setUrlOpen(false);
    setUrl("");
  };

  const applyDraft = () => {
    if (!draft) return;
    apply.mutate({ source: draft.source, variant }, { onSuccess: () => setDraft(null) });
  };

  const applyVariantOnly = () => {
    // Same pixels, other arms: the service needs the file again to change the variant.
    if (!current.data?.png_base64) return;
    apply.mutate({ source: { kind: "current" }, variant });
  };

  const saveDraft = () => {
    if (!draft) return;
    setNaming({ source: draft.source, suggested: draft.label, variant });
  };

  const saveCurrent = () => {
    if (!current.data?.png_base64) {
      toast.error(t("This account wears the default skin; there is nothing to save."));
      return;
    }
    setNaming({ source: { kind: "current" }, suggested: current.data.username, variant: current.data.variant });
  };

  const busy = apply.isPending || reset.isPending || preview.isPending;
  const variantChanged = !draft && current.data && variant !== current.data.variant;

  if (!signedIn) {
    return (
      <div className="rounded-xl bg-secondary/[0.32] p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
          <Shirt className="h-6 w-6" />
        </div>
        <h3 className="mt-3 text-sm font-semibold">{t("Minecraft skins")}</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {t("Sign in with a Microsoft account to see and change the skin on it. Offline profiles keep their own skin on the Accounts page.")}
        </p>
        <Button variant="primary" className="mt-4" onClick={() => setShowSettings(true, "accounts")}>
          <UserRound className="h-4 w-4" />
          {t("Go to Accounts")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t("Minecraft skins")}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("Preview, import and apply your skin. Changes go to your Microsoft account.")}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-secondary/40 px-3 py-1.5 text-sm">
          <UserRound className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{account.username}</span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* The stand */}
        <div className="relative overflow-hidden rounded-lg border border-border/70 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.14),transparent_65%)]">
          {current.isLoading ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("Reading your account's skin...")}
            </div>
          ) : current.isError ? (
            <div className="flex h-[420px] flex-col items-center justify-center gap-3 p-6 text-center text-sm">
              <p className="text-destructive">{String(current.error)}</p>
              <Button onClick={() => current.refetch()}>{t("Try again")}</Button>
            </div>
          ) : (
            <SkinViewer3D
              skin={shown}
              cape={capeDataUrl}
              variant={variant}
              view={view}
              zoom={zoom}
              className="h-[420px] w-full"
            />
          )}

          {/* Views, left */}
          <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-md border border-border/70 bg-background/70 p-1 backdrop-blur">
            {(
              [
                ["orbit", Orbit, t("Orbit")],
                ["front", UserRound, t("Front")],
                ["side", ChevronRight, t("Side")],
                ["back", ChevronLeft, t("Back view")],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={cn(
                  "flex w-14 flex-col items-center gap-0.5 rounded px-1 py-1.5 text-[11px] transition",
                  view === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Zoom, right */}
          <div className="absolute right-3 top-3 flex flex-col items-center gap-1 rounded-md border border-border/70 bg-background/70 p-1 backdrop-blur">
            <button type="button" className="rounded p-1 hover:bg-secondary/60" onClick={() => setZoom((z) => Math.min(2, z + 0.15))} aria-label={t("Zoom in")}>
              <Plus className="h-4 w-4" />
            </button>
            <input
              type="range"
              min={0.6}
              max={2}
              step={0.05}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              aria-label={t("Zoom")}
              className="h-28 w-4 accent-primary"
              style={{ writingMode: "vertical-lr", direction: "rtl" }}
            />
            <button type="button" className="rounded p-1 hover:bg-secondary/60" onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))} aria-label={t("Zoom out")}>
              <span className="block h-4 w-4 text-center leading-4">−</span>
            </button>
          </div>

          {/* Arms, bottom left; state, bottom right */}
          <div className="absolute bottom-3 left-3 flex rounded-md border border-border/70 bg-background/70 p-0.5 backdrop-blur">
            {(["classic", "slim"] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setVariant(id)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium transition",
                  variant === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {id === "classic" ? t("Classic") : t("Slim")}
              </button>
            ))}
          </div>
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-md border border-border/70 bg-background/70 px-2.5 py-1 text-xs backdrop-blur">
            {draft ? (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                {t("Preview")} · {draft.label}
              </>
            ) : variantChanged ? (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                {t("Arms changed, not applied")}
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                {t("Applied to {name}").replace("{name}", current.data?.username ?? account.username)}
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          <div className="rounded-xl bg-secondary/[0.32] p-4">
            <div className="text-sm font-semibold">{t("Skin actions")}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("Choose a skin or import your own.")}</p>
            <div className="mt-3 grid gap-2">
              <Button variant="primary" onClick={pickFile} disabled={busy}>
                <Upload className="h-4 w-4" />
                {t("Upload PNG")}
              </Button>
              <Button onClick={() => setUrlOpen((open) => !open)} disabled={busy}>
                <Link2 className="h-4 w-4" />
                {t("Import from URL")}
              </Button>
              {urlOpen && (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void importUrl();
                    }}
                    placeholder="https://…/skin.png"
                  />
                  <Button onClick={importUrl} disabled={!url.trim() || preview.isPending}>
                    {preview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </Button>
                </div>
              )}
              <Button
                onClick={() => document.getElementById("skin-library")?.scrollIntoView({ behavior: "smooth" })}
                disabled={busy}
              >
                <Shirt className="h-4 w-4" />
                {t("Choose from library")}
              </Button>
            </div>

            <div className="my-3 border-t border-border/60" />

            <div className="grid gap-2">
              {draft ? (
                <Button variant="primary" onClick={applyDraft} disabled={busy}>
                  {apply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {t("Apply skin")}
                </Button>
              ) : (
                <Button variant="primary" onClick={applyVariantOnly} disabled={busy || !variantChanged}>
                  {apply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {variantChanged ? t("Apply arms") : t("Apply skin")}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                  if (current.data) setVariant(current.data.variant);
                }}
                disabled={busy || (!draft && !variantChanged)}
              >
                <Undo2 className="h-4 w-4" />
                {t("Reset to current skin")}
              </Button>
              {draft ? (
                <Button variant="ghost" onClick={saveDraft} disabled={busy || addToLibrary.isPending}>
                  <Plus className="h-4 w-4" />
                  {t("Save to library")}
                </Button>
              ) : (
                <Button variant="ghost" onClick={saveCurrent} disabled={busy || addToLibrary.isPending || !current.data?.png_base64}>
                  <Plus className="h-4 w-4" />
                  {t("Save current to library")}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={busy || !current.data?.png_base64}>
                <RotateCcw className="h-4 w-4" />
                {t("Back to the default skin")}
              </Button>
            </div>
          </div>

          <div className="flex gap-2 rounded-xl bg-secondary/[0.32] p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <div className="font-medium text-foreground">{t("Supported formats")}</div>
              {t("PNG skin files, 64x64 or 64x32 (classic). The arm width is detected from the image; correct it above if it guessed wrong.")}
            </div>
          </div>
        </div>
      </div>

      {/* Capes, when the account owns any */}
      {(current.data?.capes.length ?? 0) > 0 && (
        <div className="rounded-xl bg-secondary/[0.32] p-4">
          <div className="text-sm font-semibold">{t("Capes")}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("The capes your account owns. One at a time, or none.")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCape.mutate({ capeId: null })}
              disabled={setCape.isPending}
              className={cn(
                "flex h-[88px] w-20 flex-col items-center justify-center gap-1 rounded-md border text-xs transition",
                !activeCape ? "border-primary bg-primary/10 text-foreground" : "border-border/70 bg-background/45 text-muted-foreground hover:bg-secondary/40",
              )}
            >
              <X className="h-5 w-5" />
              {t("None")}
            </button>
            {current.data?.capes.map((cape) => (
              <button
                key={cape.id}
                type="button"
                onClick={() => setCape.mutate({ capeId: cape.id })}
                disabled={setCape.isPending}
                title={cape.alias}
                className={cn(
                  "flex h-[88px] w-20 flex-col items-center justify-center gap-1 rounded-md border text-xs transition",
                  cape.active ? "border-primary bg-primary/10 text-foreground" : "border-border/70 bg-background/45 text-muted-foreground hover:bg-secondary/40",
                )}
              >
                {cape.png_base64 ? <CapeThumb dataUrl={pngDataUrl(cape.png_base64)} /> : <Shirt className="h-5 w-5" />}
                <span className="max-w-full truncate px-1">{cape.alias}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Library
        skins={library.data ?? []}
        onLookAt={(skin) => lookAt({ kind: "library", id: skin.id }, skin.name)}
        onAdd={pickFile}
        busy={busy}
      />

      <NameDialog
        open={!!naming}
        title={t("Save to library")}
        initial={naming?.suggested ?? ""}
        busy={addToLibrary.isPending}
        onClose={() => setNaming(null)}
        onSubmit={(name) => {
          if (!naming) return;
          addToLibrary.mutate(
            { source: naming.source, name, variant: naming.variant },
            { onSuccess: () => setNaming(null) },
          );
        }}
      />

      <ConfirmActionDialog
        open={confirmReset}
        title={t("Back to the default skin?")}
        description={t("Your account goes back to Steve or Alex. The skin it wears now is not kept unless you saved it to the library.")}
        confirmLabel={t("Reset skin")}
        cancelLabel={t("Cancel")}
        destructive
        busy={reset.isPending}
        onOpenChange={setConfirmReset}
        onConfirm={() => {
          reset.mutate({}, { onSuccess: () => { setConfirmReset(false); setDraft(null); } });
        }}
      />
    </div>
  );
}

/**
 * The saved skins, newest first: a flat front view each, applied with a
 * click on the card and managed from the dots.
 */
function Library({
  skins,
  onLookAt,
  onAdd,
  busy,
}: {
  skins: LibrarySkin[];
  onLookAt: (skin: LibrarySkin) => void;
  onAdd: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const rename = useRenameLibrarySkin();
  const setVariant = useSetLibrarySkinVariant();
  const remove = useRemoveLibrarySkin();
  const apply = useApplySkin();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<LibrarySkin | null>(null);
  const [renaming, setRenaming] = useState<LibrarySkin | null>(null);

  return (
    <div id="skin-library" className="rounded-xl bg-secondary/[0.32] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{t("Your skins")}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("Manage your saved skins and quickly switch between them.")}</p>
        </div>
        <Button onClick={onAdd} disabled={busy}>
          <Plus className="h-4 w-4" />
          {t("Add new")}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
        {skins.map((skin) => (
          <div
            key={skin.id}
            className="group relative rounded-md bg-secondary/40 p-2 transition hover:border-primary/50"
          >
            <button
              type="button"
              onClick={() => onLookAt(skin)}
              disabled={busy}
              className="flex w-full flex-col items-center gap-2"
              title={t("Preview on the stand")}
            >
              {skin.png_base64 ? (
                <SkinThumb dataUrl={pngDataUrl(skin.png_base64)} variant={skin.variant} />
              ) : (
                <div className="flex h-24 w-12 items-center justify-center text-muted-foreground"><Shirt className="h-5 w-5" /></div>
              )}
              <span className="max-w-full truncate text-xs font-medium">{skin.name}</span>
            </button>
            <button
              type="button"
              onClick={() => setMenuFor(menuFor === skin.id ? null : skin.id)}
              className="absolute bottom-2 right-2 rounded border border-border/70 bg-background/80 p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 focus:opacity-100"
              aria-label={t("More")}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menuFor === skin.id && (
              <div className="absolute bottom-9 right-2 z-10 w-40 rounded-md border border-border bg-popover p-1 text-xs shadow-lg">
                <MenuItem
                  icon={Check}
                  label={t("Apply to account")}
                  onClick={() => {
                    setMenuFor(null);
                    apply.mutate({ source: { kind: "library", id: skin.id }, variant: skin.variant });
                  }}
                />
                <MenuItem
                  icon={Pencil}
                  label={t("Rename")}
                  onClick={() => {
                    setMenuFor(null);
                    setRenaming(skin);
                  }}
                />
                <MenuItem
                  icon={Shirt}
                  label={skin.variant === "slim" ? t("Mark as classic arms") : t("Mark as slim arms")}
                  onClick={() => {
                    setMenuFor(null);
                    setVariant.mutate({ id: skin.id, variant: skin.variant === "slim" ? "classic" : "slim" });
                  }}
                />
                <MenuItem
                  icon={Trash2}
                  label={t("Remove")}
                  destructive
                  onClick={() => {
                    setMenuFor(null);
                    setRemoving(skin);
                  }}
                />
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/70 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
        >
          <Plus className="h-6 w-6" />
          {t("Add skin")}
        </button>
      </div>

      <NameDialog
        open={!!renaming}
        title={t("Rename")}
        initial={renaming?.name ?? ""}
        busy={rename.isPending}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => {
          if (!renaming) return;
          if (name === renaming.name) {
            setRenaming(null);
            return;
          }
          rename.mutate({ id: renaming.id, name }, { onSuccess: () => setRenaming(null) });
        }}
      />

      <ConfirmActionDialog
        open={!!removing}
        title={t("Remove this skin from the library?")}
        description={removing ? `${removing.name} — ${t("the file is deleted. The skin on your account is not touched.")}` : ""}
        confirmLabel={t("Remove")}
        cancelLabel={t("Cancel")}
        destructive
        busy={remove.isPending}
        onOpenChange={(open) => !open && setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate({ id: removing.id }, { onSuccess: () => setRemoving(null) });
        }}
      />
    </div>
  );
}

/** One field, one name. */
function NameDialog({
  open,
  title,
  initial,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);
  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("Name this skin")}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {t("Save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: typeof Check;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition hover:bg-secondary/60",
        destructive && "text-destructive",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/** The figure from the front, four pixels per skin unit. */
function SkinThumb({ dataUrl, variant }: { dataUrl: string; variant: SkinVariant }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = 3;
  useEffect(() => {
    let cancelled = false;
    loadImage(dataUrl)
      .then((image) => {
        const context = canvas.current?.getContext("2d");
        if (cancelled || !context) return;
        context.clearRect(0, 0, 16 * scale, 32 * scale);
        drawSkinFront(context, image, variant, scale);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dataUrl, variant]);
  return <canvas ref={canvas} width={16 * scale} height={32 * scale} className="h-24 w-12" style={{ imageRendering: "pixelated" }} />;
}

function CapeThumb({ dataUrl }: { dataUrl: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = 3;
  useEffect(() => {
    let cancelled = false;
    loadImage(dataUrl)
      .then((image) => {
        const context = canvas.current?.getContext("2d");
        if (cancelled || !context) return;
        context.clearRect(0, 0, 10 * scale, 16 * scale);
        drawCapeFront(context, image, scale);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dataUrl]);
  return <canvas ref={canvas} width={10 * scale} height={16 * scale} className="h-12 w-[30px]" style={{ imageRendering: "pixelated" }} />;
}
