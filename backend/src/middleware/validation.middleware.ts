/**
 * Validation Middleware for MeshSOS.
 *
 * - Payload size enforcement (10KB max via express.json limit)
 * - Generic Zod schema validation middleware factory
 * - Input sanitization utilities
 *
 * Requirement references: 38.2
 */

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Maximum allowed request body size in bytes (10KB).
 * Applied via express.json({ limit }) in the app setup.
 */
export const MAX_PAYLOAD_SIZE = '10kb';

/**
 * Generic Zod validation middleware factory.
 * Validates the request body against the provided schema.
 * Returns 400 with validation error details on failure.
 *
 * @param schema - Zod schema to validate against
 * @param source - Which part of the request to validate ('body' | 'query' | 'params')
 */
export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const data = req[source];
    const result = schema.safeParse(data);

    if (!result.success) {
      const zodError = result.error as ZodError;
      res.status(400).json({
        error: 'Validation failed',
        details: zodError.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      });
      return;
    }

    // Attach parsed (and coerced) data back to the request
    if (source === 'body') {
      req.body = result.data;
    }

    next();
  };
}

/**
 * Middleware to handle payload-too-large errors gracefully.
 * Express emits a 413 when the body exceeds the configured limit.
 * This error handler provides a consistent JSON response.
 */
export function payloadTooLargeHandler(
  err: Error & { type?: string; status?: number },
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err.type === 'entity.too.large' || err.status === 413) {
    res.status(413).json({
      error: 'Payload too large',
      message: 'Request body must not exceed 10KB',
    });
    return;
  }
  next(err);
}
