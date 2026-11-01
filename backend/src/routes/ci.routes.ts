import { Router } from 'express';
import { requireApiToken } from '../middlewares/requireApiToken';
import { validateRequest } from '../middlewares/validateRequest';
import { noQueryParams, projectParams, triggerCiRunBody } from '../validation/api.schemas';
import { triggerCiRun } from '../controllers/ci.controller';

const router = Router();
router.post('/ci/projects/:projectId/runs', requireApiToken, validateRequest({ params: projectParams, body: triggerCiRunBody, query: noQueryParams }), triggerCiRun);

export default router;
