import { Request, Response, NextFunction } from 'express';
import { supabase } from '..';

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
    return res.status(401).send({ error: 'No token provided' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).send({ error: 'Invalid token' });
    }

    // Attach user to request
    (req as AuthenticatedRequest).user = data.user;
    next();
  } catch (err) {
    return res.status(401).send({ error: 'Authentication failed' });
  }
};
