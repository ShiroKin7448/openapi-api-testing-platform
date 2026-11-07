import { Router } from 'express';
import { TestCaseController, previewAssertions } from '../controllers/test-case.controller';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { noQueryParams, testCaseIdParams, endpointIdParams, projectParams, testCasePatchBody, testCaseBulkStatusBody, assertionPreviewBody } from '../validation/api.schemas';

const router = Router();
const controller = new TestCaseController();
router.get('/endpoints/:endpointId/test-cases', requireAuth, validateRequest({ params: endpointIdParams, query: noQueryParams }), controller.getEndpointCases);
import { z } from 'zod';
router.post('/endpoints/:endpointId/test-cases/generate', requireAuth, validateRequest({ params: endpointIdParams, body: z.any(), query: z.any() }), controller.generateForEndpoint);
router.get('/projects/:projectId/test-cases', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), controller.getProjectCases);
router.get('/test-cases/:testCaseId', requireAuth, validateRequest({ params: testCaseIdParams, query: noQueryParams }), controller.getTestCase);
router.patch('/test-cases/bulk/status', requireAuth, validateRequest({ body: testCaseBulkStatusBody, query: noQueryParams }), controller.bulkUpdateStatus);
router.patch('/test-cases/:testCaseId', requireAuth, validateRequest({ params: testCaseIdParams, body: testCasePatchBody, query: noQueryParams }), controller.updateTestCase);
router.post('/test-cases/:testCaseId/clone', requireAuth, validateRequest({ params: testCaseIdParams, body: z.any(), query: noQueryParams }), controller.cloneTestCase);
router.delete('/test-cases/:testCaseId', requireAuth, validateRequest({ params: testCaseIdParams, query: noQueryParams }), controller.deleteTestCase);
router.post('/assertions/preview', requireAuth, validateRequest({ body: assertionPreviewBody, query: noQueryParams }), previewAssertions);
export default router;
