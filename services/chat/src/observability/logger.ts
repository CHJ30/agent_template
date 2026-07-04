import pino from 'pino';
import { getTraceId } from './trace-context.js';

/**
 * Pino mixin — automatically merged into every log record.
 * Returns the traceId from the current AsyncLocalStorage context so every
 * log line is correlated with the request that produced it.
 */
export function traceMixin(): Record<string, string> {
  return { traceId: getTraceId() };
}

const baseLogger = pino({
  mixin: traceMixin,

  // PII / credential redaction — applied before serialisation.
  redact: {
    paths: [
      'apiKey',
      'authorization',
      'password',
      '*.apiKey',
      '*.authorization',
      '*.password',
      'req.headers.authorization',
    ],
    censor: '[REDACTED]',
  },

  // Human-readable output when LOG_PRETTY=1 (local dev); plain JSON in prod.
  transport:
    process.env.LOG_PRETTY === '1'
      ? {
          target:  'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        }
      : undefined,
});

/**
 * Factory that returns a child logger pre-tagged with a `module` field.
 *
 * Usage:
 *   const log = createLogger('http');
 *   log.info({ statusCode: 200 }, 'access');
 */
export function createLogger(module: string): pino.Logger {
  return baseLogger.child({ module });
}
