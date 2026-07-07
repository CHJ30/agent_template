import { Controller, Get, Query } from '@nestjs/common';
import { register } from 'prom-client';
import { nodeTracer } from './node-tracer.js';

@Controller('observability')
export class ObservabilityController {
  @Get('metrics')
  async getMetrics() {
    return register.getMetricsAsJSON();
  }

  /** Per-session node lifecycle traces for the observability drawer. */
  @Get('session')
  getSession(@Query('sessionId') sessionId: string) {
    const requests = nodeTracer.getSession(sessionId ?? '');
    const last     = nodeTracer.getLastRequest(sessionId ?? '');
    return { sessionId, requests, last };
  }
}
