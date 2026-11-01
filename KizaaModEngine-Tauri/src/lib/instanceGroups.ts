import { create } from "zustand";

/**
 * Groups of instances in the library, as Discord groups servers in folders:
 * a card that holds several, opened in place to show them, closed to keep
 * the grid short.
 *
 * Kept in this browser's storage: a group is a way this person sorts their
 * own library, not something about the instances themselves, so it lives
 * beside the library's sort order rather than in the instances' files.
 */

/**
 * The picture a closed group shows: one of its instances' pictures, or an
 * image of its own (a small data: URL, see `GroupEditorDialog`). Without
 * one, it shows its first four instances, two by two.
 */
export type GroupCover = { member: string } | { image: string };

export interface InstanceGroup {
  id: string;
  name: string;
  /** `#rrggbb`: one of `GROUP_COLORS`, or one chosen by hand. */
  color: string;
  /** Its instances, in the order they were added. */
  ids: string[];
  open: boolean;
  cover?: GroupCover;
}

/** What the group editor changes. */
export type GroupPatch = Partial<Pick<InstanceGroup, "name" | "color" | "cover">>;

/** Folder colours, bright enough to read on the dark theme. */
export const GROUP_COLORS = ["#8b5cf6", "#5865f2", "#3ba55c", "#faa61a", "#eb459e", "#ed4245", "#06b6d4", "#f59e0b"];

const KEY = "kiza.library.groups";

function load(): InstanceGroup[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(groups: InstanceGroup[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(groups));
  } catch {
    // Not kept past this session; the groups still work until then.
  }
}

interface GroupsState {
  groups: InstanceGroup[];
  /** A new group of `ids` (taken out of any group they were in); its id. */
  create: (ids: string[], name: string) => string;
  /** Moves `ids` into `groupId`. */
  add: (groupId: string, ids: string[]) => void;
  rename: (groupId: string, name: string) => void;
  /** Its name, colour and picture; an empty name keeps the old one. */
  update: (groupId: string, patch: GroupPatch) => void;
  toggle: (groupId: string, open?: boolean) => void;
  /** The group goes; its instances stay, ungrouped. */
  ungroup: (groupId: string) => void;
  /** Instances that no longer exist; a group left with one or none goes. */
  forget: (ids: string[]) => void;
  /** Puts back a set of groups (an undo). */
  restore: (groups: InstanceGroup[]) => void;
}

/**
 * A group with fewer than two instances is not a group; a picture borrowed
 * from an instance that left it is dropped.
 */
const tidy = (groups: InstanceGroup[]) =>
  groups
    .filter((group) => group.ids.length >= 2)
    .map((group) =>
      group.cover && "member" in group.cover && !group.ids.includes(group.cover.member) ? { ...group, cover: undefined } : group,
    );

export const useInstanceGroups = create<GroupsState>((set, get) => {
  const commit = (groups: InstanceGroup[]) => {
    const next = tidy(groups);
    save(next);
    set({ groups: next });
  };
  return {
    groups: load(),
    create: (ids, name) => {
      const id = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const taken = new Set(ids);
      const used = new Set(get().groups.map((group) => group.color));
      const color = GROUP_COLORS.find((candidate) => !used.has(candidate)) ?? GROUP_COLORS[get().groups.length % GROUP_COLORS.length];
      commit([
        ...get().groups.map((group) => ({ ...group, ids: group.ids.filter((member) => !taken.has(member)) })),
        { id, name, color, ids: [...ids], open: true },
      ]);
      return id;
    },
    add: (groupId, ids) => {
      const taken = new Set(ids);
      commit(
        get().groups.map((group) =>
          group.id === groupId
            ? { ...group, ids: [...group.ids.filter((member) => !taken.has(member)), ...ids] }
            : { ...group, ids: group.ids.filter((member) => !taken.has(member)) },
        ),
      );
    },
    rename: (groupId, name) =>
      commit(get().groups.map((group) => (group.id === groupId ? { ...group, name: name.trim() || group.name } : group))),
    update: (groupId, patch) =>
      commit(
        get().groups.map((group) =>
          group.id === groupId ? { ...group, ...patch, name: patch.name?.trim() || group.name } : group,
        ),
      ),
    toggle: (groupId, open) =>
      commit(get().groups.map((group) => (group.id === groupId ? { ...group, open: open ?? !group.open } : group))),
    ungroup: (groupId) => commit(get().groups.filter((group) => group.id !== groupId)),
    forget: (ids) => {
      const gone = new Set(ids);
      commit(get().groups.map((group) => ({ ...group, ids: group.ids.filter((member) => !gone.has(member)) })));
    },
    restore: (groups) => commit(groups),
  };
});
