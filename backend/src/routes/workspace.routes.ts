import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import {
  noQueryParams,
  workspaceBody,
  workspaceMemberBody,
  workspaceMemberIdParams,
  workspaceMemberParams,
  workspaceMemberUpdateBody,
  workspaceParams,
} from '../validation/api.schemas';
import {
  createWorkspace,
  getMyWorkspaces,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getMembers,
  addMember,
  updateMember,
  removeMember,
} from '../controllers/workspace.controller';

const router = Router();

// Workspace CRUD
router.post('/', requireAuth, validateRequest({ body: workspaceBody, query: noQueryParams }), createWorkspace);
router.get('/', requireAuth, validateRequest({ query: noQueryParams }), getMyWorkspaces);
router.get('/:workspaceId', requireAuth, validateRequest({ params: workspaceParams, query: noQueryParams }), getWorkspace);
router.patch('/:workspaceId', requireAuth, validateRequest({ params: workspaceParams, body: workspaceBody, query: noQueryParams }), updateWorkspace);
router.delete('/:workspaceId', requireAuth, validateRequest({ params: workspaceParams, query: noQueryParams }), deleteWorkspace);

// Member management
router.get('/:workspaceId/members', requireAuth, validateRequest({ params: workspaceParams, query: noQueryParams }), getMembers);
router.post('/:workspaceId/members', requireAuth, validateRequest({ params: workspaceParams, body: workspaceMemberBody, query: noQueryParams }), addMember);
router.patch('/:workspaceId/members/:memberId', requireAuth, validateRequest({ params: workspaceMemberParams, body: workspaceMemberUpdateBody, query: noQueryParams }), updateMember);
router.delete('/:workspaceId/members/:memberId', requireAuth, validateRequest({ params: workspaceMemberIdParams, query: noQueryParams }), removeMember);

export default router;
