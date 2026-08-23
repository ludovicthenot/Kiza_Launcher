import { create } from 'zustand'

export type ActiveTab = 'mods' | 'profiles' | 'worlds' | 'settings' | 'logs' | 'discover';
export type ContentCategoryId = 'mod' | 'shader' | 'resourcepack' | 'modpack' | 'datapack';

interface AppState {
  selectedInstanceId: string | null;
  activeTab: ActiveTab;
  contentCategory: ContentCategoryId;
  showSettings: boolean;
  settingsTab: string | null;
  showServerHub: boolean;
  /** Address carried by a kiza://join link, waiting for the player to act on it. */
  pendingJoinAddress: string | null;
  viewMode: 'grid' | 'list';
  searchQuery: string;
  isScanning: boolean;
  
  // Actions
  setSelectedInstanceId: (id: string | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setContentCategory: (category: ContentCategoryId) => void;
  setShowSettings: (show: boolean, tab?: string) => void;
  setShowServerHub: (show: boolean) => void;
  setPendingJoinAddress: (address: string | null) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setSearchQuery: (query: string) => void;
  setIsScanning: (scanning: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedInstanceId: null,
  activeTab: 'mods',
  contentCategory: 'mod',
  showSettings: false,
  settingsTab: null,
  showServerHub: false,
  pendingJoinAddress: null,
  viewMode: 'list',
  searchQuery: '',
  isScanning: false,
  
  setSelectedInstanceId: (id) => set({ selectedInstanceId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setContentCategory: (contentCategory) => set({ contentCategory }),
  setShowSettings: (show, tab) => set({ showSettings: show, settingsTab: tab ?? null }),
  setShowServerHub: (show) => set({ showServerHub: show }),
  setPendingJoinAddress: (address) => set({ pendingJoinAddress: address }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsScanning: (scanning) => set({ isScanning: scanning }),
}))
