import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError';
import { getJwtSecret } from '../utils/jwtSecret';


export interface AuthRequest extends Request {
  user?: { id: string; email: string };
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Not authenticated', 401));
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return next(new AppError('Not authenticated', 401));

  let secret: string;
  try { secret = getJwtSecret(); }
  catch (error) { return next(error); }
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || typeof decoded.id !== 'string' || typeof decoded.email !== 'string') {
      return next(new AppError('Invalid token', 401));
    }
    req.user = { id: decoded.id, email: decoded.email };
    next();
  } catch (error) {
    next(new AppError('Invalid token', 401));
  }
};
