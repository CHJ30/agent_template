import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getTraceId } from './trace-context.js';
import { createLogger } from './logger.js';

const errorLog = createLogger('exception');

/**
 * Global exception filter.
 *
 * - HttpException   → preserves the original status code and message.
 * - Everything else → 500 Internal Server Error.
 *
 * Every error response is enriched with `traceId` and `timestamp` so
 * client-side and log-aggregation correlation is possible.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : 'Internal server error';

    // Structured error log — traceId injected automatically by traceMixin.
    errorLog.error(
      {
        err:        exception,
        method:     req.method,
        url:        req.url,
        statusCode,
        traceId:    getTraceId(),
      },
      message,
    );

    res.status(statusCode).json({
      statusCode,
      message,
      traceId:   getTraceId(),
      timestamp: new Date().toISOString(),
    });
  }
}
