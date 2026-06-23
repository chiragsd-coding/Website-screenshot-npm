import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../utils/logger.js';

export interface AppError extends Error {
  status?: number;
  code?: string;
}

export function errorHandlerMiddleware(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'An unexpected error occurred.';

  // Log the complete error stack trace for debugging
  logger.error(`API Error: ${status} - [${code}] ${message}`, {
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });

  // Handle Zod validation errors specially
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request parameters.',
        details: err.format(),
      },
    });
    return;
  }

  res.status(status).json({
    error: {
      code,
      message,
    },
  });
}
