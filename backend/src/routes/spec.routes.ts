import { Router } from 'express';
import { deleteSpec, getSpec, getSpecEndpoints, getSpecFlow, getSpecs, importSpec } from '../controllers/spec.controller';
import { requireAuth } from '../middlewares/requireAuth';
import { openapiUpload } from '../middlewares/openapiUpload';
import { validateRequest } from '../middlewares/validateRequest';
import { idSchema, noQueryParams, projectParams } from '../validation/api.schemas';
import { z } from 'zod';

const projectRouter = Router();
projectRouter.post('/:projectId/specs/import', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), openapiUpload, importSpec);
projectRouter.get('/:projectId/specs', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), getSpecs);
projectRouter.delete('/:projectId/specs/:specId', requireAuth, validateRequest({
  params: projectParams.extend({ specId: idSchema }), query: noQueryParams,
}), deleteSpec);

const specRouter = Router();
const endpointQuery = z.object({
  method: z.enum(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  minRiskScore: z.coerce.number().int().min(0).max(100).optional(),
  maxRiskScore: z.coerce.number().int().min(0).max(100).optional(),
  search: z.string().trim().min(1).max(200).optional(),
}).strict().refine((query) => query.minRiskScore === undefined || query.maxRiskScore === undefined || query.minRiskScore <= query.maxRiskScore, 'minRiskScore must be less than or equal to maxRiskScore');
const specParams = z.object({ specId: idSchema });
specRouter.get('/:specId', requireAuth, validateRequest({ params: specParams, query: noQueryParams }), getSpec);
specRouter.get('/:specId/endpoints', requireAuth, validateRequest({ params: specParams, query: endpointQuery }), getSpecEndpoints);
specRouter.get('/:specId/flow', requireAuth, validateRequest({ params: specParams, query: noQueryParams }), getSpecFlow);

export { projectRouter as projectSpecRoutes, specRouter as specRoutes };
export default projectRouter;
