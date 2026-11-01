import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { projectApiTokenService } from '../services/project-api-token.service';

export interface ApiTokenRequest extends Request {
  apiToken?: { projectId: string; tokenId: string; createdBy: string };
}

/**
 * Authenticates a project-scoped CI/CD token (not a user JWT). The token must
 * also match the :projectId route param so a token minted for one project can
 * never trigger runs in another.
 */
export async function requireApiToken(req: ApiTokenRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('Authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
    if (!token) throw new AppError('Missing API token', 401, true, 'MISSING_API_TOKEN');

    const context = await projectApiTokenService.verify(token);
    if (!context) throw new AppError('Invalid or revoked API token', 401, true, 'INVALID_API_TOKEN');
    if (req.params.projectId && context.projectId !== req.params.projectId) {
      throw new AppError('This token is not authorized for the requested project', 403, true, 'TOKEN_PROJECT_MISMATCH');
    }

    req.apiToken = context;
    next();
  } catch (error) {
    next(error);
  }
}
