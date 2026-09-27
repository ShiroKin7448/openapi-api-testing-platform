import { Router } from 'express';
import { createRun, getRuns, getRun, getRunProgress, getRunResults, getRunEvents, cancelRun, getQueueStatus } from '../controllers/test-run.controller';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { createTestRunBody, noQueryParams, projectParams, testRunParams, testRunResultsQuery } from '../validation/api.schemas';

const router = Router();
router.post('/projects/:projectId/test-runs', requireAuth, validateRequest({ params: projectParams, body: createTestRunBody }), createRun);
router.get('/projects/:projectId/test-runs', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), getRuns);
router.get('/projects/:projectId/queue-status', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), getQueueStatus);
router.get('/test-runs/:testRunId', requireAuth, validateRequest({ params: testRunParams, query: noQueryParams }), getRun);
router.get('/test-runs/:testRunId/results', requireAuth, validateRequest({ params: testRunParams, query: testRunResultsQuery }), getRunResults);
router.get('/test-runs/:testRunId/progress', requireAuth, validateRequest({ params: testRunParams, query: noQueryParams }), getRunProgress);
router.get('/test-runs/:testRunId/events', requireAuth, validateRequest({ params: testRunParams, query: noQueryParams }), getRunEvents);
router.post('/test-runs/:testRunId/cancel', requireAuth, validateRequest({ params: testRunParams, query: noQueryParams, body: noQueryParams }), cancelRun);
export default router;
