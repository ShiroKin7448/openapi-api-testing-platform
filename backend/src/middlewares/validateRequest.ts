import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, ZodType } from 'zod';
import { AppError } from '../utils/AppError';

export interface RequestSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) req.params = schemas.params.parse(req.params) as Request['params'];
      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', { configurable: true, value: parsedQuery });
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const msg = `Invalid request: ${error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`;
        console.error('Validation Error Details:', msg, 'req.url:', req.url, 'req.query:', req.query);
        next(new AppError(msg, 400));
        return;
      }
      next(error);
    }
  };
}
