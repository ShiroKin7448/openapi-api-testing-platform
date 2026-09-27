import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

declare global {
  namespace Express {
    interface Request { requestId?: string; }
  }
}

export function requestCorrelation(req: Request, res: Response, next: NextFunction): void {
  const suppliedId = req.header('x-request-id');
  const requestId = suppliedId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedId) ? suppliedId : randomUUID();
  const startedAt = Date.now();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  res.once('finish', () => {
    console.log(JSON.stringify({
      event: 'http.request.complete', requestId, method: req.method,
      statusCode: res.statusCode, durationMs: Date.now() - startedAt,
    }));
  });
  next();
}
