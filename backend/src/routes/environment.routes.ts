import { Router } from 'express';
import { createEnvironment, deleteEnvironment, getEnvironments, updateEnvironment } from '../controllers/environment.controller';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { environmentBody, environmentParams, environmentPatchBody, environmentProjectParams, noQueryParams } from '../validation/api.schemas';

const projectRouter = Router();
projectRouter.post('/:projectId/environments', requireAuth, validateRequest({ params: environmentProjectParams, body: environmentBody, query: noQueryParams }), createEnvironment);
projectRouter.get('/:projectId/environments', requireAuth, validateRequest({ params: environmentProjectParams, query: noQueryParams }), getEnvironments);

const environmentRouter = Router();
environmentRouter.patch('/:environmentId', requireAuth, validateRequest({ params: environmentParams, body: environmentPatchBody, query: noQueryParams }), updateEnvironment);
environmentRouter.delete('/:environmentId', requireAuth, validateRequest({ params: environmentParams, query: noQueryParams }), deleteEnvironment);

export { projectRouter as projectEnvironmentRoutes, environmentRouter as environmentRoutes };
export default projectRouter;
