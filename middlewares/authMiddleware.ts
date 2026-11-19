import { Request, Response, NextFunction } from 'express';
import { supabase } from '..';
import { sendApiError } from '../functions/apiErrors';

// After authMiddleware runs, user is guaranteed to be set
export interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'No token provided');
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'Invalid token');
    }

    // Attach user to request
    (req as AuthenticatedRequest).user = data.user;
    next();
  } catch (err) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication failed');
  }
};
