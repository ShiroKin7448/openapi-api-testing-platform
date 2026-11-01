import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { apiTokenParams, createApiTokenBody, noQueryParams, projectParams } from '../validation/api.schemas';
import { createApiToken, listApiTokens, revokeApiToken } from '../controllers/project-api-token.controller';

const router = Router();
router.post('/projects/:projectId/api-tokens', requireAuth, validateRequest({ params: projectParams, body: createApiTokenBody, query: noQueryParams }), createApiToken);
router.get('/projects/:projectId/api-tokens', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), listApiTokens);
router.delete('/projects/:projectId/api-tokens/:tokenId', requireAuth, validateRequest({ params: apiTokenParams, query: noQueryParams }), revokeApiToken);

export default router;
