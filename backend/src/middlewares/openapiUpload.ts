import { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../utils/AppError';

export const OPENAPI_UPLOAD_LIMIT = 5 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 16 * 1024;

export interface UploadedOpenApiFile {
  originalName: string;
  buffer: Buffer;
}

declare global {
  namespace Express {
    interface Request {
      openApiFile?: UploadedOpenApiFile;
    }
  }
}

function multipartBoundary(contentType: string | undefined): string | undefined {
  if (!contentType || !/^multipart\/form-data\s*;/i.test(contentType)) return undefined;
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match?.[1] ?? match?.[2];
}

function parseSingleFile(body: Buffer, boundary: string): UploadedOpenApiFile {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerBreak = Buffer.from('\r\n\r\n');
  const partEnd = Buffer.from(`\r\n--${boundary}`);
  const firstBoundary = body.indexOf(delimiter);
  if (firstBoundary !== 0) throw new AppError('Malformed multipart request', 400, true, 'INVALID_MULTIPART');
  const headersStart = firstBoundary + delimiter.length + 2;
  const headersEnd = body.indexOf(headerBreak, headersStart);
  const contentEnd = body.indexOf(partEnd, headersEnd + headerBreak.length);
  if (headersEnd < 0 || contentEnd < 0) throw new AppError('Malformed multipart request', 400, true, 'INVALID_MULTIPART');

  const headers = body.toString('latin1', headersStart, headersEnd);
  const disposition = /^content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/im.exec(headers);
  if (!disposition || disposition[1] !== 'file' || !disposition[2]) {
    throw new AppError('multipart/form-data must contain a file field named file', 400, true, 'FILE_REQUIRED');
  }
  if (body.indexOf(delimiter, contentEnd + partEnd.length) >= 0) {
    throw new AppError('Only one uploaded file is supported', 400, true, 'INVALID_MULTIPART');
  }
  const originalName = disposition[2].replace(/\\/g, '/').split('/').pop() ?? '';
  const extension = originalName.toLowerCase().split('.').pop();
  if (!['json', 'yaml', 'yml'].includes(extension ?? '')) {
    throw new AppError('Only .json, .yaml, and .yml files are supported', 415, true, 'UNSUPPORTED_FILE_TYPE');
  }
  const buffer = body.subarray(headersEnd + headerBreak.length, contentEnd);
  if (buffer.length > OPENAPI_UPLOAD_LIMIT) {
    throw new AppError('OpenAPI upload exceeds the 5 MB limit', 413, true, 'FILE_TOO_LARGE');
  }
  return { originalName, buffer };
}

export const openapiUpload: RequestHandler = (req: Request, _res: Response, next: NextFunction): void => {
  const contentType = req.headers['content-type'];
  const boundary = multipartBoundary(contentType);
  if (!boundary) {
    if (contentType && /^multipart\/form-data\b/i.test(contentType)) {
      next(new AppError('multipart/form-data boundary is missing', 400, true, 'INVALID_MULTIPART'));
      return;
    }
    next();
    return;
  }
  if (boundary.length > 200) {
    next(new AppError('Malformed multipart boundary', 400, true, 'INVALID_MULTIPART'));
    return;
  }

  const chunks: Buffer[] = [];
  let byteCount = 0;
  let failed = false;
  req.on('data', (chunk: Buffer | string) => {
    if (failed) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteCount += buffer.length;
    if (byteCount > OPENAPI_UPLOAD_LIMIT + MAX_MULTIPART_OVERHEAD) {
      failed = true;
      next(new AppError('OpenAPI upload exceeds the 5 MB limit', 413, true, 'FILE_TOO_LARGE'));
      return;
    }
    chunks.push(buffer);
  });
  req.on('end', () => {
    if (failed) return;
    try {
      req.openApiFile = parseSingleFile(Buffer.concat(chunks), boundary);
      next();
    } catch (error) { next(error); }
  });
  req.on('error', (error: Error) => {
    if (failed) return;
    failed = true;
    next(error);
  });
};
