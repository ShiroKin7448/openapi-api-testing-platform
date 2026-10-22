import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middlewares/requireAuth';
import { EndpointFilters, OpenApiCatalogService, OpenApiSource } from '../services/openapi-catalog.service';

const catalogService = new OpenApiCatalogService();

export const importSpec = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const source: OpenApiSource = req.openApiFile
      ? { fileName: req.openApiFile.originalName, content: req.openApiFile.buffer.toString('utf8') }
      : { content: req.body as unknown };
    let sourceContent: unknown = source.content;
    if (source.fileName === undefined && typeof sourceContent === 'object' && sourceContent !== null) {
      const body = sourceContent as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(body, 'content')) sourceContent = body.content;
    }
    const result = await catalogService.importSpec(req.user!.id, req.params.projectId, { ...source, content: sourceContent });
    res.status(result.created ? 201 : 200).json({ success: true, data: result.result });
  } catch (error) { next(error); }
};

export const getSpecs = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const specs = await catalogService.getSpecs(req.user!.id, req.params.projectId);
    res.status(200).json({ success: true, data: specs });
  } catch (error) { next(error); }
};

export const getSpec = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const spec = await catalogService.getSpec(req.user!.id, req.params.specId);
    res.status(200).json({ success: true, data: spec });
  } catch (error) { next(error); }
};

export const getSpecEndpoints = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const filters = req.query as unknown as EndpointFilters;
    const endpoints = await catalogService.getEndpoints(req.user!.id, req.params.specId, filters);
    res.status(200).json({ success: true, data: endpoints });
  } catch (error) { next(error); }
};

export const getSpecFlow = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const flow = await catalogService.getSpecFlow(req.user!.id, req.params.specId);
    res.status(200).json({ success: true, data: flow });
  } catch (error) { next(error); }
};

export const deleteSpec = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await catalogService.deleteSpec(req.user!.id, req.params.projectId, req.params.specId);
    res.status(204).send();
  } catch (error) { next(error); }
};
