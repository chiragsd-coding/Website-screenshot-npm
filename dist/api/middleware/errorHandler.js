import { ZodError } from 'zod';
import { logger } from '../../utils/logger.js';
export function errorHandlerMiddleware(err, req, res, next) {
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
