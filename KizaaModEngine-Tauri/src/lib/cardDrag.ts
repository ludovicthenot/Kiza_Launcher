import { useEffect, useRef } from "react";
import { gsap } from "./animation";
import { createTrashCan, type TrashCan } from "./trashCan";

/**
 * Long press, then drag: an instance card lifts off the grid, follows the
 * pointer from where it was grabbed, and is put down somewhere else in the
 * grid -- or dropped in a trash can that rises from the bottom of the window
 * while a card is held.
 *
 * - **Press and hold** (380 ms, the pointer still): a plain click, a double
 *   click or a scroll never starts a drag.
 * - **Lift:** a copy of the card (the "ghost") takes its place under the
 *   pointer, 6% bigger with a deeper shadow; the card in the grid stays as a
 *   faint hole where it will land. The ghost leans with the pointer's
 *   horizontal speed, as a held thing does.
 * - **Reorder:** over another card, the held one takes that card's place;
 *   the grid reflows around it (the page animates that, see `onPreview`).
 * - **Trash:** a can rises from the bottom while a card is held and answers
 *   its distance (lib/trashCan); near it the ghost is pulled toward it, and
 *   within reach drawn in, shrinking. Let go there and the can swallows it;
 *   the deletion itself is asked for after.
 * - **Group:** held still over the middle of another card for a moment, the
 *   held card offers to make a group with it (the other card swells and
 *   says so), as an app held on another does on a phone; over a group's
 *   folder it offers to join it at once. The edges of a card still reorder.
 * - **Groups** are held and moved the same way, as one card: the folder
 *   (or the whole open tray) takes its new place; it is never put inside
 *   another group, and the trash asks before deleting what it holds.
 * - **Escape** puts everything back.
 *
 * What moves is a "unit" of the grid: an instance by its id, or a group by
 * `group:` and its id (`groupKey`).
 */

/** The unit key of a group, as `order` gives it among instance ids. */
export const groupKey = (groupId: string) => `group:${groupId}`;
/** The group a unit key names, if it names one. */
export const groupOfKey = (key: string) => (key.startsWith("group:") ? key.slice("group:".length) : null);

/** The units of the grid, one per card or open group. */
const UNITS = ":scope > [data-instance-poster], :scope > [data-group-card], :scope > [data-group-tray]";
const unitKey = (element: HTMLElement) =>
  element.dataset.instancePoster ?? groupKey(element.dataset.groupCard ?? element.dataset.groupTray ?? "");

/** What letting go would group the held card with. */
export type MergeTarget = { instanceId: string } | { groupId: string };

export interface CardDragOptions {
  /** The grid whose instance cards and group folders can be held, once drawn. */
  grid: HTMLElement | null;
  /** The units (instance ids, `groupKey`s) in the order shown. */
  order: () => string[];
  /** Whether this unit may move among the others (not while a search hides some, nor inside a group). */
  canReorder: (id: string) => boolean;
  /** The order while dragging, for the page to show (and animate). */
  onPreview: (order: string[]) => void;
  /** Put down in the grid: the order to keep. */
  onDrop: (order: string[]) => void;
  /** Dropped in the trash: an instance id or a `groupKey`. */
  onTrash: (id: string) => void;
  /** Let go over another card, or a group's folder. */
  onMerge: (id: string, target: MergeTarget) => void;
  /** Let go without a change, or Escape. */
  onCancel: () => void;
  /** Said on the card a drop would group with. */
  mergeLabels: { create: string; join: string };
  /** The words under the can, and once a drop there would land in it. */
  trashLabels: { idle: string; armed: string };
}

const HOLD_MS = 380;
const SLOP_PX = 6;
/** How long the pointer rests on a card's middle before it offers a group. */
const DWELL_MS = 420;

export function useCardDrag(options: CardDragOptions): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const grid = options.grid;
    if (!grid) return;

    let hold: number | null = null;
    let start: { x: number; y: number; card: HTMLElement; id: string } | null = null;
    let drag: {
      id: string;
      card: HTMLElement;
      /** What stays faint where it was: the card, or an open group's whole tray. */
      hole: HTMLElement;
      ghost: HTMLElement;
      trash: TrashCan;
      grab: { x: number; y: number };
      order: string[];
      armed: boolean;
      lastMove: { x: number; t: number };
      lastSwap: number;
      /** The card just swapped with: not again until the pointer leaves it. */
      swappedWith: string | null;
      /** The card the pointer rests on, waiting for the dwell. */
      resting: { key: string; target: MergeTarget; frame: HTMLElement; x: number; y: number; timer: number } | null;
      /** What a drop now would group with, and the card showing it. */
      merge: { target: MergeTarget; frame: HTMLElement } | null;
    } | null = null;

    const frameOf = (element: HTMLElement) => element.querySelector<HTMLElement>(".kiza-card") ?? element;

    // The card offering the group: swollen, ringed, saying what a drop does.
    const showMerge = (frame: HTMLElement | null, target: MergeTarget | null) => {
      if (!drag) return;
      if (drag.merge && drag.merge.frame !== frame) {
        const old = drag.merge.frame;
        delete old.dataset.mergeLabel;
        gsap.to(old, { scale: 1, duration: 0.25, ease: "power2.out", clearProps: "transform" });
      }
      if (frame && target && drag.merge?.frame !== frame) {
        const labels = latest.current.mergeLabels;
        frame.dataset.mergeLabel = "groupId" in target ? labels.join : labels.create;
        gsap.to(frame, { scale: 1.08, duration: 0.35, ease: "back.out(2)" });
      }
      drag.merge = frame && target ? { target, frame } : null;
    };
    const stopResting = () => {
      if (drag?.resting) window.clearTimeout(drag.resting.timer);
      if (drag) drag.resting = null;
    };

    const clearHold = () => {
      if (hold != null) window.clearTimeout(hold);
      hold = null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || drag) return;
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>("[data-instance-poster], [data-group-card]");
      // A group's folder is a button itself; any other button keeps its click.
      const button = target.closest("button");
      if (!card || !grid.contains(card) || (button && !button.classList.contains("kiza-card")) || target.closest("input")) return;
      const id = card.dataset.instancePoster ?? (card.dataset.groupCard ? groupKey(card.dataset.groupCard) : null);
      if (!id) return;
      start = { x: event.clientX, y: event.clientY, card, id };
      clearHold();
      hold = window.setTimeout(() => lift(), HOLD_MS);
    };

    const lift = () => {
      hold = null;
      if (!start) return;
      const { card, id, x, y } = start;
      const frame = card.querySelector<HTMLElement>(".kiza-card") ?? card;
      const box = frame.getBoundingClientRect();

      const ghost = frame.cloneNode(true) as HTMLElement;
      ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, {
        position: "fixed",
        left: "0px",
        top: "0px",
        width: `${box.width}px`,
        height: `${box.height}px`,
        margin: "0",
        zIndex: "2147483000",
        pointerEvents: "none",
        willChange: "transform",
        transition: "box-shadow 220ms ease-out",
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(ghost);
      gsap.set(ghost, { x: box.left, y: box.top, transformOrigin: `${x - box.left}px ${y - box.top}px` });
      requestAnimationFrame(() => {
        ghost.style.boxShadow = "0 30px 60px -18px rgba(0, 0, 0, 0.75)";
      });
      gsap.to(ghost, { scale: 1.06, duration: 0.22, ease: "power3.out" });
      // The card stays as the place it will land; an open group, all of it.
      const hole = (groupOfKey(id) && card.closest<HTMLElement>("[data-group-tray]")) || frame;
      gsap.to(hole, { opacity: 0.22, scale: hole === frame ? 0.96 : 0.98, duration: 0.2, ease: "power2.out" });

      const trash = createTrashCan(latest.current.trashLabels);

      // Held: no text selection, and the grid stops answering the pointer --
      // a card lifting under it on hover, then dropping as it passes, is
      // what made the reflow flicker. The pointer is followed on the window.
      document.documentElement.style.userSelect = "none";
      grid.style.pointerEvents = "none";
      drag = {
        id,
        card,
        hole,
        ghost,
        trash,
        grab: { x: x - box.left, y: y - box.top },
        order: latest.current.order(),
        armed: false,
        lastMove: { x, t: performance.now() },
        lastSwap: 0,
        swappedWith: null,
        resting: null,
        merge: null,
      };
      document.documentElement.style.cursor = "grabbing";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag) {
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) {
          clearHold();
          start = null;
        }
        return;
      }
      event.preventDefault();
      const { ghost, grab, trash } = drag;

      // Lean with the horizontal speed, never more than 8 degrees.
      const now = performance.now();
      const speed = (event.clientX - drag.lastMove.x) / Math.max(1, now - drag.lastMove.t);
      drag.lastMove = { x: event.clientX, t: now };
      const tilt = Math.max(-8, Math.min(8, speed * 14));

      // The can answers how near the card is; the card answers the can.
      const { armed, nearness } = trash.track(event.clientX, event.clientY);
      drag.armed = armed;
      if (armed) {
        stopResting();
        showMerge(null, null);
      }
      const mouth = trash.mouth();
      if (armed) {
        // Drawn in: hovering over the mouth, small, ready to drop.
        gsap.to(ghost, {
          x: mouth.x - grab.x,
          y: mouth.y - 70 - grab.y,
          scale: 0.42,
          rotation: tilt * 0.5,
          duration: 0.22,
          ease: "power3.out",
          overwrite: "auto",
        });
        return;
      }
      // Pulled a little toward the can as it nears, like a magnet would.
      const pull = 0.14 * nearness * nearness;
      gsap.to(ghost, {
        x: event.clientX - grab.x + (mouth.x - event.clientX) * pull,
        y: event.clientY - grab.y + (mouth.y - event.clientY) * pull,
        scale: 1.06 - 0.16 * nearness,
        rotation: tilt,
        duration: 0.08,
        ease: "power1.out",
        overwrite: "auto",
      });

      // A group is only ever moved: it is not put in another.
      const holdingGroup = groupOfKey(drag.id) != null;

      // Over a group's folder: joining it is offered at once.
      const folder = holdingGroup
        ? undefined
        : [...grid.querySelectorAll<HTMLElement>("[data-group-card]")].find((element) => {
            const box = frameOf(element).getBoundingClientRect();
            return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
          });
      if (folder?.dataset.groupCard) {
        stopResting();
        showMerge(frameOf(folder), { groupId: folder.dataset.groupCard });
        return;
      }

      // Over another card's middle, held still: a group is offered.
      let middle: { id: string; frame: HTMLElement } | null = null;
      if (!holdingGroup) {
        for (const poster of grid.querySelectorAll<HTMLElement>("[data-instance-poster]")) {
          const id = poster.dataset.instancePoster;
          if (!id || id === drag.id) continue;
          const frame = frameOf(poster);
          const box = frame.getBoundingClientRect();
          const u = (event.clientX - box.left) / box.width;
          const v = (event.clientY - box.top) / box.height;
          if (u > 0.28 && u < 0.72 && v > 0.28 && v < 0.72) middle = { id, frame };
        }
      }

      // Anywhere else on another unit moves the held one to its place -- but
      // not straight back onto the unit it just swapped with, which slid
      // under the pointer as it made room, or the two would swap back and
      // forth.
      let targetId: string | null = null;
      for (const unit of grid.querySelectorAll<HTMLElement>(UNITS)) {
        const id = unitKey(unit);
        if (id === drag.id) continue;
        const box = (unit.dataset.groupTray ? unit : frameOf(unit)).getBoundingClientRect();
        const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
        if (!inside) {
          if (id === drag.swappedWith) drag.swappedWith = null;
          continue;
        }
        if (id !== drag.swappedWith) targetId = id;
      }

      if (middle) {
        const key = middle.id;
        const moved = drag.resting ? Math.hypot(event.clientX - drag.resting.x, event.clientY - drag.resting.y) : 0;
        if (drag.merge?.frame === middle.frame) return;
        if (!drag.resting || drag.resting.key !== key || moved > 14) {
          stopResting();
          const frame = middle.frame;
          const target: MergeTarget = { instanceId: middle.id };
          drag.resting = {
            key,
            target,
            frame,
            x: event.clientX,
            y: event.clientY,
            timer: window.setTimeout(() => showMerge(frame, target), DWELL_MS),
          };
        }
        return;
      }
      stopResting();
      showMerge(null, null);

      if (!latest.current.canReorder(drag.id) || now - drag.lastSwap < 160) return;
      if (!targetId || !latest.current.canReorder(targetId) || !drag.order.includes(targetId)) return;
      const order = drag.order.filter((id) => id !== drag!.id);
      const at = order.indexOf(targetId);
      if (at < 0) return;
      const from = drag.order.indexOf(drag.id);
      const to = drag.order.indexOf(targetId);
      order.splice(to > from ? at + 1 : at, 0, drag.id);
      drag.order = order;
      drag.lastSwap = now;
      drag.swappedWith = targetId;
      latest.current.onPreview(order);
    };

    const finish = (dropped: boolean) => {
      clearHold();
      start = null;
      const current = drag;
      drag = null;
      document.documentElement.style.cursor = "";
      document.documentElement.style.userSelect = "";
      grid.style.pointerEvents = "";
      if (!current) return;
      const { ghost, trash, card, hole, armed } = current;
      const frame = card.querySelector<HTMLElement>(".kiza-card") ?? card;
      // Swallow the click this release sends to the card, and only that one.
      const swallow = (event: MouseEvent) => event.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);

      if (current.resting) window.clearTimeout(current.resting.timer);
      const merge = current.merge;
      if (merge) {
        delete merge.frame.dataset.mergeLabel;
        gsap.to(merge.frame, { scale: 1, duration: 0.45, ease: "elastic.out(1, 0.45)", clearProps: "transform" });
      }

      if (dropped && armed) {
        trash.swallow(ghost, () => latest.current.onTrash(current.id));
        return;
      }

      if (dropped && merge) {
        // Into the other card: it shrinks into its middle as that one
        // bounces, and the group appears.
        trash.dismiss();
        const into = merge.frame.getBoundingClientRect();
        const box = ghost.getBoundingClientRect();
        gsap.set(ghost, { transformOrigin: "50% 50%", x: box.left + box.width / 2 - ghost.offsetWidth / 2, y: box.top + box.height / 2 - ghost.offsetHeight / 2 });
        gsap.to(ghost, {
          x: into.left + into.width / 2 - ghost.offsetWidth / 2,
          y: into.top + into.height / 2 - ghost.offsetHeight / 2,
          scale: 0.2,
          opacity: 0,
          rotation: 0,
          duration: 0.3,
          ease: "power2.in",
          onComplete: () => {
            ghost.remove();
            gsap.set(hole, { clearProps: "opacity,transform" });
            latest.current.onMerge(current.id, merge.target);
          },
        });
        return;
      }

      trash.dismiss();
      // Down where the hole is now.
      const place = frame.getBoundingClientRect();
      ghost.style.boxShadow = "0 10px 28px -18px rgba(0, 0, 0, 0.9)";
      gsap.to(ghost, {
        x: place.left,
        y: place.top,
        scale: 1,
        rotation: 0,
        duration: 0.42,
        ease: "back.out(1.4)",
        onComplete: () => {
          ghost.remove();
          gsap.set(hole, { clearProps: "opacity,transform" });
        },
      });
      gsap.to(hole, { opacity: 1, scale: 1, duration: 0.2, delay: 0.3, ease: "power1.out" });
      if (dropped && latest.current.canReorder(current.id)) latest.current.onDrop(current.order);
      else latest.current.onCancel();
    };

    const safely = (dropped: boolean) => {
      const current = drag;
      try {
        finish(dropped);
      } catch (error) {
        grid.style.pointerEvents = "";
        current?.ghost.remove();
        current?.trash.dismiss();
        if (current) gsap.set(current.hole, { clearProps: "opacity,transform" });
        latest.current.onCancel();
        throw error;
      }
    };
    const onPointerUp = () => safely(true);
    const onPointerCancel = () => safely(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag) safely(false);
    };

    // A held picture would otherwise start the browser's own image drag.
    const onDragStart = (event: DragEvent) => event.preventDefault();
    grid.addEventListener("dragstart", onDragStart);
    grid.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      clearHold();
      grid.removeEventListener("dragstart", onDragStart);
      grid.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKey);
    };
    // Set up again only for another grid; the callbacks are read through `latest`.
  }, [options.grid]);
}
