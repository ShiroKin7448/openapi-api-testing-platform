import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { noQueryParams, projectParams } from '../validation/api.schemas';
import { cleanupProject, getProjectMaintenance } from '../controllers/maintenance.controller';

const router = Router();
router.get('/projects/:projectId/maintenance', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), getProjectMaintenance);
router.post('/projects/:projectId/maintenance/cleanup', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), cleanupProject);
export default router;
