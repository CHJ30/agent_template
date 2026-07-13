import { Controller, Get, Query } from '@nestjs/common';
import { register } from 'prom-client';
import { nodeTracer } from './node-tracer.js';
import { CostTrackingService } from '../llm/cost/cost-tracking.service.js';

@Controller('observability')
export class ObservabilityController {
  constructor(private readonly costTrackingService: CostTrackingService) {}
  @Get('metrics')
  async getMetrics() {
    return register.getMetricsAsJSON();
  }

  /** Per-session node lifecycle traces for the observability drawer. */
  @Get('session')
  async getSession(@Query('sessionId') sessionId: string) {
    const requests = nodeTracer.getSession(sessionId ?? '');
    const last     = nodeTracer.getLastRequest(sessionId ?? '');
    const costs = await this.costTrackingService.getSessionCosts(sessionId ?? '');
    return { sessionId, requests, last, costs };
  }
}
