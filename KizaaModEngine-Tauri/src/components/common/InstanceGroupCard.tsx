import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Folder, FolderMinus, Pencil } from "lucide-react";
import { gsap, prefersReducedMotion } from "../../lib/animation";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { useInstanceCover } from "../../lib/queries";
import type { GameInstanceSummary } from "../../lib/types";
import type { InstanceGroup } from "../../lib/instanceGroups";
import { hueOf } from "./InstancePoster";

/**
 * A group in the library grid, as a Discord folder.
 *
 * Closed, a card on its colour showing its picture (`GroupFace`). Open, it
 * heads its tray (`GroupTray`) and shows a folder instead, as Discord's open
 * folder does. A click opens or closes it; it is held and moved like an
 * instance (lib/cardDrag); the name is changed with a double click, and
 * everything else -- name, colour, picture -- in the editor the pencil or
 * the right-click menu opens. "Ungroup" leaves the instances where they are.
 */
export function InstanceGroupCard({
  group,
  members,
  dropTarget = false,
  inTray = false,
  onToggle,
  onRename,
  onUngroup,
  onEdit,
  onMenu,
}: {
  group: InstanceGroup;
  members: GameInstanceSummary[];
  /** A card is being held over it: letting go adds it to the group. */
  dropTarget?: boolean;
  /** Heading its open tray: a folder rather than the pictures. */
  inTray?: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onUngroup: () => void;
  onEdit: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);

  return (
    <div
      data-anim="poster"
      data-group-card={group.id}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      className="group flex w-full min-w-0 flex-col gap-2.5"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={group.open}
        className={cn(
          "kiza-card relative aspect-[3/4] w-full overflow-hidden border text-left",
          "transition-[transform,box-shadow,border-color] duration-300 ease-drawer active:scale-[0.98] active:duration-100 motion-reduce:transition-none",
          dropTarget ? "scale-[1.06]" : "group-hover:-translate-y-1",
        )}
        style={{
          borderColor: dropTarget ? group.color : `${group.color}40`,
          boxShadow: dropTarget ? `0 0 0 3px ${group.color}, 0 0 40px ${group.color}99` : undefined,
          background: inTray
            ? `linear-gradient(160deg, ${group.color}40, ${group.color}10 70%), hsl(var(--card))`
            : `linear-gradient(160deg, ${group.color}4d, ${group.color}14 65%), hsl(var(--card))`,
        }}
      >
        {inTray ? (
          // Open: the folder itself, in its colour, lit from behind, as
          // Discord's open folder is drawn.
          <span className="absolute inset-0 flex items-center justify-center">
            <span
              aria-hidden
              className="absolute inset-0 opacity-80 transition-opacity duration-300 group-hover:opacity-100"
              style={{ background: `radial-gradient(60% 45% at 50% 46%, ${group.color}59, transparent 70%)` }}
            />
            <span
              className="relative flex aspect-square w-[46%] items-center justify-center rounded-[28%] shadow-[0_14px_30px_-12px_rgb(0_0_0/0.65),inset_0_1px_0_rgb(255_255_255/0.25)] transition-transform duration-300 ease-drawer group-hover:scale-105"
              style={{ background: `linear-gradient(155deg, ${group.color}, ${group.color}b3)` }}
            >
              <Folder className="h-[48%] w-[48%] text-white" strokeWidth={1.8} style={{ fill: "rgb(255 255 255 / 0.22)" }} />
            </span>
          </span>
        ) : (
          <GroupFace group={group} members={members} />
        )}
        <span
          className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-transform duration-300 ease-drawer"
          style={{ transform: group.open ? "rotate(180deg)" : undefined }}
        >
          <ChevronDown className="h-4 w-4" />
        </span>
      </button>

      <div className="flex min-w-0 items-start gap-0.5 px-0.5">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              defaultValue={group.name}
              aria-label={t("Group name")}
              onBlur={(event) => {
                onRename(event.target.value);
                setEditing(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                if (event.key === "Escape") setEditing(false);
              }}
              className="w-full rounded-md bg-secondary/60 px-1.5 py-0.5 text-[0.9375rem] font-semibold outline-none ring-1 ring-primary/60"
            />
          ) : (
            <span
              onDoubleClick={() => setEditing(true)}
              title={t("Double-click to rename")}
              className="block truncate text-[0.9375rem] font-semibold"
            >
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle transition-colors duration-300" style={{ background: group.color }} />
              {group.name}
            </span>
          )}
          <span className="mt-0.5 block truncate text-[0.8125rem] text-muted-foreground">
            {t("{count} instances").replace("{count}", String(members.length))}
          </span>
        </div>
        {[
          { label: t("Edit the group"), Icon: Pencil, onClick: onEdit },
          { label: t("Ungroup"), Icon: FolderMinus, onClick: onUngroup },
        ].map(({ label, Icon, onClick }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            title={label}
            aria-label={label}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-white/[0.08] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * What a closed group shows: its own picture, or one of its instances',
 * full bleed under a wash of its colour with a folder badge saying how many
 * it holds -- or, without one, its first four instances two by two.
 */
export function GroupFace({ group, members }: { group: Pick<InstanceGroup, "color" | "cover">; members: GameInstanceSummary[] }) {
  const cover = group.cover;
  const memberId = cover && "member" in cover ? cover.member : "";
  const { data: memberCover } = useInstanceCover(memberId, !!memberId);
  if (!cover) {
    return (
      <span className="absolute inset-[13%] grid grid-cols-2 grid-rows-2 gap-[8%]">
        {members.slice(0, 4).map((member) => (
          <MiniCover key={member.id} instance={member} />
        ))}
      </span>
    );
  }
  const uri = "image" in cover ? cover.image : memberCover?.uri;
  const hue = hueOf(memberId || group.color);
  return (
    <span className="absolute inset-0">
      <span
        className="absolute inset-0"
        style={{ background: `linear-gradient(150deg, hsl(${hue} 60% 30%), hsl(${(hue + 50) % 360} 65% 12%))` }}
      />
      {uri && <img src={uri} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />}
      <span
        className="absolute inset-0"
        style={{ background: `linear-gradient(to top, ${group.color}d9 0%, ${group.color}40 34%, transparent 58%)` }}
      />
      <span
        className="absolute bottom-2.5 left-2.5 flex h-7 items-center gap-1.5 rounded-full pl-2 pr-2.5 text-[0.75rem] font-semibold tabular-nums text-white shadow-[0_6px_16px_-6px_rgb(0_0_0/0.6),inset_0_1px_0_rgb(255_255_255/0.25)] backdrop-blur-md"
        style={{ background: `${group.color}cc` }}
      >
        <Folder className="h-3.5 w-3.5" strokeWidth={2.2} style={{ fill: "rgb(255 255 255 / 0.25)" }} />
        {members.length}
      </span>
    </span>
  );
}

export function MiniCover({ instance, className }: { instance: GameInstanceSummary; className?: string }) {
  const { data: cover } = useInstanceCover(instance.id);
  const hue = hueOf(instance.id);
  return (
    <span
      className={cn("relative overflow-hidden rounded-[22%] shadow-[0_6px_14px_-6px_hsl(0_0%_0%/0.7)] ring-1 ring-white/10", className)}
      style={{ background: `linear-gradient(150deg, hsl(${hue} 60% 30%), hsl(${(hue + 50) % 360} 65% 12%))` }}
    >
      {cover && <img src={cover.uri} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />}
    </span>
  );
}

/**
 * An open group, as Discord shows one: a capsule on the group's colour, the
 * width of the grid, holding the folder and then its instances.
 *
 * Opening, the capsule spreads out from the folder and the instances slide
 * out of it, one after another, to their places; closing, they slide back
 * in and the capsule folds into the folder before the closed card returns.
 */
export function GroupTray({
  group,
  members,
  span,
  renderMember,
  onClose,
  onRename,
  onUngroup,
  onEdit,
  onMenu,
}: {
  group: InstanceGroup;
  members: GameInstanceSummary[];
  /** Columns of the library grid it takes: the folder and its instances, up to a row. */
  span: number;
  renderMember: (member: GameInstanceSummary) => ReactNode;
  onClose: () => void;
  onRename: (name: string) => void;
  onUngroup: () => void;
  onEdit: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const trayRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  /** The tray clipped to its folder card, rounded like it. */
  const folderClip = () => {
    const tray = trayRef.current;
    const folder = tray?.querySelector<HTMLElement>("[data-group-card] .kiza-card");
    if (!tray || !folder) return null;
    const outer = tray.getBoundingClientRect();
    const inner = folder.getBoundingClientRect();
    const pad = 6;
    return `inset(${Math.max(0, inner.top - outer.top - pad)}px ${Math.max(0, outer.right - inner.right - pad)}px ${Math.max(0, outer.bottom - inner.bottom - pad)}px ${Math.max(0, inner.left - outer.left - pad)}px round 24px)`;
  };
  const membersAndOffsets = () => {
    const tray = trayRef.current;
    const folder = tray?.querySelector<HTMLElement>("[data-group-card] .kiza-card")?.getBoundingClientRect();
    if (!tray || !folder) return [];
    return [...tray.querySelectorAll<HTMLElement>("[data-tray-member]")].map((member) => {
      const box = member.getBoundingClientRect();
      return { member, x: folder.left - box.left, y: folder.top - box.top };
    });
  };

  useLayoutEffect(() => {
    const tray = trayRef.current;
    const from = folderClip();
    if (!tray || !from || prefersReducedMotion()) return;
    const timeline = gsap.timeline();
    timeline.fromTo(tray, { clipPath: from }, { clipPath: "inset(0px 0px 0px 0px round 28px)", duration: 0.55, ease: "power3.out", clearProps: "clipPath" }, 0);
    membersAndOffsets().forEach(({ member, x, y }, index) => {
      timeline.fromTo(
        member,
        { x, y, scale: 0.55, opacity: 0 },
        { x: 0, y: 0, scale: 1, opacity: 1, duration: 0.5, ease: "power3.out", clearProps: "transform,opacity" },
        0.06 + index * 0.045,
      );
    });
    return () => {
      timeline.kill();
    };
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    const tray = trayRef.current;
    const to = folderClip();
    if (closing.current) return;
    if (!tray || !to || prefersReducedMotion()) {
      onClose();
      return;
    }
    closing.current = true;
    const list = membersAndOffsets();
    const timeline = gsap.timeline({ onComplete: onClose });
    // Back into the folder, the last one out first in.
    list.reverse().forEach(({ member, x, y }, index) => {
      timeline.to(member, { x, y, scale: 0.55, opacity: 0, duration: 0.26, ease: "power2.in" }, index * 0.03);
    });
    // Folded into the folder on the same curve the cards then come back on.
    timeline.to(tray, { clipPath: to, duration: 0.4, ease: "power3.out" }, Math.max(0, list.length * 0.03 - 0.05));
  };

  return (
    <div
      ref={trayRef}
      data-group-tray={group.id}
      // It reaches 12px past its columns into the grid's gaps, so the cards
      // inside are exactly as wide as the cards outside it.
      className="-m-3 rounded-[28px] p-3"
      style={{
        gridColumn: `span ${span}`,
        background: `linear-gradient(180deg, ${group.color}26, ${group.color}10)`,
        boxShadow: `inset 0 0 0 1px ${group.color}3d, 0 20px 50px -30px ${group.color}`,
      }}
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))`,
          columnGap: "calc(var(--kiza-library-gap-x, 20px) * var(--kiza-density, 1))",
          rowGap: "calc(var(--kiza-library-gap-y, 28px) * var(--kiza-density, 1))",
        }}
      >
        <InstanceGroupCard
          group={group}
          members={members}
          inTray
          onToggle={close}
          onRename={onRename}
          onUngroup={onUngroup}
          onEdit={onEdit}
          onMenu={onMenu}
        />
        {members.map((member) => (
          <div key={member.id} data-tray-member className="min-w-0">
            {renderMember(member)}
          </div>
        ))}
      </div>
    </div>
  );
}
