import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { getTraceId } from './trace-context.js';

/**
 * Ensures every successful response carries the x-trace-id header.
 *
 * The TraceMiddleware sets the header synchronously before the route handler
 * runs.  This interceptor is a belt-and-suspenders guard for handlers that
 * return early via pipes/interceptors that execute after the middleware but
 * before the response is flushed.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap(() => {
        if (!res.getHeader('x-trace-id')) {
          res.setHeader('x-trace-id', getTraceId());
        }
      }),
    );
  }
}
