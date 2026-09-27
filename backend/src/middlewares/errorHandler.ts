import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { ApiError } from '@shared/types';

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response<ApiError>,
  next: NextFunction
) => {
  let statusCode = 500;
  let message = 'Internal server error';

  let code = 'INTERNAL_ERROR';
  if (err instanceof AppError) {
    statusCode = err.isOperational ? err.statusCode : 500;
    message = err.isOperational ? err.message : 'Internal server error';
    code = err.isOperational ? err.code ?? (statusCode === 400 ? 'BAD_REQUEST' : statusCode === 401 ? 'UNAUTHENTICATED' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR') : 'INTERNAL_ERROR';
  } else {
    const parseError = err as Error & { type?: string; status?: number };
    if (parseError.type === 'entity.parse.failed' && parseError.status === 400) {
      statusCode = 400;
      code = 'INVALID_JSON';
      message = 'The JSON request body is invalid';
    } else if (parseError.type === 'entity.too.large' || parseError.status === 413) {
      statusCode = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'The request body exceeds the allowed size';
    }
  }

  if (!res.headersSent) console.error(JSON.stringify({
    event: 'http.request.error', requestId: req.requestId, method: req.method,
    statusCode, code, errorName: err.name,
  }));
  else { next(err); return; }

  res.status(statusCode).json({ success: false, error: { code, message } });
};
