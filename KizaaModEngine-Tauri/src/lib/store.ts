import { create } from 'zustand'

export type ActiveTab = 'mods' | 'conflicts' | 'profiles' | 'health' | 'settings' | 'downloads' | 'discover' | 'shaders';

interface AppState {
  selectedInstanceId: string | null;
  activeTab: ActiveTab;
  showSettings: boolean;
  viewMode: 'grid' | 'list';
  searchQuery: string;
  isScanning: boolean;
  
  // Actions
  setSelectedInstanceId: (id: string | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setShowSettings: (show: boolean) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setSearchQuery: (query: string) => void;
  setIsScanning: (scanning: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedInstanceId: null,
  activeTab: 'mods',
  showSettings: false,
  viewMode: 'list',
  searchQuery: '',
  isScanning: false,
  
  setSelectedInstanceId: (id) => set({ selectedInstanceId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setShowSettings: (show) => set({ showSettings: show }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsScanning: (scanning) => set({ isScanning: scanning }),
}))
