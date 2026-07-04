import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { runWithTrace, newTraceId, getTraceId, getElapsedMs } from './trace-context.js';
import { createLogger } from './logger.js';
import { httpDuration } from './metrics.js';

const accessLog = createLogger('http');

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Re-use caller-supplied trace header or generate a fresh one.
    const traceId =
      (req.headers['x-trace-id'] as string | undefined) ?? newTraceId();

    runWithTrace(traceId, () => {
      // Propagate to response immediately so early errors also carry the header.
      res.setHeader('x-trace-id', traceId);

      res.on('finish', () => {
        const durationMs = getElapsedMs();

        // Structured access log — traceId is injected automatically by traceMixin.
        accessLog.info(
          {
            method:     req.method,
            url:        req.url,
            statusCode: res.statusCode,
            durationMs,
            traceId:    getTraceId(),
          },
          'access',
        );

        // Prometheus histogram in seconds.
        httpDuration.observe(
          {
            method: req.method,
            // req.route is populated by Express after routing; fall back to raw url.
            route:  (req.route?.path as string | undefined) ?? req.url,
            status: String(res.statusCode),
          },
          durationMs / 1000,
        );
      });

      next();
    });
  }
}
