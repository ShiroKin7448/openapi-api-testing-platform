import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WorkspaceState {
  activeWorkspaceId: string | null;
  setActiveWorkspace: (workspaceId: string) => void;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(persist(
  (set) => ({
    activeWorkspaceId: null,
    setActiveWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId }),
    reset: () => set({ activeWorkspaceId: null }),
  }),
  { name: 'workspace-storage' },
));
