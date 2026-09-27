import { Router } from 'express';
import { createProject, deleteProject, getProject, getProjectReadiness, getProjects, updateProject } from '../controllers/project.controller';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { noQueryParams, projectBody, projectParams, projectPatchBody, workspaceParams } from '../validation/api.schemas';

const workspaceRouter = Router();
workspaceRouter.post('/:workspaceId/projects', requireAuth, validateRequest({ params: workspaceParams, body: projectBody, query: noQueryParams }), createProject);
workspaceRouter.get('/:workspaceId/projects', requireAuth, validateRequest({ params: workspaceParams, query: noQueryParams }), getProjects);

const projectRouter = Router();
projectRouter.get('/:projectId', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), getProject);
projectRouter.get('/:projectId/readiness', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), getProjectReadiness);
projectRouter.patch('/:projectId', requireAuth, validateRequest({ params: projectParams, body: projectPatchBody, query: noQueryParams }), updateProject);
projectRouter.delete('/:projectId', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), deleteProject);

export { workspaceRouter as workspaceProjectRoutes, projectRouter as projectRoutes };
export default workspaceRouter;
