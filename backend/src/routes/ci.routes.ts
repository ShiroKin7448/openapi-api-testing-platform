import { Router } from 'express';
import { z } from 'zod';
import { requireApiToken } from '../middlewares/requireApiToken';
import { ciTriggerLimiter } from '../middlewares/rateLimit';
import { validateRequest } from '../middlewares/validateRequest';
import { noQueryParams, projectParams, testRunParams, triggerCiRunBody } from '../validation/api.schemas';
import { triggerCiRun } from '../controllers/ci.controller';
import { ciExportRun, ciRunStatus } from '../controllers/report.controller';

const router = Router();
const exportQuery = z.object({ format: z.enum(['junit', 'html', 'postman', 'json']) }).strict();
router.post('/ci/projects/:projectId/runs', ciTriggerLimiter, requireApiToken, validateRequest({ params: projectParams, body: triggerCiRunBody, query: noQueryParams }), triggerCiRun);
router.get('/ci/test-runs/:testRunId', requireApiToken, validateRequest({ params: testRunParams, query: noQueryParams }), ciRunStatus);
router.get('/ci/test-runs/:testRunId/export', requireApiToken, validateRequest({ params: testRunParams, query: exportQuery }), ciExportRun);

export default router;
