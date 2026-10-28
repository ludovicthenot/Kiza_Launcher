import { create } from 'zustand'

export type ActiveTab = 'mods' | 'profiles' | 'worlds' | 'screenshots' | 'settings' | 'logs' | 'discover' | 'kizaflux';
export type ContentCategoryId = 'mod' | 'shader' | 'resourcepack' | 'modpack' | 'datapack';
/** The two halves of the front page: the instances you play, the servers you host. */
export type LibraryMode = 'instances' | 'host';
/** Inside Host: making a server, or running the ones made. */
export type HostTab = 'creator' | 'manager';
/** Where the creator starts from. */
export type CreatorSource = 'scratch' | 'instance' | 'import';

interface AppState {
  selectedInstanceId: string | null;
  libraryMode: LibraryMode;
  hostTab: HostTab;
  creatorSource: CreatorSource;
  /** The instance "Create server from instance" was asked on. */
  creatorInstanceId: string | null;
  selectedServerId: string | null;
  activeTab: ActiveTab;
  contentCategory: ContentCategoryId;
  showSettings: boolean;
  settingsTab: string | null;
  /** Address carried by a kiza://join link, waiting for the player to act on it. */
  viewMode: 'grid' | 'list';
  searchQuery: string;
  isScanning: boolean;
  /** An archive dropped on the window, for the library to import. */
  droppedArchive: string | null;
  /** The launcher's opening has finished: what pops up over the launcher waits for it. */
  openingDone: boolean;
  
  // Actions
  setSelectedInstanceId: (id: string | null) => void;
  setLibraryMode: (mode: LibraryMode) => void;
  setHostTab: (tab: HostTab) => void;
  setCreatorSource: (source: CreatorSource, instanceId?: string | null) => void;
  setSelectedServerId: (id: string | null) => void;
  /** Library → "Create server from instance": lands on the creator, instance chosen. */
  openServerCreatorFor: (instanceId: string) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setContentCategory: (category: ContentCategoryId) => void;
  setShowSettings: (show: boolean, tab?: string) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setSearchQuery: (query: string) => void;
  setIsScanning: (scanning: boolean) => void;
  setDroppedArchive: (path: string | null) => void;
  setOpeningDone: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedInstanceId: null,
  libraryMode: 'instances',
  hostTab: 'creator',
  creatorSource: 'scratch',
  creatorInstanceId: null,
  selectedServerId: null,
  activeTab: 'mods',
  contentCategory: 'mod',
  showSettings: false,
  settingsTab: null,
  viewMode: 'list',
  searchQuery: '',
  isScanning: false,
  droppedArchive: null,
  openingDone: false,
  
  setSelectedInstanceId: (id) => set({ selectedInstanceId: id }),
  setLibraryMode: (libraryMode) => set({ libraryMode }),
  setHostTab: (hostTab) => set({ hostTab }),
  setCreatorSource: (creatorSource, instanceId) =>
    set((state) => ({ creatorSource, creatorInstanceId: instanceId === undefined ? state.creatorInstanceId : instanceId })),
  setSelectedServerId: (selectedServerId) =>
    set((state) => ({ selectedServerId, hostTab: selectedServerId ? 'manager' : state.hostTab })),
  openServerCreatorFor: (instanceId) =>
    set({ selectedInstanceId: null, libraryMode: 'host', hostTab: 'creator', creatorSource: 'instance', creatorInstanceId: instanceId }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setContentCategory: (contentCategory) => set({ contentCategory }),
  setShowSettings: (show, tab) => set({ showSettings: show, settingsTab: tab ?? null }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsScanning: (scanning) => set({ isScanning: scanning }),
  setDroppedArchive: (droppedArchive) => set({ droppedArchive }),
  setOpeningDone: () => set({ openingDone: true }),
}))
