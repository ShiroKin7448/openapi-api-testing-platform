import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth';
import { validateRequest } from '../middlewares/validateRequest';
import { idSchema, noQueryParams, projectParams } from '../validation/api.schemas';
import { createDataset, deleteDataset, getDataset, listDatasets, updateDataset } from '../controllers/dataset.controller';

const datasetParams = z.object({ datasetId: idSchema });
const content = z.string().min(1).max(4 * 1024 * 1024);
const createBody = z.object({ name: z.string().trim().min(1).max(120), format: z.enum(['csv', 'json']), content }).strict();
const updateBody = z.object({ name: z.string().trim().min(1).max(120).optional(), format: z.enum(['csv', 'json']).optional(), content: content.optional() })
  .strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const router = Router();
router.get('/projects/:projectId/datasets', requireAuth, validateRequest({ params: projectParams, query: noQueryParams }), listDatasets);
router.post('/projects/:projectId/datasets', requireAuth, validateRequest({ params: projectParams, body: createBody, query: noQueryParams }), createDataset);
router.get('/datasets/:datasetId', requireAuth, validateRequest({ params: datasetParams, query: noQueryParams }), getDataset);
router.patch('/datasets/:datasetId', requireAuth, validateRequest({ params: datasetParams, body: updateBody, query: noQueryParams }), updateDataset);
router.delete('/datasets/:datasetId', requireAuth, validateRequest({ params: datasetParams, query: noQueryParams }), deleteDataset);

export default router;
