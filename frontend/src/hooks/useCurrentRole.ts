import { useQuery } from '@tanstack/react-query';
import { workspacesApi } from '../api/workspaces.api';
import { queryKeys } from '../api/queryClient';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import type { WorkspaceRole } from '@shared/types';

/** Resolves the authenticated user's role in the active workspace, read from the already-cached workspace list. */
export function useCurrentRole(): { role: WorkspaceRole | undefined; isViewer: boolean } {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: workspacesApi.list });
  const role = workspaces.data?.find((workspace) => workspace.id === activeWorkspaceId)?.role;
  return { role, isViewer: role === 'VIEWER' };
}
