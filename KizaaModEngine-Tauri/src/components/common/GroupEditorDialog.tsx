import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LayoutGrid, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button, Input } from "../ui/primitives";
import { ColourPicker } from "../ui/colour-picker";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { GROUP_COLORS, type GroupCover, type GroupPatch, type InstanceGroup } from "../../lib/instanceGroups";
import type { GameInstanceSummary } from "../../lib/types";
import { GroupFace, MiniCover } from "./InstanceGroupCard";

/** Longest side of a picture a group keeps: it is stored with the groups, in this browser. */
const COVER_SIDE = 512;

/**
 * An image chosen from disk, made small enough to keep: scaled down to
 * `COVER_SIDE` on its longest side and encoded as WebP.
 */
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, COVER_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const imageOf = (cover: GroupCover | undefined) => (cover && "image" in cover ? cover.image : null);

const sameCover = (a: GroupCover | undefined, b: GroupCover | undefined) =>
  a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

/**
 * A group's name, colour and picture, changed together with the group shown
 * as it will look while they change: the card on the left repaints as a
 * colour or a picture is chosen, and nothing is kept until "Save".
 *
 * The picture is the first four instances (the default), one instance's
 * picture, or an image from disk.
 */
export function GroupEditorDialog({
  group,
  members,
  onOpenChange,
  onSave,
}: {
  /** The group being edited; null when the editor is closed. */
  group: InstanceGroup | null;
  members: GameInstanceSummary[];
  onOpenChange: (open: boolean) => void;
  onSave: (patch: GroupPatch) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [color, setColor] = useState(GROUP_COLORS[0]);
  const [cover, setCover] = useState<GroupCover | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // A fresh draft each time it opens on a group.
  useEffect(() => {
    if (!group) return;
    setName(group.name);
    setColor(group.color);
    setCover(group.cover);
  }, [group]);

  // The image of its own it has, or was just given: offered again after
  // another picture is chosen.
  const ownImage = imageOf(cover) ?? imageOf(group?.cover);

  const chooseImage = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      setCover({ image: await shrinkImage(file) });
    } catch {
      toast.error(t("This image could not be read"));
    } finally {
      setReading(false);
    }
  };

  const save = () => {
    if (!group) return;
    onSave({ name, color, cover });
  };

  const tile = (selected: boolean) =>
    cn(
      "relative aspect-[3/4] w-full overflow-hidden rounded-[12px] transition-[box-shadow,transform] duration-200 ease-drawer active:scale-95",
      "focus-visible:outline-none",
      selected ? "shadow-[0_0_0_2px_hsl(var(--background)),0_0_0_4px_var(--group-colour)]" : "hover:-translate-y-0.5",
    );

  return (
    <Dialog open={!!group} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t("Edit the group")}</DialogTitle>
          <DialogDescription>{t("Its name, its colour and the picture it shows when closed.")}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="grid gap-6 sm:grid-cols-[168px_1fr]"
          style={{ ["--group-colour" as string]: color }}
        >
          {/* The group as it will look. */}
          <div className="flex flex-col gap-2.5">
            <div
              className="kiza-card relative aspect-[3/4] w-full overflow-hidden border transition-[border-color,background] duration-300"
              style={{
                borderColor: `${color}40`,
                background: `linear-gradient(160deg, ${color}4d, ${color}14 65%), hsl(var(--card))`,
              }}
            >
              <span key={JSON.stringify(cover ?? null)} className="absolute inset-0 animate-in fade-in-0 zoom-in-[0.97] duration-300">
                <GroupFace group={{ color, cover }} members={members} />
              </span>
            </div>
            <span className="truncate px-0.5 text-[0.9375rem] font-semibold">
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle transition-colors duration-300" style={{ background: color }} />
              {name.trim() || group?.name}
            </span>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <label className="flex flex-col gap-1.5">
              <span className="text-[0.8125rem] font-semibold text-foreground/90">{t("Name")}</span>
              <Input autoFocus value={name} maxLength={48} onChange={(event) => setName(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
            </label>

            <div className="flex flex-col gap-2">
              <span className="text-[0.8125rem] font-semibold text-foreground/90">{t("Colour")}</span>
              <div className="flex flex-wrap items-center gap-2">
                {GROUP_COLORS.map((swatch) => {
                  const selected = swatch.toLowerCase() === color.toLowerCase();
                  return (
                    <button
                      key={swatch}
                      type="button"
                      aria-label={swatch}
                      aria-pressed={selected}
                      onClick={() => setColor(swatch)}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full transition-transform duration-200 ease-drawer hover:scale-110 active:scale-95",
                        selected && "shadow-[0_0_0_2px_hsl(var(--background)),0_0_0_4px_currentColor]",
                      )}
                      style={{ background: swatch, color: swatch }}
                    >
                      {selected && <Check className="h-3.5 w-3.5 text-white animate-in zoom-in-50 duration-150" strokeWidth={3} />}
                    </button>
                  );
                })}
                <ColourPicker value={color} onChange={setColor} label={t("Another colour")} variant="swatch" />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[0.8125rem] font-semibold text-foreground/90">{t("Picture")}</span>
              <div className="grid grid-cols-5 gap-2.5">
                <button type="button" title={t("Its instances")} onClick={() => setCover(undefined)} className={tile(!cover)}>
                  <span className="absolute inset-0 bg-secondary/50" />
                  <span className="absolute inset-[16%] grid grid-cols-2 grid-rows-2 gap-[10%]">
                    {members.slice(0, 4).map((member) => (
                      <MiniCover key={member.id} instance={member} className="rounded-[18%]" />
                    ))}
                  </span>
                  {members.length === 0 && <LayoutGrid className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground" />}
                </button>
                {members.slice(0, 8).map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    title={member.display_name}
                    onClick={() => setCover({ member: member.id })}
                    className={tile(!!cover && "member" in cover && cover.member === member.id)}
                  >
                    <MiniCover instance={member} className="absolute inset-0 rounded-none shadow-none ring-0" />
                  </button>
                ))}
                {ownImage && (
                  <button type="button" title={t("Your image")} onClick={() => setCover({ image: ownImage })} className={tile(!!cover && "image" in cover)}>
                    <img src={ownImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={reading}
                  title={t("Choose an image…")}
                  className={cn(
                    tile(false),
                    "flex flex-col items-center justify-center gap-1 border border-dashed border-border/70 bg-secondary/[0.25] text-muted-foreground hover:border-[var(--group-colour)] hover:text-foreground",
                  )}
                >
                  {reading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(event) => {
                    void chooseImage(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!group || (name.trim() === group.name && color === group.color && sameCover(cover, group.cover))}
            >
              {t("Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
