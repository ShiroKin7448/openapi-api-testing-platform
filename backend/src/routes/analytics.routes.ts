import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { analyticsQuery, projectParams, testRunParams } from '../validation/api.schemas';
import { getProjectAnalytics, getTestRunAnalytics } from '../controllers/analytics.controller';

const router = Router();
router.get('/projects/:projectId/analytics', requireAuth, validateRequest({ params: projectParams, query: analyticsQuery }), getProjectAnalytics);
router.get('/test-runs/:testRunId/analytics', requireAuth, validateRequest({ params: testRunParams }), getTestRunAnalytics);

export default router;
