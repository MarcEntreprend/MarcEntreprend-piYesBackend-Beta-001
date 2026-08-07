// server/src/middleware.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
if (!ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET is required (set it in .env)");
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: { message: 'Authentication required', code: 'UNAUTHORIZED' } });
  }

  try {
    const decoded = jwt.verify(token, ACCESS_SECRET) as { id: string; email: string };
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: { message: 'Invalid or expired token', code: 'UNAUTHORIZED' } });
  }
};

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({
    error: {
      message: err.message || 'Internal Server Error',
      status,
      code: err.code || 'INTERNAL_ERROR'
    }
  });
};
