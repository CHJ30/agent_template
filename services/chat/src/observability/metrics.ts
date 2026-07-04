/**
 * Prometheus metrics singleton.
 *
 * Using getOrCreate() prevents "Metric already registered" errors when NestJS
 * hot-reloads the module or when tests import the file multiple times.
 */
import { Histogram, register } from 'prom-client';

const HTTP_DURATION_METRIC = 'http_request_duration_seconds';

function getOrCreate(): Histogram<string> {
  const existing = register.getSingleMetric(HTTP_DURATION_METRIC);
  if (existing) return existing as Histogram<string>;

  return new Histogram({
    name:       HTTP_DURATION_METRIC,
    help:       'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets:    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });
}

export const httpDuration: Histogram<string> = getOrCreate();
