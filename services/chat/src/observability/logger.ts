import pino from 'pino';
import path from 'path';
import { getTraceId } from './trace-context.js';

/**
 * Pino mixin — automatically merged into every log record.
 * Returns the traceId from the current AsyncLocalStorage context so every
 * log line is correlated with the request that produced it.
 */
export function traceMixin(): Record<string, string> {
  return { traceId: getTraceId() };
}

const isProduction = process.env.NODE_ENV === 'production';
// __dirname (compiled) = services/chat/dist/observability → ../../../../ = project root
const logFile = path.resolve(__dirname, '../../../../log/app.log');

// Dev (`bun run dev` → `nest start --watch`, NODE_ENV !== 'production'):
//   every log line is written BOTH to the console (pretty-printed) AND to
//   log/app.log (plain JSON) so tailing the file works the same in dev/prod.
// Prod (`bun run build && bun run start`, NODE_ENV=production):
//   logs go ONLY to log/app.log — nothing is written to stdout/stderr.
const transport = pino.transport({
  targets: isProduction
    ? [
        { target: 'pino/file', options: { destination: logFile, mkdir: true }, level: 'info' },
      ]
    : [
        { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' }, level: 'debug' },
        { target: 'pino/file', options: { destination: logFile, mkdir: true }, level: 'debug' },
      ],
});

const baseLogger = pino(
  {
    // LOG_LEVEL from .env — defaults to 'info' when unset.
    level: process.env.LOG_LEVEL ?? 'info',
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
  },
  transport,
);

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
